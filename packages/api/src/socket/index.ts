import { randomUUID } from 'crypto';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { FastifyInstance } from 'fastify';
import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { publishEvent, getSequences, resyncEvents, onEvent } from '../lib/eventBus.js';
import { calculatePermissions } from '../services/permissions.js';
import { TextPermissions, VoicePermissions, hasPermission } from '@sgchat/shared';
import type { EventEnvelope, GatewayHello, GatewayReady, GatewayResume, GatewayResumed } from '@sgchat/shared';
import { isBlocked } from '../routes/friends.js';
import { createNotification } from '../routes/notifications.js';

// ── Constants ──────────────────────────────────────────────────
/** Heartbeat interval sent to client in gateway.hello (ms) */
const HEARTBEAT_INTERVAL = 30_000;
/** If no heartbeat received in this window, server considers client dead */
const HEARTBEAT_TIMEOUT = HEARTBEAT_INTERVAL * 1.5;

// ── Idempotency dedup cache (in-memory, per-process) ──────────
// Key = idempotency key, Value = timestamp of first seen
const idempotencyCache = new Map<string, number>();
const IDEMPOTENCY_TTL = 5 * 60 * 1000; // 5 minutes

// Cleanup stale idempotency keys every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of idempotencyCache) {
    if (now - ts > IDEMPOTENCY_TTL) idempotencyCache.delete(key);
  }
}, 60_000);

function checkIdempotency(key: string | undefined): boolean {
  if (!key) return false; // no key → not a duplicate
  if (idempotencyCache.has(key)) return true; // duplicate
  idempotencyCache.set(key, Date.now());
  return false;
}

export function initSocketIO(io: SocketIOServer, fastify: FastifyInstance) {
  // ── Auth middleware ──────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = fastify.jwt.verify(token) as any;
      socket.data.user = decoded;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  // ── Subscribe to event bus and relay to Socket.IO rooms ─────
  onEvent((envelope: EventEnvelope) => {
    // Emit the envelope to the matching Socket.IO room.
    // The resource_id doubles as the room name (channel:{id}, dm:{id}, user:{id}, server:{id}).
    io.to(envelope.resource_id).emit('event', envelope);

    // Also emit with the legacy event name for backward compat
    // (clients that haven't upgraded to envelope-based listening)
    io.to(envelope.resource_id).emit(envelope.type, envelope.payload);
  });

  // ── Connection handler ──────────────────────────────────────
  io.on('connection', async (socket: Socket) => {
    const userId = socket.data.user.id;
    const sessionId = randomUUID();
    fastify.log.info(`Socket connected: ${socket.data.user.username} (${userId}) session=${sessionId}`);

    // ── Room joins ────────────────────────────────────────────
    socket.join(`user:${userId}`);

    const servers = await db.servers.findByUserId(userId);
    const subscriptions: string[] = [`user:${userId}`];

    for (const server of servers) {
      socket.join(`server:${server.id}`);
      subscriptions.push(`server:${server.id}`);
      
      const channels = await db.channels.findByServerId(server.id);
      for (const channel of channels) {
        socket.join(`channel:${channel.id}`);
        subscriptions.push(`channel:${channel.id}`);
      }
    }

    const dmChannels = await db.dmChannels.findByUserId(userId);
    for (const dm of dmChannels) {
      socket.join(`dm:${dm.id}`);
      subscriptions.push(`dm:${dm.id}`);
    }

    // ── Send gateway.hello ────────────────────────────────────
    const helloPayload: GatewayHello = {
      heartbeat_interval: HEARTBEAT_INTERVAL,
      session_id: sessionId,
    };
    socket.emit('gateway.hello', helloPayload);

    // ── Send gateway.ready with current sequences ─────────────
    const sequences = await getSequences(subscriptions);
    const currentUser = await db.users.findById(userId);
    const storedStatus = currentUser?.status || 'offline';

    const readyPayload: GatewayReady = {
      user: {
        id: userId,
        username: socket.data.user.username,
        status: storedStatus as any,
      },
      sequences,
      subscriptions,
    };
    socket.emit('gateway.ready', readyPayload);

    // ── Persist gateway session for resume support ────────────
    await redis.setGatewaySession(sessionId, userId, subscriptions);

    // ── Presence broadcast (existing behaviour) ───────────────
    await redis.setPresence(userId, true);

    if (storedStatus !== 'offline') {
      for (const server of servers) {
        // Publish through event bus so it flows through envelopes
        await publishEvent({
          type: 'presence.update',
          actorId: userId,
          resourceId: `server:${server.id}`,
          payload: {
            user_id: userId,
            status: storedStatus,
            custom_status: currentUser?.custom_status || null,
            last_seen_at: new Date().toISOString(),
          },
        });
      }
    }

    // ── Heartbeat protocol ────────────────────────────────────
    let heartbeatTimer: NodeJS.Timeout | null = null;

    function resetHeartbeat() {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      heartbeatTimer = setTimeout(() => {
        fastify.log.warn(`Heartbeat timeout for ${socket.data.user.username} — disconnecting`);
        socket.disconnect(true);
      }, HEARTBEAT_TIMEOUT);
    }

    resetHeartbeat();

    socket.on('gateway.heartbeat', () => {
      socket.emit('gateway.heartbeat_ack', { timestamp: new Date().toISOString() });
      resetHeartbeat();
      // Keep the gateway session alive while the client is active
      redis.refreshGatewaySession(sessionId).catch(() => {});
    });

    // ── Gateway Resume ────────────────────────────────────────
    // Allows a client to resume a previous session after a brief
    // disconnect. The server replays missed events from durable
    // streams so the client doesn't need to refetch everything.

    socket.on('gateway.resume', async (data: GatewayResume) => {
      try {
        const { session_id: resumeSessionId, last_sequences } = data;

        // Validate the stored session exists and belongs to this user
        const storedSession = await redis.getGatewaySession(resumeSessionId);
        if (!storedSession || storedSession.userId !== userId) {
          socket.emit('gateway.resume_failed', {
            reason: 'invalid_session',
            message: 'Session not found or expired. Please reconnect normally.',
          });
          return;
        }

        // Re-build current subscriptions (channels/DMs may have changed)
        const freshSubscriptions = [...subscriptions]; // already computed on connect
        const freshSubSet = new Set(freshSubscriptions);

        // Also include the old session's subscriptions for resync
        // (in case the client was subscribed to channels that still exist)
        const oldSubs = storedSession.subscriptions || [];
        for (const sub of oldSubs) {
          if (!freshSubSet.has(sub)) {
            freshSubscriptions.push(sub);
            freshSubSet.add(sub);
          }
        }

        // Re-join Socket.IO rooms for any subs not already joined
        for (const sub of freshSubscriptions) {
          socket.join(sub);
        }

        // Collect missed events from durable streams
        const missedEvents: EventEnvelope[] = [];

        // Only resync resources the client has last_sequences for
        const resyncPromises = Object.entries(last_sequences).map(
          async ([resourceId, lastSeq]) => {
            // Only resync resources the user is subscribed to
            if (!freshSubSet.has(resourceId)) return;
            try {
              const result = await resyncEvents({
                resourceId,
                afterSequence: lastSeq,
                limit: 100, // cap per resource to avoid huge payloads
              });
              return result.events;
            } catch {
              return [];
            }
          }
        );

        const results = await Promise.all(resyncPromises);
        for (const events of results) {
          if (events) missedEvents.push(...events);
        }

        // Sort all missed events by timestamp for consistent delivery order
        missedEvents.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

        // Get current sequences for the client
        const currentSequences = await getSequences(freshSubscriptions);

        // Update the stored session with fresh subscriptions
        await redis.setGatewaySession(sessionId, userId, freshSubscriptions);
        // Clean up old session
        if (resumeSessionId !== sessionId) {
          await redis.deleteGatewaySession(resumeSessionId);
        }

        const resumedPayload: GatewayResumed = {
          session_id: sessionId, // new session ID for future resumes
          missed_events: missedEvents,
          sequences: currentSequences,
          subscriptions: freshSubscriptions,
        };

        socket.emit('gateway.resumed', resumedPayload);
        fastify.log.info(
          `Session resumed for ${socket.data.user.username}: replayed ${missedEvents.length} events`
        );
      } catch (err) {
        fastify.log.error(err, 'Gateway resume failed');
        socket.emit('gateway.resume_failed', {
          reason: 'internal_error',
          message: 'Resume failed due to server error. Please reconnect normally.',
        });
      }
    });

    // ── Message Events ────────────────────────────────────────

    socket.on('message:send', async (data: {
      channel_id: string;
      content: string;
      reply_to_id?: string;
      idempotency_key?: string;
    }) => {
      try {
        if (!data.content || data.content.trim().length === 0) {
          socket.emit('error', { message: 'Message cannot be empty' });
          return;
        }

        // Idempotency check
        if (checkIdempotency(data.idempotency_key)) {
          return; // duplicate — silently ignore
        }

        const channel = await db.channels.findById(data.channel_id);
        if (!channel) return;

        const perms = await calculatePermissions(userId, channel.server_id, data.channel_id);
        if (!hasPermission(perms.text, TextPermissions.SEND_MESSAGES)) {
          socket.emit('error', { message: 'Missing SEND_MESSAGES permission' });
          return;
        }

        const message = await db.messages.create({
          channel_id: data.channel_id,
          author_id: userId,
          content: data.content,
          reply_to_id: data.reply_to_id,
          status: 'sent',
        });

        const author = await db.users.findById(userId);
        
        const formattedMessage = {
          id: message.id,
          channel_id: message.channel_id,
          content: message.content,
          author: {
            id: author.id,
            username: author.username,
            display_name: author.display_name || author.username,
            avatar_url: author.avatar_url,
          },
          created_at: message.created_at,
          edited_at: message.edited_at,
          attachments: message.attachments || [],
          reactions: [],
          reply_to_id: message.reply_to_id,
        };

        // Publish through the event bus (envelope + durable stream + pub/sub)
        await publishEvent({
          type: 'message.new',
          actorId: userId,
          resourceId: `channel:${data.channel_id}`,
          payload: formattedMessage,
        });

        // A6: Detect @mentions and create high-priority notifications
        const mentionRegex = /@(\w+)/g;
        let mentionMatch;
        const mentionedUsernames = new Set<string>();
        while ((mentionMatch = mentionRegex.exec(data.content)) !== null) {
          mentionedUsernames.add(mentionMatch[1]);
        }

        // Track who already got notified to avoid duplicates
        const notifiedUserIds = new Set<string>();

        if (mentionedUsernames.size > 0) {
          // Look up mentioned users (limit to prevent abuse)
          const usernames = Array.from(mentionedUsernames).slice(0, 20);
          for (const username of usernames) {
            const mentionedUser = await db.users.findByUsername(username);
            if (mentionedUser && mentionedUser.id !== userId) {
              notifiedUserIds.add(mentionedUser.id);
              await createNotification({
                userId: mentionedUser.id,
                type: 'mention',
                priority: 'high',
                data: {
                  channel_id: data.channel_id,
                  channel_name: channel.name,
                  server_id: channel.server_id,
                  message_id: message.id,
                  from_user: {
                    id: author.id,
                    username: author.username,
                    avatar_url: author.avatar_url || null,
                  },
                  message_preview: data.content.slice(0, 100),
                },
              });
            }
          }
        }

        // A6: Notify the author of the message being replied to
        if (data.reply_to_id) {
          const repliedMessage = await db.messages.findById(data.reply_to_id);
          if (
            repliedMessage &&
            repliedMessage.author_id &&
            repliedMessage.author_id !== userId &&
            !notifiedUserIds.has(repliedMessage.author_id)
          ) {
            notifiedUserIds.add(repliedMessage.author_id);
            await createNotification({
              userId: repliedMessage.author_id,
              type: 'mention', // reply is treated as a mention-like notification
              priority: 'high',
              data: {
                channel_id: data.channel_id,
                channel_name: channel.name,
                server_id: channel.server_id,
                message_id: message.id,
                reply_to_id: data.reply_to_id,
                from_user: {
                  id: author.id,
                  username: author.username,
                  avatar_url: author.avatar_url || null,
                },
                message_preview: data.content.slice(0, 100),
              },
            });
          }
        }
      } catch (err) {
        fastify.log.error(err);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    socket.on('message:edit', async (data: {
      message_id: string;
      content: string;
    }) => {
      try {
        if (!data.content || data.content.trim().length === 0) {
          socket.emit('error', { message: 'Message cannot be empty' });
          return;
        }

        const message = await db.messages.findById(data.message_id);
        if (!message || message.author_id !== userId) {
          socket.emit('error', { message: 'Cannot edit this message' });
          return;
        }

        const updated = await db.messages.update(data.message_id, {
          content: data.content,
          edited_at: new Date(),
        });

        const author = await db.users.findById(message.author_id);
        
        const formattedMessage = {
          id: updated.id,
          channel_id: updated.channel_id,
          content: updated.content,
          author: author ? {
            id: author.id,
            username: author.username,
            display_name: author.display_name || author.username,
            avatar_url: author.avatar_url,
          } : null,
          created_at: updated.created_at,
          edited_at: updated.edited_at,
          attachments: updated.attachments || [],
        };

        const resourceId = message.channel_id ? `channel:${message.channel_id}` : `dm:${message.dm_channel_id}`;
        await publishEvent({
          type: message.channel_id ? 'message.update' : 'dm.message.update',
          actorId: userId,
          resourceId,
          payload: formattedMessage,
        });
      } catch (err) {
        fastify.log.error(err);
        socket.emit('error', { message: 'Failed to edit message' });
      }
    });

    socket.on('message:delete', async (data: { message_id: string }) => {
      try {
        const message = await db.messages.findById(data.message_id);
        if (!message) return;

        let canDelete = message.author_id === userId;
        if (!canDelete && message.channel_id) {
          const channel = await db.channels.findById(message.channel_id);
          const perms = await calculatePermissions(userId, channel.server_id, message.channel_id);
          canDelete = hasPermission(perms.text, TextPermissions.MANAGE_MESSAGES);
        }

        if (!canDelete) {
          socket.emit('error', { message: 'Cannot delete this message' });
          return;
        }

        await db.messages.delete(data.message_id);

        const resourceId = message.channel_id ? `channel:${message.channel_id}` : `dm:${message.dm_channel_id}`;
        await publishEvent({
          type: message.channel_id ? 'message.delete' : 'dm.message.delete',
          actorId: userId,
          resourceId,
          payload: { id: data.message_id },
        });
      } catch (err) {
        fastify.log.error(err);
        socket.emit('error', { message: 'Failed to delete message' });
      }
    });

    // ── Typing Indicators ─────────────────────────────────────

    const typingTimeouts = new Map<string, NodeJS.Timeout>();

    socket.on('typing:start', async (data: { channel_id: string }) => {
      const key = `${userId}:${data.channel_id}`;
      
      if (typingTimeouts.has(key)) {
        clearTimeout(typingTimeouts.get(key)!);
      }

      const user = await db.users.findById(userId);
      const typingUser = user ? {
        id: user.id,
        username: user.username,
        display_name: user.display_name || user.username,
      } : { id: userId, username: 'Unknown', display_name: 'Unknown' };

      // Typing events are ephemeral — no durable stream needed.
      // We still use publishEvent so they get the envelope format.
      await publishEvent({
        type: 'typing.start',
        actorId: userId,
        resourceId: `channel:${data.channel_id}`,
        payload: {
          channel_id: data.channel_id,
          user: typingUser,
        },
      });

      const timeout = setTimeout(async () => {
        await publishEvent({
          type: 'typing.stop',
          actorId: userId,
          resourceId: `channel:${data.channel_id}`,
          payload: {
            channel_id: data.channel_id,
            user_id: userId,
          },
        });
        typingTimeouts.delete(key);
      }, 5000);

      typingTimeouts.set(key, timeout);
    });

    socket.on('typing:stop', async (data: { channel_id: string }) => {
      const key = `${userId}:${data.channel_id}`;
      
      if (typingTimeouts.has(key)) {
        clearTimeout(typingTimeouts.get(key)!);
        typingTimeouts.delete(key);
      }

      await publishEvent({
        type: 'typing.stop',
        actorId: userId,
        resourceId: `channel:${data.channel_id}`,
        payload: {
          user_id: userId,
          channel_id: data.channel_id,
        },
      });
    });

    // ── Presence Updates ──────────────────────────────────────

    socket.on('presence:update', async (data: { status: string }) => {
      const validStatuses = ['online', 'idle', 'dnd', 'offline'];
      const status = validStatuses.includes(data.status) ? data.status : 'online';
      
      await db.users.updateStatus(userId, status);
      
      for (const server of servers) {
        await publishEvent({
          type: 'presence.update',
          actorId: userId,
          resourceId: `server:${server.id}`,
          payload: {
            user_id: userId,
            status,
          },
        });
      }
    });

    // ── A3: Status Comment Updates ─────────────────────────────

    socket.on('status_comment:update', async (data: {
      text: string | null;
      emoji?: string | null;
      expires_at?: string | null;
    }) => {
      try {
        // Validate & sanitize
        const sanitizedText = data.text
          ? data.text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 128)
          : null;
        const emoji = data.emoji ?? null;
        const expiresAt = data.expires_at ? new Date(data.expires_at) : null;

        // Persist to DB
        await db.sql`
          UPDATE users
          SET
            custom_status = ${sanitizedText},
            custom_status_emoji = ${emoji},
            status_expires_at = ${expiresAt},
            updated_at = NOW()
          WHERE id = ${userId}
        `;

        // Broadcast status_comment.update to all servers the user belongs to
        for (const server of servers) {
          await publishEvent({
            type: 'status_comment.update',
            actorId: userId,
            resourceId: `server:${server.id}`,
            payload: {
              user_id: userId,
              text: sanitizedText,
              emoji,
              expires_at: data.expires_at || null,
            },
          });
        }
      } catch (err) {
        fastify.log.error(err);
        socket.emit('error', { message: 'Failed to update status comment' });
      }
    });

    // ── Voice State ───────────────────────────────────────────

    socket.on('voice:join', async (data: {
      channel_id: string;
      muted?: boolean;
      deafened?: boolean;
    }) => {
      try {
      const channel = await db.channels.findById(data.channel_id);
      if (!channel) return;

      if (channel.type !== 'voice') {
        socket.emit('error', { message: 'Not a voice channel' });
        return;
      }

      const perms = await calculatePermissions(userId, channel.server_id, data.channel_id);
      if (!hasPermission(perms.voice, VoicePermissions.CONNECT)) {
        socket.emit('error', { message: 'Missing CONNECT permission' });
        return;
      }

      if (channel.user_limit && channel.user_limit > 0) {
        const participants = await redis.getVoiceChannelParticipants(data.channel_id);
        if (participants.length >= channel.user_limit && !hasPermission(perms.voice, VoicePermissions.MOVE_MEMBERS)) {
          socket.emit('error', { message: 'Voice channel is full' });
          return;
        }
      }

      await redis.joinVoiceChannel(userId, data.channel_id);
      
      if (data.muted !== undefined || data.deafened !== undefined) {
        await redis.updateVoiceState(data.channel_id, userId, {
          is_muted: data.muted,
          is_deafened: data.deafened,
        });
      }

      const user = await db.users.findById(userId);

      await publishEvent({
        type: 'voice.join',
        actorId: userId,
        resourceId: `server:${channel.server_id}`,
        payload: {
          channel_id: data.channel_id,
          user: {
            id: user.id,
            username: user.username,
            display_name: user.display_name || user.username,
            avatar_url: user.avatar_url,
          },
        },
      });
      } catch (err) {
        fastify.log.error(err);
        socket.emit('error', { message: 'Failed to join voice channel' });
      }
    });

    socket.on('voice:leave', async (data?: { channel_id?: string }) => {
      try {
        const channelId = data?.channel_id || await redis.getUserVoiceChannel(userId);
        if (!channelId) return;

        const channel = await db.channels.findById(channelId);
        
        await redis.leaveVoiceChannel(userId);

        if (channel) {
          await publishEvent({
            type: 'voice.leave',
            actorId: userId,
            resourceId: `server:${channel.server_id}`,
            payload: {
              channel_id: channelId,
              user_id: userId,
            },
          });
        }
      } catch (err) {
        fastify.log.error(err);
      }
    });

    socket.on('voice:update', async (data: { muted?: boolean; deafened?: boolean }) => {
      try {
        const channelId = await redis.getUserVoiceChannel(userId);
        if (!channelId) return;

        const channel = await db.channels.findById(channelId);
        if (!channel) return;

        await redis.updateVoiceState(channelId, userId, {
          is_muted: data.muted,
          is_deafened: data.deafened,
        });

        await publishEvent({
          type: 'voice.state_update',
          actorId: userId,
          resourceId: `server:${channel.server_id}`,
          payload: {
            channel_id: channelId,
            user_id: userId,
            is_muted: data.muted ?? false,
            is_deafened: data.deafened ?? false,
          },
        });
      } catch (err) {
        fastify.log.error(err);
      }
    });

    // ── DM Events ─────────────────────────────────────────────

    socket.on('dm:send', async (data: {
      dm_channel_id: string;
      content: string;
      reply_to_id?: string;
      idempotency_key?: string;
    }) => {
      try {
        if (!data.content || data.content.trim().length === 0) {
          socket.emit('error', { message: 'Message cannot be empty' });
          return;
        }

        if (checkIdempotency(data.idempotency_key)) {
          return; // duplicate
        }

        const dmChannel = await db.dmChannels.findById(data.dm_channel_id);
        if (!dmChannel) return;

        if (dmChannel.user1_id !== userId && dmChannel.user2_id !== userId) {
          socket.emit('error', { message: 'Not a participant' });
          return;
        }

        const recipientId = dmChannel.user1_id === userId ? dmChannel.user2_id : dmChannel.user1_id;
        if (await isBlocked(userId, recipientId)) {
          socket.emit('error', { message: 'Cannot message this user' });
          return;
        }

        const message = await db.messages.create({
          dm_channel_id: data.dm_channel_id,
          author_id: userId,
          content: data.content,
          reply_to_id: data.reply_to_id,
          status: 'sent',
        });

        const author = await db.users.findById(userId);
        
        const formattedMessage = {
          id: message.id,
          dm_channel_id: message.dm_channel_id,
          content: message.content,
          author: {
            id: author.id,
            username: author.username,
            display_name: author.display_name || author.username,
            avatar_url: author.avatar_url,
          },
          created_at: message.created_at,
          edited_at: message.edited_at,
          attachments: message.attachments || [],
          reply_to_id: message.reply_to_id,
          status: message.status,
        };

        await publishEvent({
          type: 'dm.message.new',
          actorId: userId,
          resourceId: `dm:${data.dm_channel_id}`,
          payload: {
            from_user_id: userId,
            message: formattedMessage,
          },
        });

        // A4/A6: Create a notification for the DM recipient
        await createNotification({
          userId: recipientId,
          type: 'dm_message',
          data: {
            dm_channel_id: data.dm_channel_id,
            message_id: message.id,
            from_user: {
              id: author.id,
              username: author.username,
              display_name: author.display_name || author.username,
              avatar_url: author.avatar_url || null,
            },
            message_preview: data.content.slice(0, 100),
          },
        });
      } catch (err) {
        fastify.log.error(err);
        socket.emit('error', { message: 'Failed to send DM' });
      }
    });

    socket.on('dm:ack', async (data: { message_ids: string[] }) => {
      try {
        for (const messageId of data.message_ids) {
          await db.messages.updateStatus(messageId, 'received', new Date());
          
          const message = await db.messages.findById(messageId);
          if (message) {
            await publishEvent({
              type: 'dm.message.update',
              actorId: userId,
              resourceId: `user:${message.author_id}`,
              payload: {
                id: messageId,
                status: 'received',
                received_at: new Date().toISOString(),
              },
            });
          }
        }
      } catch (err) {
        fastify.log.error(err);
      }
    });

    // ── DM Typing Indicators ──────────────────────────────────
    
    const dmTypingTimeouts = new Map<string, NodeJS.Timeout>();

    socket.on('dm:typing:start', async (data: { user_id: string }) => {
      const targetUserId = data.user_id;
      const key = `dm:${userId}:${targetUserId}`;
      
      if (dmTypingTimeouts.has(key)) {
        clearTimeout(dmTypingTimeouts.get(key)!);
      }

      const dmChannel = await db.dmChannels.findByUsers(userId, targetUserId);
      if (!dmChannel) return;

      await publishEvent({
        type: 'typing.start',
        actorId: userId,
        resourceId: `user:${targetUserId}`,
        payload: { user_id: userId },
      });

      const timeout = setTimeout(async () => {
        await publishEvent({
          type: 'typing.stop',
          actorId: userId,
          resourceId: `user:${targetUserId}`,
          payload: { user_id: userId },
        });
        dmTypingTimeouts.delete(key);
      }, 5000);

      dmTypingTimeouts.set(key, timeout);
    });

    socket.on('dm:typing:stop', async (data: { user_id: string }) => {
      const targetUserId = data.user_id;
      const key = `dm:${userId}:${targetUserId}`;
      
      if (dmTypingTimeouts.has(key)) {
        clearTimeout(dmTypingTimeouts.get(key)!);
        dmTypingTimeouts.delete(key);
      }

      await publishEvent({
        type: 'typing.stop',
        actorId: userId,
        resourceId: `user:${targetUserId}`,
        payload: { user_id: userId },
      });
    });

    // ── DM Room Management ────────────────────────────────────

    socket.on('join:dm', async (data: { user_id: string }) => {
      const targetUserId = data.user_id;
      
      let dmChannel = await db.dmChannels.findByUsers(userId, targetUserId);
      if (dmChannel) {
        socket.join(`dm:${dmChannel.id}`);
      }
    });

    socket.on('leave:dm', async (data: { user_id: string }) => {
      const targetUserId = data.user_id;
      
      const dmChannel = await db.dmChannels.findByUsers(userId, targetUserId);
      if (dmChannel) {
        socket.leave(`dm:${dmChannel.id}`);
      }
    });

    // ── Disconnect ────────────────────────────────────────────

    socket.on('disconnect', async () => {
      fastify.log.info(`Socket disconnected: ${socket.data.user.username}`);

      // Clear heartbeat timer
      if (heartbeatTimer) clearTimeout(heartbeatTimer);

      // Clean up typing indicators
      for (const timeout of typingTimeouts.values()) {
        clearTimeout(timeout);
      }
      typingTimeouts.clear();

      for (const timeout of dmTypingTimeouts.values()) {
        clearTimeout(timeout);
      }
      dmTypingTimeouts.clear();

      // NOTE: We intentionally do NOT delete the gateway session here.
      // The session stays in Redis (with its TTL) so the client can
      // resume via gateway.resume if they reconnect quickly.
      // The session auto-expires after GATEWAY_SESSION_TTL (5 min).

      const currentUserStatus = await db.users.findById(userId);
      const wasInvisible = currentUserStatus?.status === 'offline';

      await redis.setPresence(userId, false);

      // Clean up voice state
      const voiceChannelId = await redis.getUserVoiceChannel(userId);
      if (voiceChannelId) {
        const voiceChannel = await db.channels.findById(voiceChannelId);
        await redis.leaveVoiceChannel(userId);
        
        if (voiceChannel) {
          await publishEvent({
            type: 'voice.leave',
            actorId: userId,
            resourceId: `server:${voiceChannel.server_id}`,
            payload: {
              channel_id: voiceChannelId,
              user_id: userId,
            },
          });
        }
      }

      await db.sql`UPDATE users SET last_seen_at = NOW() WHERE id = ${userId}`;

      if (!wasInvisible) {
        for (const server of servers) {
          await publishEvent({
            type: 'presence.update',
            actorId: userId,
            resourceId: `server:${server.id}`,
            payload: {
              user_id: userId,
              status: 'offline',
              last_seen_at: new Date().toISOString(),
            },
          });
        }
      }
    });
  });

  return io;
}
