import { randomUUID } from 'crypto';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { FastifyInstance } from 'fastify';
import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { publishEvent, getSequences, resyncEvents, onEvent } from '../lib/eventBus.js';
import { calculatePermissions } from '../services/permissions.js';
import {
  TextPermissions, hasPermission, MAX_MESSAGE_LENGTH,
  isEncryptedPayload, updateActivitySchema,
  PROTOCOL_VERSION, MIN_CLIENT_VERSION,
} from '@sgchat/shared';
import type { EventEnvelope, GatewayHello, GatewayReady, GatewayResume, GatewayResumed } from '@sgchat/shared';
import { isBlocked } from '../routes/friends.js';
import { createNotification } from '../routes/notifications.js';
import { processMentions } from '../services/mentions.js';
import { cancelPendingCreation } from '../services/tempChannelTimers.js';
import { markTempChannelEmpty } from '../services/tempChannels.js';
import { sanitizeContent, sanitizeMessage } from '../utils/sanitize.js';
import { resolveTextMentions } from '../utils/mentionResolver.js';
import { encryptPayload, decryptPayload } from '../plugins/cryptoPayload.js';
import { APP_VERSION } from '../lib/version.js';
import { parseCommand, executeCommand } from '../services/commands.js';
import { leaveAnyVoiceSession } from '../services/voiceCleanup.js';

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

// ── Socket event rate limiting ──────────────────────────────────
class SocketRateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  private cleanup = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of this.buckets) if (now > b.resetAt) this.buckets.delete(k);
  }, 60_000);

  check(key: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    const b = this.buckets.get(key);
    if (!b || now > b.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (b.count >= max) return false;
    b.count++;
    return true;
  }
}

const socketLimiter = new SocketRateLimiter();

const SOCKET_LIMITS = {
  'message:send':   { max: 5,  windowMs: 5_000 },
  'message:edit':   { max: 5,  windowMs: 10_000 },
  'message:delete': { max: 10, windowMs: 10_000 },
  'dm:send':        { max: 5,  windowMs: 5_000 },
  'typing:start':   { max: 5,  windowMs: 5_000 },
  'dm:typing:start':{ max: 5,  windowMs: 5_000 },
  'presence:update':{ max: 3,  windowMs: 10_000 },
  'status_comment:update': { max: 3, windowMs: 30_000 },
  'voice:join':     { max: 5,  windowMs: 30_000 },
  'voice:update':   { max: 10, windowMs: 10_000 },
  'activity:update':{ max: 3,  windowMs: 30_000 },
} as const;

const RATE_LIMIT_DISABLED = process.env.DISABLE_RATE_LIMIT === 'true';

function isRateLimited(socket: Socket, userId: string, event: keyof typeof SOCKET_LIMITS): boolean {
  if (RATE_LIMIT_DISABLED) return false;
  const cfg = SOCKET_LIMITS[event];
  if (!socketLimiter.check(`${userId}:${event}`, cfg.max, cfg.windowMs)) {
    socketEmit(socket, 'error', { message: 'Rate limit exceeded', code: 'RATE_LIMITED' });
    return true;
  }
  return false;
}

/**
 * Emit to a single socket with per-socket encryption when available.
 */
async function socketEmit(socket: Socket, event: string, payload: unknown): Promise<void> {
  if (socket.data.cryptoKeyHex) {
    try {
      const encrypted = await encryptPayload(JSON.stringify(payload), socket.data.cryptoKeyHex);
      socket.emit(event, encrypted);
    } catch {
      socket.emit(event, payload); // Fallback to unencrypted
    }
  } else {
    socket.emit(event, payload);
  }
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

      // Store crypto session key if client provides one
      const cryptoSessionId = socket.handshake.auth.cryptoSessionId;
      if (cryptoSessionId) {
        const session = await redis.getCryptoSession(cryptoSessionId);
        if (session) {
          socket.data.cryptoKeyHex = session.keyHex;
        }
      }

      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  // ── Subscribe to event bus and relay to Socket.IO rooms ─────
  onEvent(async (envelope: EventEnvelope) => {
    // Fetch all sockets in the room to handle per-socket encryption
    const sockets = await io.in(envelope.resource_id).fetchSockets();

    for (const s of sockets) {
      if (s.data.cryptoKeyHex) {
        // Encrypt payload for this socket's session key
        try {
          const encPayload = await encryptPayload(
            JSON.stringify(envelope.payload),
            s.data.cryptoKeyHex,
          );
          s.emit('event', { ...envelope, payload: encPayload });
          s.emit(envelope.type, encPayload);
        } catch {
          // Fallback to unencrypted on error
          s.emit('event', envelope);
          s.emit(envelope.type, envelope.payload);
        }
      } else {
        // Legacy unencrypted client
        s.emit('event', envelope);
        s.emit(envelope.type, envelope.payload);
      }
    }
  });

  // ── Connection handler ──────────────────────────────────────
  io.on('connection', async (socket: Socket) => {
    // ── Per-socket incoming event decryption ──────────────────
    // Uses socket.use() to transparently decrypt incoming event data
    // before handlers see it. socket.use() is Socket.IO's official
    // per-event middleware API.
    if (socket.data.cryptoKeyHex) {
      socket.use(async ([_event, ...args], next) => {
        if (args.length > 0 && isEncryptedPayload(args[0])) {
          try {
            const plaintext = await decryptPayload(args[0], socket.data.cryptoKeyHex);
            args[0] = JSON.parse(plaintext);
          } catch {
            socketEmit(socket, 'error', { message: 'Decryption failed', code: 'DECRYPT_ERROR' });
            return;
          }
        }
        next();
      });
    }
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
      server_version: APP_VERSION,
      protocol_version: PROTOCOL_VERSION,
      min_client_version: MIN_CLIENT_VERSION,
    };
    await socketEmit(socket, 'gateway.hello', helloPayload);

    // ── Send gateway.ready with current sequences ─────────────
    const sequences = await getSequences(subscriptions);
    const currentUser = await db.users.findById(userId);
    const storedStatus = currentUser?.status || 'offline';

    // Check if user has a pending approval (for access control)
    let pendingApproval = false;
    if (servers.length === 0) {
      const { isPendingApproval } = await import('../services/memberApprovals.js');
      const [defaultServer] = await db.sql`SELECT id FROM servers ORDER BY created_at ASC LIMIT 1`;
      if (defaultServer) {
        pendingApproval = await isPendingApproval(userId, defaultServer.id);
      }
    }

    const readyPayload: GatewayReady = {
      user: {
        id: userId,
        username: socket.data.user.username,
        status: storedStatus as any,
      },
      sequences,
      subscriptions,
      pending_approval: pendingApproval,
    } as any;
    await socketEmit(socket, 'gateway.ready', readyPayload);

    // ── Persist gateway session for resume support ────────────
    await redis.setGatewaySession(sessionId, userId, subscriptions);

    // ── Multi-session presence tracking ─────────────────────────
    // Track this socket session. Only broadcast online if this is the first session.
    const isFirstSession = await redis.addSession(userId, sessionId);

    if (storedStatus !== 'offline' && isFirstSession) {
      // Only broadcast presence.update when user first comes online
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
            activity: currentUser?.activity || null,
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

    socket.on('gateway.heartbeat', async () => {
      await socketEmit(socket, 'gateway.heartbeat_ack', { timestamp: new Date().toISOString() });
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
          await socketEmit(socket, 'gateway.resume_failed', {
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

        await socketEmit(socket, 'gateway.resumed', resumedPayload);
        fastify.log.info(
          `Session resumed for ${socket.data.user.username}: replayed ${missedEvents.length} events`
        );
      } catch (err) {
        fastify.log.error(err, 'Gateway resume failed');
        await socketEmit(socket, 'gateway.resume_failed', {
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
      is_tts?: boolean;
    }) => {
      try {
        if (isRateLimited(socket, userId, 'message:send')) return;

        // Update voice activity on message send
        redis.updateVoiceActivity(userId).catch(() => {});

        if (!data.content || data.content.trim().length === 0) {
          socketEmit(socket, 'error', { message: 'Message cannot be empty' });
          return;
        }

        if (data.content.length > MAX_MESSAGE_LENGTH) {
          socketEmit(socket, 'error', { message: `Message must be at most ${MAX_MESSAGE_LENGTH} characters` });
          return;
        }

        // Sanitize message content (strip HTML tags, preserve bare URLs)
        data.content = sanitizeMessage(data.content);
        if (data.content.trim().length === 0) {
          socketEmit(socket, 'error', { message: 'Message content is invalid' });
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
          socketEmit(socket, 'error', { message: 'Missing SEND_MESSAGES permission' });
          return;
        }

        // Auto-resolve plain @RoleName text into wire format <@&uuid>
        data.content = await resolveTextMentions(data.content, channel.server_id);

        // ── Slash command processing ──────────────────────────
        const parsed = parseCommand(data.content);
        if (parsed) {
          if (!hasPermission(perms.text, TextPermissions.USE_APPLICATION_COMMANDS)) {
            socketEmit(socket, 'error', { message: 'Missing USE_APPLICATION_COMMANDS permission' });
            return;
          }

          const cmdResult = await executeCommand(
            parsed.name,
            parsed.args,
            userId,
            data.channel_id,
            channel.server_id,
          );

          if (cmdResult) {
            if (cmdResult.ephemeral) {
              socketEmit(socket, 'command.response', {
                ephemeral: true,
                content: cmdResult.ephemeralText || '',
              });
              return;
            }
            if (cmdResult.content !== undefined) {
              data.content = cmdResult.content;
            }
          }
        }

        // Check TTS permission if message is TTS
        const isTts = data.is_tts && hasPermission(perms.text, TextPermissions.SEND_TTS_MESSAGES);

        const message = await db.messages.create({
          channel_id: data.channel_id,
          author_id: userId,
          content: data.content,
          reply_to_id: data.reply_to_id,
          status: 'sent',
          is_tts: isTts,
        });

        const author = await db.users.findById(userId);

        // Get the user's highest-position role color for this server
        const [roleColorRow] = await db.sql`
          SELECT r.color FROM roles r
          JOIN member_roles mr ON mr.role_id = r.id
          WHERE mr.member_user_id = ${userId}
            AND mr.member_server_id = ${channel.server_id}
            AND r.color IS NOT NULL
          ORDER BY r.position DESC
          LIMIT 1
        `;

        const formattedMessage = {
          id: message.id,
          channel_id: message.channel_id,
          content: message.content,
          author: {
            id: author.id,
            username: author.username,
            display_name: author.display_name || author.username,
            avatar_url: author.avatar_url,
            role_color: roleColorRow?.color || null,
          },
          created_at: message.created_at,
          edited_at: message.edited_at,
          attachments: message.attachments || [],
          reactions: [],
          reply_to_id: message.reply_to_id,
          is_tts: message.is_tts || false,
        };

        // Publish through the event bus (envelope + durable stream + pub/sub)
        await publishEvent({
          type: 'message.new',
          actorId: userId,
          resourceId: `channel:${data.channel_id}`,
          payload: formattedMessage,
        });

        // A6: Detect mentions (<@userId>, <@&roleId>, @here, @everyone) and notify
        const notifiedUserIds = await processMentions({
          content: data.content,
          messageId: message.id,
          channelId: data.channel_id,
          channelName: channel.name,
          serverId: channel.server_id,
          authorId: userId,
          authorUsername: author.username,
          authorAvatarUrl: author.avatar_url || null,
        });

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
        socketEmit(socket, 'error', { message: 'Failed to send message' });
      }
    });

    socket.on('message:edit', async (data: {
      message_id: string;
      content: string;
    }) => {
      try {
        if (isRateLimited(socket, userId, 'message:edit')) return;

        if (!data.content || data.content.trim().length === 0) {
          socketEmit(socket, 'error', { message: 'Message cannot be empty' });
          return;
        }

        if (data.content.length > MAX_MESSAGE_LENGTH) {
          socketEmit(socket, 'error', { message: `Message must be at most ${MAX_MESSAGE_LENGTH} characters` });
          return;
        }

        // Sanitize message content (strip HTML tags, preserve bare URLs)
        data.content = sanitizeMessage(data.content);
        if (data.content.trim().length === 0) {
          socketEmit(socket, 'error', { message: 'Message content is invalid' });
          return;
        }

        const message = await db.messages.findById(data.message_id);
        if (!message || message.author_id !== userId) {
          socketEmit(socket, 'error', { message: 'Cannot edit this message' });
          return;
        }

        // Auto-resolve plain @RoleName text into wire format <@&uuid>
        const editChannel = await db.channels.findById(message.channel_id);
        if (editChannel?.server_id) {
          data.content = await resolveTextMentions(data.content, editChannel.server_id);
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
        socketEmit(socket, 'error', { message: 'Failed to edit message' });
      }
    });

    socket.on('message:delete', async (data: { message_id: string }) => {
      try {
        if (isRateLimited(socket, userId, 'message:delete')) return;

        const message = await db.messages.findById(data.message_id);
        if (!message) return;

        let canDelete = message.author_id === userId;
        if (!canDelete && message.channel_id) {
          const channel = await db.channels.findById(message.channel_id);
          if (!channel) return;
          const perms = await calculatePermissions(userId, channel.server_id, message.channel_id);
          canDelete = hasPermission(perms.text, TextPermissions.MANAGE_MESSAGES);
        }

        if (!canDelete) {
          socketEmit(socket, 'error', { message: 'Cannot delete this message' });
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
        socketEmit(socket, 'error', { message: 'Failed to delete message' });
      }
    });

    // ── Typing Indicators ─────────────────────────────────────

    const typingTimeouts = new Map<string, NodeJS.Timeout>();

    // Handler for typing start (supports both dot and colon notation for backwards compat)
    const handleTypingStart = async (data: { channel_id: string }) => {
      if (isRateLimited(socket, userId, 'typing:start')) return;

      // Update voice activity on typing (user is active)
      redis.updateVoiceActivity(userId).catch(() => {});

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
    };

    // Handler for typing stop (supports both dot and colon notation for backwards compat)
    const handleTypingStop = async (data: { channel_id: string }) => {
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
    };

    // Register both event name formats for backwards compatibility
    socket.on('typing.start', handleTypingStart);
    socket.on('typing:start', handleTypingStart);
    socket.on('typing.stop', handleTypingStop);
    socket.on('typing:stop', handleTypingStop);

    // ── Presence Updates ──────────────────────────────────────

    socket.on('presence:update', async (data: { status: string }) => {
      if (isRateLimited(socket, userId, 'presence:update')) return;

      const validStatuses = ['online', 'idle', 'dnd', 'offline'];
      const status = validStatuses.includes(data.status) ? data.status : 'online';

      await db.users.updateStatus(userId, status);

      // Fetch current user data so custom_status is included in the broadcast
      const currentUserData = await db.users.findById(userId);

      for (const server of servers) {
        await publishEvent({
          type: 'presence.update',
          actorId: userId,
          resourceId: `server:${server.id}`,
          payload: {
            user_id: userId,
            status,
            custom_status: currentUserData?.custom_status || null,
            custom_status_emoji: currentUserData?.custom_status_emoji || null,
            activity: currentUserData?.activity || null,
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
        if (isRateLimited(socket, userId, 'status_comment:update')) return;

        // Validate & sanitize
        const sanitizedText = data.text
          ? sanitizeContent(data.text).replace(/\s+/g, ' ').trim().slice(0, 128)
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
        socketEmit(socket, 'error', { message: 'Failed to update status comment' });
      }
    });

    // ── Activity / Rich Presence ──────────────────────────────

    socket.on('activity:update', async (data: any) => {
      try {
        if (isRateLimited(socket, userId, 'activity:update')) return;

        const parsed = updateActivitySchema.safeParse(data);
        if (!parsed.success) {
          socketEmit(socket, 'error', { message: 'Invalid activity data' });
          return;
        }

        const activity = parsed.data;
        await db.sql`
          UPDATE users SET activity = ${JSON.stringify(activity)}, activity_updated_at = NOW()
          WHERE id = ${userId}
        `;

        for (const server of servers) {
          await publishEvent({
            type: 'activity.update',
            actorId: userId,
            resourceId: `server:${server.id}`,
            payload: { user_id: userId, activity },
          });
        }
      } catch (err) {
        fastify.log.error(err);
        socketEmit(socket, 'error', { message: 'Failed to update activity' });
      }
    });

    socket.on('activity:clear', async () => {
      try {
        if (isRateLimited(socket, userId, 'activity:update')) return;

        await db.sql`
          UPDATE users SET activity = NULL, activity_updated_at = NULL
          WHERE id = ${userId}
        `;

        for (const server of servers) {
          await publishEvent({
            type: 'activity.update',
            actorId: userId,
            resourceId: `server:${server.id}`,
            payload: { user_id: userId, activity: null },
          });
        }
      } catch (err) {
        fastify.log.error(err);
        socketEmit(socket, 'error', { message: 'Failed to clear activity' });
      }
    });

    // ── Voice State ───────────────────────────────────────────

    socket.on('voice:join', async (data: {
      channel_id: string;
      muted?: boolean;
      deafened?: boolean;
    }) => {
      try {
        if (isRateLimited(socket, userId, 'voice:join')) return;

        const channel = await db.channels.findById(data.channel_id);
        if (!channel) return;

        const voiceChannelTypes = ['voice', 'temp_voice', 'temp_voice_generator', 'music'];
        if (!voiceChannelTypes.includes(channel.type)) {
          socketEmit(socket, 'error', { message: 'Not a voice channel' });
          return;
        }

        // Note: The API route /voice/join/:channelId already handles:
        // - Permission checking
        // - User limit checking  
        // - Redis tracking (joinVoiceChannel)
        // - Publishing voice.join event
        //
        // This socket event is only used to update mute/deafen state after joining
        // We don't duplicate the join logic here to avoid race conditions
        
        if (data.muted !== undefined || data.deafened !== undefined) {
          await redis.updateVoiceState(data.channel_id, userId, {
            is_muted: data.muted,
            is_deafened: data.deafened,
          });
        }

        // Update voice activity on join
        await redis.updateVoiceActivity(userId);
      } catch (err) {
        fastify.log.error(err);
        socketEmit(socket, 'error', { message: 'Failed to update voice state' });
      }
    });

    // Voice activity ping (frontend sends this on user interaction while in voice)
    socket.on('voice:activity', async () => {
      try {
        await redis.updateVoiceActivity(userId);
      } catch (err) {
        // Silently ignore activity tracking errors
      }
    });

    socket.on('voice:leave', async (data?: { channel_id?: string }) => {
      try {
        // Cancel any pending temp channel creation
        cancelPendingCreation(userId);

        // Clear voice activity tracking
        await redis.clearVoiceActivity(userId);

        // Use the Redis-tracked channel as the source of truth (the client
        // may think it's still in an old channel after a force-move).
        const redisChannelId = await redis.getUserVoiceChannel(userId);
        const clientChannelId = data?.channel_id;
        const channelId = redisChannelId || clientChannelId;
        if (!channelId) return;

        const channel = await db.channels.findById(channelId);

        await redis.leaveVoiceChannel(userId);

        if (channel) {
          // Look up custom leave sound for the leaving user
          const leaveSound = await db.userVoiceSounds.findByUserServerType(userId, channel.server_id, 'leave');

          await publishEvent({
            type: 'voice.leave',
            actorId: userId,
            resourceId: `server:${channel.server_id}`,
            payload: {
              channel_id: channelId,
              user_id: userId,
              custom_sound_url: leaveSound?.sound_url || null,
            },
          });

          // If the client thought it was in a different channel (e.g. force-move
          // happened but the client didn't process it), also publish a leave for
          // that channel so all UIs clean up.
          if (clientChannelId && clientChannelId !== channelId) {
            const oldChannel = await db.channels.findById(clientChannelId);
            if (oldChannel) {
              await publishEvent({
                type: 'voice.leave',
                actorId: userId,
                resourceId: `server:${oldChannel.server_id}`,
                payload: {
                  channel_id: clientChannelId,
                  user_id: userId,
                  custom_sound_url: leaveSound?.sound_url || null,
                },
              });
            }
          }

          // Mark temp channel as empty if no participants remain
          if (channel.is_temp_channel) {
            const participants = await redis.getVoiceChannelParticipants(channelId);
            if (participants.length === 0) {
              await markTempChannelEmpty(channelId);
            }
          }
        }
      } catch (err) {
        fastify.log.error(err);
      }
    });

    socket.on('voice:update', async (data: { muted?: boolean; deafened?: boolean; screen_sharing?: boolean }) => {
      try {
        if (isRateLimited(socket, userId, 'voice:update')) return;

        const channelId = await redis.getUserVoiceChannel(userId);
        if (!channelId) return;

        const channel = await db.channels.findById(channelId);
        if (!channel) return;

        // Update voice activity (mute/deafen/stream toggle = user interaction)
        await redis.updateVoiceActivity(userId);

        // Only update fields that were explicitly provided
        const stateUpdates: { is_muted?: boolean; is_deafened?: boolean; is_streaming?: boolean } = {};
        if (data.muted !== undefined) stateUpdates.is_muted = data.muted;
        if (data.deafened !== undefined) stateUpdates.is_deafened = data.deafened;
        if (data.screen_sharing !== undefined) stateUpdates.is_streaming = data.screen_sharing;

        await redis.updateVoiceState(channelId, userId, stateUpdates);

        // Get current state to include in the event (for fields not being updated)
        const currentState = await redis.getVoiceState(channelId, userId);

        await publishEvent({
          type: 'voice.state_update',
          actorId: userId,
          resourceId: `server:${channel.server_id}`,
          payload: {
            channel_id: channelId,
            user_id: userId,
            is_muted: data.muted ?? currentState?.is_muted ?? false,
            is_deafened: data.deafened ?? currentState?.is_deafened ?? false,
            // Only include is_streaming if it was explicitly changed, otherwise use current state
            is_streaming: data.screen_sharing !== undefined
              ? data.screen_sharing
              : currentState?.is_streaming ?? false,
            voice_status: currentState?.voice_status ?? undefined,
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
        if (isRateLimited(socket, userId, 'dm:send')) return;

        if (!data.content || data.content.trim().length === 0) {
          socketEmit(socket, 'error', { message: 'Message cannot be empty' });
          return;
        }

        if (data.content.length > MAX_MESSAGE_LENGTH) {
          socketEmit(socket, 'error', { message: `Message must be at most ${MAX_MESSAGE_LENGTH} characters` });
          return;
        }

        // Sanitize message content (strip HTML tags, preserve bare URLs)
        data.content = sanitizeMessage(data.content);
        if (data.content.trim().length === 0) {
          socketEmit(socket, 'error', { message: 'Message content is invalid' });
          return;
        }

        if (checkIdempotency(data.idempotency_key)) {
          return; // duplicate
        }

        const dmChannel = await db.dmChannels.findById(data.dm_channel_id);
        if (!dmChannel) return;

        if (dmChannel.user1_id !== userId && dmChannel.user2_id !== userId) {
          socketEmit(socket, 'error', { message: 'Not a participant' });
          return;
        }

        const recipientId = dmChannel.user1_id === userId ? dmChannel.user2_id : dmChannel.user1_id;
        if (await isBlocked(userId, recipientId)) {
          socketEmit(socket, 'error', { message: 'Cannot message this user' });
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
        socketEmit(socket, 'error', { message: 'Failed to send DM' });
      }
    });

    socket.on('dm:ack', async (data: { message_ids: string[] }) => {
      try {
        const now = new Date();
        for (const messageId of data.message_ids) {
          const message = await db.messages.findById(messageId);
          if (!message || !message.dm_channel_id) continue;

          // Verify the current user is a participant in this DM channel
          const dmChannel = await db.dmChannels.findById(message.dm_channel_id);
          if (!dmChannel || (dmChannel.user1_id !== userId && dmChannel.user2_id !== userId)) continue;

          await db.messages.updateStatus(messageId, 'received', now);

          await publishEvent({
            type: 'dm.message.update',
            actorId: userId,
            resourceId: `user:${message.author_id}`,
            payload: {
              id: messageId,
              status: 'received',
              received_at: now.toISOString(),
            },
          });
        }
      } catch (err) {
        fastify.log.error(err);
      }
    });

    // ── DM Typing Indicators ──────────────────────────────────
    
    const dmTypingTimeouts = new Map<string, NodeJS.Timeout>();

    // Handler for DM typing start (supports both dot and colon notation)
    const handleDmTypingStart = async (data: { user_id: string }) => {
      if (isRateLimited(socket, userId, 'dm:typing:start')) return;

      const targetUserId = data.user_id;
      const key = `dm:${userId}:${targetUserId}`;
      
      if (dmTypingTimeouts.has(key)) {
        clearTimeout(dmTypingTimeouts.get(key)!);
      }

      const dmChannel = await db.dmChannels.findByUsers(userId, targetUserId);
      if (!dmChannel) return;

      await publishEvent({
        type: 'dm.typing.start',
        actorId: userId,
        resourceId: `user:${targetUserId}`,
        payload: { user_id: userId },
      });

      const timeout = setTimeout(async () => {
        await publishEvent({
          type: 'dm.typing.stop',
          actorId: userId,
          resourceId: `user:${targetUserId}`,
          payload: { user_id: userId },
        });
        dmTypingTimeouts.delete(key);
      }, 5000);

      dmTypingTimeouts.set(key, timeout);
    };

    // Handler for DM typing stop (supports both dot and colon notation)
    const handleDmTypingStop = async (data: { user_id: string }) => {
      const targetUserId = data.user_id;
      const key = `dm:${userId}:${targetUserId}`;
      
      if (dmTypingTimeouts.has(key)) {
        clearTimeout(dmTypingTimeouts.get(key)!);
        dmTypingTimeouts.delete(key);
      }

      await publishEvent({
        type: 'dm.typing.stop',
        actorId: userId,
        resourceId: `user:${targetUserId}`,
        payload: { user_id: userId },
      });
    };

    // Register both event name formats for backwards compatibility
    socket.on('dm.typing.start', handleDmTypingStart);
    socket.on('dm:typing:start', handleDmTypingStart);
    socket.on('dm.typing.stop', handleDmTypingStop);
    socket.on('dm:typing:stop', handleDmTypingStop);

    // ── DM Room Management ────────────────────────────────────

    socket.on('join:dm', async (data: { user_id: string }) => {
      const targetUserId = data.user_id;
      
      const dmChannel = await db.dmChannels.findByUsers(userId, targetUserId);
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
      fastify.log.info(`Socket disconnected: ${socket.data.user.username} session=${sessionId}`);

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

      // Remove this session from presence tracking.
      // Only broadcast offline if this was the user's LAST session.
      const isLastSession = await redis.removeSession(userId, sessionId);

      // Cancel any pending temp channel creation
      cancelPendingCreation(userId);

      // Clean up voice state (server voice channels AND DM calls)
      await leaveAnyVoiceSession(userId);

      await db.sql`UPDATE users SET last_seen_at = NOW() WHERE id = ${userId}`;

      // Persist offline status to DB and broadcast if this was the last session
      if (isLastSession) {
        await db.users.updateStatus(userId, 'offline');

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
      }
    });
  });

  return io;
}
