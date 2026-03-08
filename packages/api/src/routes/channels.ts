import { FastifyPluginAsync } from 'fastify';
import { createHash } from 'crypto';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { canAccessChannel, calculatePermissions } from '../services/permissions.js';
import { publishEvent } from '../lib/eventBus.js';
import { createNotification } from './notifications.js';
import { processMentions } from '../services/mentions.js';
import { ServerPermissions, TextPermissions, hasPermission, sendMessageSchema, channelNotificationSettingsSchema } from '@sgchat/shared';
import { notFound, forbidden, badRequest } from '../utils/errors.js';
import { storage } from '../lib/storage.js';
import { sanitizeMessage } from '../utils/sanitize.js';
import { resolveTextMentions } from '../utils/mentionResolver.js';
import { parseCommand, executeCommand, getBuiltinCommands } from '../services/commands.js';
import { z } from 'zod';
import {
  getChannelStorageStats,
  getSegmentsForChannel,
  getOrCreateSegment,
  onMessageCreated,
} from '../services/segmentation.js';
import {
  getEffectiveChannelRetention,
  applyRetentionPolicy,
  applySizeLimitPolicy,
} from '../services/trimming.js';
import { loadArchivedMessages } from '../services/archive.js';
import { emitEncrypted } from '../lib/socketEmit.js';

// ── A1: Idempotency dedup cache (in-memory, per-process) ──────
const idempotencyCache = new Map<string, { timestamp: number; result: any }>();
const IDEMPOTENCY_TTL = 5 * 60 * 1000; // 5 minutes

// Cleanup stale idempotency keys every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of idempotencyCache) {
    if (now - entry.timestamp > IDEMPOTENCY_TTL) idempotencyCache.delete(key);
  }
}, 60_000);

const updateChannelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  topic: z.string().max(1024).nullable().optional(),
  position: z.number().min(0).optional(),
  bitrate: z.number().min(8000).max(384000).optional(), // voice only
  user_limit: z.number().min(0).max(99).optional(), // voice only
  is_afk_channel: z.boolean().optional(), // voice only
});

const reorderChannelsSchema = z.object({
  channels: z.array(z.object({
    id: z.string().uuid(),
    position: z.number().min(0),
  })),
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const channelRoutes: FastifyPluginAsync = async (fastify) => {
  // Get available slash commands (for autocomplete)
  fastify.get('/commands', {
    onRequest: [authenticate],
    handler: async () => {
      return getBuiltinCommands();
    },
  });

  // Get channel by ID
  fastify.get('/:id', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };

      if (!UUID_REGEX.test(id)) {
        return badRequest(reply, 'Invalid channel ID');
      }

      const canAccess = await canAccessChannel(request.user!.id, id);
      if (!canAccess) {
        return forbidden(reply, 'Cannot access this channel');
      }

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }
      return channel;
    },
  });

  // Get channel messages with full author info and reactions (A1: includes sequence metadata)
  fastify.get('/:id/messages', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const { limit, before } = request.query as { limit?: string; before?: string };
      const currentUserId = request.user!.id;

      if (!UUID_REGEX.test(id)) {
        return badRequest(reply, 'Invalid channel ID');
      }

      const canAccess = await canAccessChannel(currentUserId, id);
      if (!canAccess) {
        return forbidden(reply, 'Cannot access this channel');
      }

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }
      const perms = await calculatePermissions(currentUserId, channel.server_id, id);

      if (!hasPermission(perms.text, TextPermissions.READ_MESSAGE_HISTORY)) {
        return forbidden(reply, 'Missing READ_MESSAGE_HISTORY permission');
      }

      // Get messages with full author info (include display_name)
      const maxLimit = Math.min(parseInt(limit || '50') || 50, 100);
      let messages;

      // Subquery to get the highest-positioned role color for a user in this server
      const serverId = channel.server_id;

      if (before) {
        messages = await db.sql`
          SELECT 
            m.id,
            m.content,
            m.created_at,
            m.edited_at,
            m.attachments,
            m.reply_to_id,
            m.system_event,
            u.id as author_id,
            u.username as author_username,
            u.display_name as author_display_name,
            u.avatar_url as author_avatar_url,
            (
              SELECT r.color FROM roles r
              JOIN member_roles mr ON mr.role_id = r.id
              WHERE mr.member_user_id = u.id 
                AND mr.member_server_id = ${serverId}
                AND r.color IS NOT NULL
              ORDER BY r.position DESC
              LIMIT 1
            ) as author_role_color
          FROM messages m
          LEFT JOIN users u ON m.author_id = u.id
          WHERE m.channel_id = ${id}
            AND m.created_at < (SELECT created_at FROM messages WHERE id = ${before})
          ORDER BY m.created_at DESC
          LIMIT ${maxLimit}
        `;
      } else {
        messages = await db.sql`
          SELECT 
            m.id,
            m.content,
            m.created_at,
            m.edited_at,
            m.attachments,
            m.reply_to_id,
            m.system_event,
            u.id as author_id,
            u.username as author_username,
            u.display_name as author_display_name,
            u.avatar_url as author_avatar_url,
            (
              SELECT r.color FROM roles r
              JOIN member_roles mr ON mr.role_id = r.id
              WHERE mr.member_user_id = u.id 
                AND mr.member_server_id = ${serverId}
                AND r.color IS NOT NULL
              ORDER BY r.position DESC
              LIMIT 1
            ) as author_role_color
          FROM messages m
          LEFT JOIN users u ON m.author_id = u.id
          WHERE m.channel_id = ${id}
          ORDER BY m.created_at DESC
          LIMIT ${maxLimit}
        `;
      }

      // Get reactions for all messages
      const messageIds = messages.map((m: any) => m.id);
      const reactionsMap: Map<string, any[]> = new Map();

      if (messageIds.length > 0) {
        const reactions = await db.sql`
          SELECT
            mr.message_id,
            mr.reaction_type as type,
            mr.unicode_emoji as emoji,
            mr.custom_emoji_id as "emojiId",
            mr.user_id,
            ${currentUserId} = mr.user_id as me
          FROM message_reactions mr
          WHERE mr.message_id = ANY(${messageIds})
          ORDER BY mr.created_at ASC
        `;

        // Group reactions by message and type
        for (const r of reactions) {
          if (!reactionsMap.has(r.message_id)) {
            reactionsMap.set(r.message_id, []);
          }
          const msgReactions = reactionsMap.get(r.message_id)!;
          let reactionAgg = msgReactions.find(er => {
            if (er.type === 'unicode') return r.type === 'unicode' && er.emoji === r.emoji;
            return r.type === 'custom' && er.emojiId === r.emojiId;
          });
          if (!reactionAgg) {
            reactionAgg = {
              type: r.type,
              emoji: r.emoji || undefined,
              emojiId: r.emojiId || undefined,
              count: 0,
              users: [],
              me: false,
            };
            msgReactions.push(reactionAgg);
          }
          reactionAgg.count++;
          reactionAgg.users.push(r.user_id);
          if (r.me) reactionAgg.me = true;
        }

        // Enrich custom emoji reactions with url/shortcode
        const allCustomEmojiIds = new Set<string>();
        for (const msgReactions of reactionsMap.values()) {
          for (const r of msgReactions) {
            if (r.type === 'custom' && r.emojiId) allCustomEmojiIds.add(r.emojiId);
          }
        }
        if (allCustomEmojiIds.size > 0) {
          const emojiIds = [...allCustomEmojiIds];
          const emojiRows = await db.sql`SELECT id, shortcode, asset_key, is_animated FROM emojis WHERE id = ANY(${emojiIds})`;
          const emojiMap = new Map(emojiRows.map((e: any) => [e.id, e]));
          for (const msgReactions of reactionsMap.values()) {
            for (const r of msgReactions) {
              if (r.type === 'custom' && r.emojiId) {
                const emoji = emojiMap.get(r.emojiId);
                if (emoji) {
                  r.shortcode = emoji.shortcode;
                  r.url = emoji.asset_key ? storage.getPublicUrl(emoji.asset_key) : undefined;
                  r.is_animated = emoji.is_animated;
                }
              }
            }
          }
        }
      }

      // Format response
      const formattedMessages = messages.reverse().map((m: any) => ({
        id: m.id,
        channel_id: id,
        content: m.content,
        author: {
          id: m.author_id,
          username: m.author_username,
          display_name: m.author_display_name || m.author_username,
          avatar_url: m.author_avatar_url,
          role_color: m.author_role_color || null,
        },
        created_at: m.created_at,
        edited_at: m.edited_at,
        attachments: m.attachments || [],
        reply_to_id: m.reply_to_id,
        reactions: reactionsMap.get(m.id) || [],
        system_event: m.system_event || null,
        is_tts: m.is_tts || false,
      }));

      // Compute channel hash based on last message ID and count for cache validation
      const lastMessageId = formattedMessages.length > 0 
        ? formattedMessages[formattedMessages.length - 1].id 
        : 'empty';
      const channelHash = createHash('md5')
        .update(`${lastMessageId}:${formattedMessages.length}`)
        .digest('hex')
        .slice(0, 16);

      // Check If-None-Match header for conditional request
      const clientHash = request.headers['if-none-match'];
      if (clientHash === channelHash) {
        return reply.status(304).send();
      }

      // Set ETag header and return with hash in body
      reply.header('ETag', channelHash);
      return { messages: formattedMessages, hash: channelHash };
    },
  });

  // Send message to channel (A1: publishEvent + Idempotency-Key)
  fastify.post('/:id/messages', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 5, timeWindow: '5 seconds' },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = sendMessageSchema.parse(request.body);

      // ── A1: Idempotency-Key header ──────────────────────────
      const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
      if (idempotencyKey) {
        const cached = idempotencyCache.get(idempotencyKey);
        if (cached) {
          // Return the original response for duplicate requests
          return cached.result;
        }
      }

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id, id);

      // For announcement channels, only users with Administrator permission can post
      if (channel.type === 'announcement') {
        if (!hasPermission(perms.server, ServerPermissions.ADMINISTRATOR)) {
          return forbidden(reply, 'Only administrators can post in announcement channels');
        }
      } else {
        // For regular channels, check SEND_MESSAGES permission
        if (!hasPermission(perms.text, TextPermissions.SEND_MESSAGES)) {
          return forbidden(reply, 'Missing SEND_MESSAGES permission');
        }
      }

      // Sanitize message content (strip HTML tags — defense-in-depth)
      body.content = sanitizeMessage(body.content);

      // Auto-resolve plain @RoleName text into wire format <@&uuid>
      body.content = await resolveTextMentions(body.content, channel.server_id);

      // ── Slash command processing ──────────────────────────
      const parsed = parseCommand(body.content);
      if (parsed) {
        // Check USE_APPLICATION_COMMANDS permission
        if (!hasPermission(perms.text, TextPermissions.USE_APPLICATION_COMMANDS)) {
          return forbidden(reply, 'Missing USE_APPLICATION_COMMANDS permission');
        }

        const cmdResult = await executeCommand(
          parsed.name,
          parsed.args,
          request.user!.id,
          id,
          channel.server_id,
        );

        if (cmdResult) {
          // Ephemeral commands: return response without creating a message
          if (cmdResult.ephemeral) {
            return { ephemeral: true, content: cmdResult.ephemeralText || '' };
          }

          // Text-replacement commands: swap the content and continue to message creation
          if (cmdResult.content !== undefined) {
            body.content = cmdResult.content;
          }
        }
      }

      // Check TTS permission if message is TTS
      if (body.is_tts && !hasPermission(perms.text, TextPermissions.SEND_TTS_MESSAGES)) {
        return forbidden(reply, 'Missing SEND_TTS_MESSAGES permission');
      }

      const message = await db.messages.create({
        channel_id: id,
        author_id: request.user!.id,
        content: body.content,
        attachments: body.attachments,
        reply_to_id: body.reply_to_id,
        queued_at: body.queued_at ? new Date(body.queued_at) : undefined,
        is_tts: body.is_tts,
      });

      // Assign message to a segment for history management
      try {
        const segment = await getOrCreateSegment(id, null, new Date(message.created_at));
        await db.sql`UPDATE messages SET segment_id = ${segment.id} WHERE id = ${message.id}`;
        await onMessageCreated(segment.id, body.content, body.attachments || []);
      } catch (segmentError) {
        // Log but don't fail the message creation
        console.error('Failed to assign message to segment:', segmentError);
      }

      // Get author info for response
      const author = await db.users.findById(request.user!.id);

      // Look up stickers if provided
      let stickers: any[] = [];
      if (body.sticker_ids && body.sticker_ids.length > 0) {
        stickers = await db.stickers.findByIds(body.sticker_ids);
      }

      // Format response with full author object
      const formattedMessage: Record<string, any> = {
        id: message.id,
        channel_id: id,
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
        reply_to_id: message.reply_to_id || null,
        is_tts: message.is_tts || false,
        ...(stickers.length > 0 ? { stickers } : {}),
      };

      // ── A1: Publish through event bus (envelope + durable stream + pub/sub)
      // This replaces the direct fastify.io.emit call so that all delivery
      // paths (WS, SSE, resync) receive the event with proper sequencing.
      await publishEvent({
        type: 'message.new',
        actorId: request.user!.id,
        resourceId: `channel:${id}`,
        payload: formattedMessage,
      });

      // ── A6: Detect mentions and create notifications ──
      const currentUserId = request.user!.id;
      const notifiedUserIds = await processMentions({
        content: body.content,
        messageId: message.id,
        channelId: id,
        channelName: channel.name,
        serverId: channel.server_id,
        authorId: currentUserId,
        authorUsername: author.username,
        authorAvatarUrl: author.avatar_url || null,
      });

      // A6: Notify the author of the message being replied to
      if (body.reply_to_id) {
        const repliedMessage = await db.messages.findById(body.reply_to_id);
        if (
          repliedMessage &&
          repliedMessage.author_id &&
          repliedMessage.author_id !== currentUserId &&
          !notifiedUserIds.has(repliedMessage.author_id)
        ) {
          await createNotification({
            userId: repliedMessage.author_id,
            type: 'mention',
            priority: 'high',
            data: {
              channel_id: id,
              channel_name: channel.name,
              server_id: channel.server_id,
              message_id: message.id,
              reply_to_id: body.reply_to_id,
              from_user: {
                id: author.id,
                username: author.username,
                avatar_url: author.avatar_url || null,
              },
              message_preview: body.content.slice(0, 100),
            },
          });
        }
      }

      // ── A1: Cache result for idempotency ────────────────────
      if (idempotencyKey) {
        idempotencyCache.set(idempotencyKey, {
          timestamp: Date.now(),
          result: formattedMessage,
        });
      }

      return formattedMessage;
    },
  });

  // Update channel bitrate (voice channels)
  fastify.patch('/:id/bitrate', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const { bitrate } = request.body as { bitrate: number };

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }
      if (channel.type !== 'voice') {
        return badRequest(reply, 'Not a voice channel');
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id);
      // Moderators can adjust bitrate - check for either MANAGE_CHANNELS or MOVE_MEMBERS voice permission
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_CHANNELS)) {
        return forbidden(reply, 'Missing MANAGE_CHANNELS permission');
      }

      await db.channels.updateBitrate(id, bitrate);
      return { bitrate };
    },
  });

  // ============================================================
  // CHANNEL MANAGEMENT (Phase 4)
  // ============================================================

  // Update channel
  fastify.patch('/:id', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = updateChannelSchema.parse(request.body);

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_CHANNELS)) {
        return forbidden(reply, 'Missing MANAGE_CHANNELS permission');
      }

      // Build updates - filter voice-only properties for text channels
      const updates: Record<string, any> = {};
      if (body.name !== undefined) updates.name = body.name;
      if ('topic' in body) updates.topic = body.topic;
      if (body.position !== undefined) updates.position = body.position;

      // Voice channel specific
      if (channel.type === 'voice') {
        if (body.bitrate !== undefined) updates.bitrate = body.bitrate;
        if (body.user_limit !== undefined) updates.user_limit = body.user_limit;
        if (body.is_afk_channel !== undefined) updates.is_afk_channel = body.is_afk_channel;
      }

      if (Object.keys(updates).length === 0) {
        return badRequest(reply, 'No updates provided');
      }

      await db.sql`
        UPDATE channels
        SET ${db.sql(updates)}
        WHERE id = ${id}
      `;

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (${channel.server_id}, ${request.user!.id}, 'channel_update', 'channel', ${id}, ${JSON.stringify({ updates })})
      `;

      const updatedChannel = await db.channels.findById(id);
      await emitEncrypted(fastify.io, `server:${channel.server_id}`, 'channel.update', updatedChannel);

      return updatedChannel;
    },
  });

  // Delete channel
  fastify.delete('/:id', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_CHANNELS)) {
        return forbidden(reply, 'Missing MANAGE_CHANNELS permission');
      }

      // Check this isn't the last channel
      const channels = await db.channels.findByServerId(channel.server_id);
      if (channels.length <= 1) {
        return badRequest(reply, 'Cannot delete the last channel in a server');
      }

      // Don't allow deleting the welcome channel
      const [server] = await db.sql`SELECT welcome_channel_id FROM servers WHERE id = ${channel.server_id}`;
      if (server?.welcome_channel_id === id) {
        return badRequest(reply, 'Cannot delete the welcome channel');
      }

      await db.sql`DELETE FROM channels WHERE id = ${id}`;

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (${channel.server_id}, ${request.user!.id}, 'channel_delete', 'channel', ${id}, ${JSON.stringify({ deleted: channel })})
      `;

      await emitEncrypted(fastify.io, `server:${channel.server_id}`, 'channel.delete', { id, server_id: channel.server_id });

      return { message: 'Channel deleted' };
    },
  });

  // Reorder channels
  fastify.patch('/:id/reorder', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string }; // This is the server ID

      const body = reorderChannelsSchema.parse(request.body);

      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_CHANNELS)) {
        return forbidden(reply, 'Missing MANAGE_CHANNELS permission');
      }

      // Verify all channels belong to this server
      const serverChannels = await db.channels.findByServerId(id);
      const channelIds = new Set(serverChannels.map(c => c.id));

      for (const { id: channelId } of body.channels) {
        if (!channelIds.has(channelId)) {
          return badRequest(reply, `Channel ${channelId} not in this server`);
        }
      }

      // Update positions
      for (const { id: channelId, position } of body.channels) {
        await db.sql`
          UPDATE channels
          SET position = ${position}
          WHERE id = ${channelId}
        `;
      }

      const updatedChannels = await db.channels.findByServerId(id);
      await emitEncrypted(fastify.io, `server:${id}`, 'channels.reorder', updatedChannels);

      return updatedChannels;
    },
  });

  /**
   * POST /channels/:id/ack - Mark channel as read up to a message
   * Body: { message_id?: string } - If no message_id, marks all as read
   */
  fastify.post<{ Params: { id: string } }>('/:id/ack', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 60, timeWindow: '1 minute' },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const { message_id } = (request.body as { message_id?: string }) || {};

      const canAccess = await canAccessChannel(request.user!.id, id);
      if (!canAccess) {
        return forbidden(reply, 'Cannot access this channel');
      }

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      // If message_id provided, use it; otherwise find the latest message
      let lastMessageId = message_id;
      if (!lastMessageId) {
        const [latest] = await db.sql`
          SELECT id FROM messages WHERE channel_id = ${id} ORDER BY created_at DESC LIMIT 1
        `;
        lastMessageId = latest?.id;
      }

      if (!lastMessageId) {
        // No messages in channel, nothing to ack
        return { last_read_message_id: null, unread_count: 0 };
      }

      // Upsert channel read state
      await db.sql`
        INSERT INTO channel_read_state (channel_id, user_id, last_read_message_id, last_read_at)
        VALUES (${id}, ${request.user!.id}, ${lastMessageId}, NOW())
        ON CONFLICT (channel_id, user_id)
        DO UPDATE SET last_read_message_id = ${lastMessageId}, last_read_at = NOW()
      `;

      return { last_read_message_id: lastMessageId, unread_count: 0 };
    },
  });

  /**
   * GET /channels/:id/read-state - Get read state for a channel
   */
  fastify.get<{ Params: { id: string } }>('/:id/read-state', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;

      const canAccess = await canAccessChannel(request.user!.id, id);
      if (!canAccess) {
        return forbidden(reply, 'Cannot access this channel');
      }

      // Get read state
      const [readState] = await db.sql`
        SELECT last_read_message_id, last_read_at
        FROM channel_read_state
        WHERE channel_id = ${id} AND user_id = ${request.user!.id}
      `;

      // Count unread messages
      let unreadCount = 0;
      if (readState?.last_read_message_id) {
        const [result] = await db.sql`
          SELECT COUNT(*)::int as count FROM messages
          WHERE channel_id = ${id}
            AND created_at > (SELECT created_at FROM messages WHERE id = ${readState.last_read_message_id})
        `;
        unreadCount = result?.count || 0;
      } else {
        // No read state = all messages are unread
        const [result] = await db.sql`
          SELECT COUNT(*)::int as count FROM messages WHERE channel_id = ${id}
        `;
        unreadCount = result?.count || 0;
      }

      return {
        last_read_message_id: readState?.last_read_message_id || null,
        last_read_at: readState?.last_read_at || null,
        unread_count: unreadCount,
      };
    },
  });

  /**
   * GET /channels/:id/voice-participants - Get list of users in a voice channel
   */
  fastify.get<{ Params: { id: string } }>('/:id/voice-participants', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      // Allow voice, temp_voice, and music channels
      if (channel.type !== 'voice' && channel.type !== 'temp_voice' && channel.type !== 'music') {
        return badRequest(reply, 'Not a voice channel');
      }

      const canAccess = await canAccessChannel(request.user!.id, id);
      if (!canAccess) {
        return forbidden(reply, 'Cannot access this channel');
      }

      // Get participant user IDs from Redis
      const { redis } = await import('../lib/redis.js');
      const participantIds = await redis.getVoiceChannelParticipants(id);

      if (participantIds.length === 0) {
        return { participants: [] };
      }

      // Get user details and voice states for each participant
      const participants = await Promise.all(participantIds.map(async (userId) => {
        const user = await db.users.findById(userId);
        const voiceState = await redis.getVoiceState(id, userId);

        return {
          user_id: userId,
          username: user?.username || 'Unknown',
          display_name: user?.display_name || user?.username || 'Unknown',
          avatar_url: user?.avatar_url || null,
          is_muted: voiceState?.is_muted || false,
          is_deafened: voiceState?.is_deafened || false,
          joined_at: voiceState?.joined_at || new Date().toISOString(),
          voice_status: voiceState?.voice_status || undefined,
        };
      }));

      return { participants };
    },
  });

  // ============================================================
  // CHANNEL PERMISSION OVERRIDES
  // ============================================================

  /**
   * GET /channels/:id/permissions - List permission overrides for a channel
   */
  fastify.get<{ Params: { id: string } }>('/:id/permissions', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_CHANNELS)) {
        return forbidden(reply, 'Missing MANAGE_CHANNELS permission');
      }

      const overrides = await db.sql`
        SELECT 
          cpo.id,
          cpo.channel_id,
          cpo.role_id,
          cpo.user_id,
          cpo.text_allow,
          cpo.text_deny,
          cpo.voice_allow,
          cpo.voice_deny,
          r.name as role_name,
          r.color as role_color,
          u.username as user_username,
          u.avatar_url as user_avatar_url
        FROM channel_permission_overrides cpo
        LEFT JOIN roles r ON cpo.role_id = r.id
        LEFT JOIN users u ON cpo.user_id = u.id
        WHERE cpo.channel_id = ${id}
        ORDER BY r.position DESC NULLS LAST, u.username ASC
      `;

      return {
        overrides: overrides.map((o: any) => ({
          id: o.id,
          channel_id: o.channel_id,
          type: o.role_id ? 'role' : 'user',
          target_id: o.role_id || o.user_id,
          target_name: o.role_name || o.user_username,
          target_color: o.role_color || null,
          target_avatar: o.user_avatar_url || null,
          text_allow: o.text_allow,
          text_deny: o.text_deny,
          voice_allow: o.voice_allow,
          voice_deny: o.voice_deny,
        })),
      };
    },
  });

  /**
   * PUT /channels/:id/permissions/roles/:roleId - Set role permission override
   */
  fastify.put<{ Params: { id: string; roleId: string } }>('/:id/permissions/roles/:roleId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, roleId } = request.params;
      const body = request.body as {
        text_allow?: string;
        text_deny?: string;
        voice_allow?: string;
        voice_deny?: string;
      };

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_CHANNELS)) {
        return forbidden(reply, 'Missing MANAGE_CHANNELS permission');
      }

      // Verify role exists and belongs to this server
      const [role] = await db.sql`
        SELECT id FROM roles WHERE id = ${roleId} AND server_id = ${channel.server_id}
      `;
      if (!role) {
        return notFound(reply, 'Role');
      }

      // Upsert the override
      const [override] = await db.sql`
        INSERT INTO channel_permission_overrides (
          channel_id, role_id, text_allow, text_deny, voice_allow, voice_deny
        )
        VALUES (
          ${id}, 
          ${roleId}, 
          ${body.text_allow || '0'}, 
          ${body.text_deny || '0'},
          ${body.voice_allow || '0'},
          ${body.voice_deny || '0'}
        )
        ON CONFLICT (channel_id, role_id)
        DO UPDATE SET
          text_allow = ${body.text_allow || '0'},
          text_deny = ${body.text_deny || '0'},
          voice_allow = ${body.voice_allow || '0'},
          voice_deny = ${body.voice_deny || '0'}
        RETURNING *
      `;

      // Emit socket event
      await emitEncrypted(fastify.io, `server:${channel.server_id}`, 'channel.permissions.update', {
        channel_id: id,
        type: 'role',
        target_id: roleId,
      });

      return override;
    },
  });

  /**
   * PUT /channels/:id/permissions/users/:userId - Set user permission override
   */
  fastify.put<{ Params: { id: string; userId: string } }>('/:id/permissions/users/:userId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, userId } = request.params;
      const body = request.body as {
        text_allow?: string;
        text_deny?: string;
        voice_allow?: string;
        voice_deny?: string;
      };

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_CHANNELS)) {
        return forbidden(reply, 'Missing MANAGE_CHANNELS permission');
      }

      // Verify user is a member of this server
      const member = await db.members.findByUserAndServer(userId, channel.server_id);
      if (!member) {
        return notFound(reply, 'Member');
      }

      // Upsert the override
      const [override] = await db.sql`
        INSERT INTO channel_permission_overrides (
          channel_id, user_id, text_allow, text_deny, voice_allow, voice_deny
        )
        VALUES (
          ${id}, 
          ${userId}, 
          ${body.text_allow || '0'}, 
          ${body.text_deny || '0'},
          ${body.voice_allow || '0'},
          ${body.voice_deny || '0'}
        )
        ON CONFLICT (channel_id, user_id)
        DO UPDATE SET
          text_allow = ${body.text_allow || '0'},
          text_deny = ${body.text_deny || '0'},
          voice_allow = ${body.voice_allow || '0'},
          voice_deny = ${body.voice_deny || '0'}
        RETURNING *
      `;

      // Emit socket event
      await emitEncrypted(fastify.io, `server:${channel.server_id}`, 'channel.permissions.update', {
        channel_id: id,
        type: 'user',
        target_id: userId,
      });

      return override;
    },
  });

  /**
   * DELETE /channels/:id/permissions/roles/:roleId - Remove role permission override
   */
  fastify.delete<{ Params: { id: string; roleId: string } }>('/:id/permissions/roles/:roleId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, roleId } = request.params;

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_CHANNELS)) {
        return forbidden(reply, 'Missing MANAGE_CHANNELS permission');
      }

      await db.sql`
        DELETE FROM channel_permission_overrides
        WHERE channel_id = ${id} AND role_id = ${roleId}
      `;

      // Emit socket event
      await emitEncrypted(fastify.io, `server:${channel.server_id}`, 'channel.permissions.delete', {
        channel_id: id,
        type: 'role',
        target_id: roleId,
      });

      return { message: 'Permission override removed' };
    },
  });

  /**
   * DELETE /channels/:id/permissions/users/:userId - Remove user permission override
   */
  fastify.delete<{ Params: { id: string; userId: string } }>('/:id/permissions/users/:userId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, userId } = request.params;

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_CHANNELS)) {
        return forbidden(reply, 'Missing MANAGE_CHANNELS permission');
      }

      await db.sql`
        DELETE FROM channel_permission_overrides
        WHERE channel_id = ${id} AND user_id = ${userId}
      `;

      // Emit socket event
      await emitEncrypted(fastify.io, `server:${channel.server_id}`, 'channel.permissions.delete', {
        channel_id: id,
        type: 'user',
        target_id: userId,
      });

      return { message: 'Permission override removed' };
    },
  });

  // ============================================================
  // MESSAGE SEARCH
  // ============================================================

  /**
   * GET /channels/:id/messages/search - Search messages within a channel
   */
  fastify.get<{ Params: { id: string } }>('/:id/messages/search', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 10, timeWindow: '60 seconds' },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const {
        q,
        author_id,
        before,
        after,
        has_attachment,
        pinned,
        limit: limitStr,
        offset: offsetStr,
      } = request.query as {
        q?: string;
        author_id?: string;
        before?: string;
        after?: string;
        has_attachment?: string;
        pinned?: string;
        limit?: string;
        offset?: string;
      };

      if (!UUID_REGEX.test(id)) {
        return badRequest(reply, 'Invalid channel ID');
      }

      if (!q || q.trim().length < 2) {
        return badRequest(reply, 'Search query must be at least 2 characters');
      }

      const canAccess = await canAccessChannel(request.user!.id, id);
      if (!canAccess) {
        return forbidden(reply, 'Cannot access this channel');
      }

      const searchLimit = Math.min(parseInt(limitStr || '25', 10), 50);
      const searchOffset = Math.max(parseInt(offsetStr || '0', 10), 0);
      const query = q.trim();

      const results = await db.sql`
        SELECT
          m.id, m.content, m.created_at, m.edited_at, m.channel_id,
          m.attachments, m.author_id,
          u.username, u.display_name, u.avatar_url,
          ts_headline('english', m.content, plainto_tsquery('english', ${query}),
            'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=30, MinWords=15'
          ) as highlighted_content,
          ts_rank(m.search_vector, plainto_tsquery('english', ${query})) as rank
        FROM messages m
        LEFT JOIN users u ON m.author_id = u.id
        ${pinned === 'true' ? db.sql`INNER JOIN pinned_messages pm ON pm.message_id = m.id AND pm.channel_id = m.channel_id` : db.sql``}
        WHERE m.channel_id = ${id}
          AND m.search_vector @@ plainto_tsquery('english', ${query})
          ${author_id ? db.sql`AND m.author_id = ${author_id}` : db.sql``}
          ${before ? db.sql`AND m.created_at < ${before}` : db.sql``}
          ${after ? db.sql`AND m.created_at > ${after}` : db.sql``}
          ${has_attachment === 'true' ? db.sql`AND jsonb_array_length(m.attachments) > 0` : db.sql``}
        ORDER BY rank DESC, m.created_at DESC
        LIMIT ${searchLimit} OFFSET ${searchOffset}
      `;

      const [countResult] = await db.sql`
        SELECT COUNT(*)::int as count
        FROM messages m
        ${pinned === 'true' ? db.sql`INNER JOIN pinned_messages pm ON pm.message_id = m.id AND pm.channel_id = m.channel_id` : db.sql``}
        WHERE m.channel_id = ${id}
          AND m.search_vector @@ plainto_tsquery('english', ${query})
          ${author_id ? db.sql`AND m.author_id = ${author_id}` : db.sql``}
          ${before ? db.sql`AND m.created_at < ${before}` : db.sql``}
          ${after ? db.sql`AND m.created_at > ${after}` : db.sql``}
          ${has_attachment === 'true' ? db.sql`AND jsonb_array_length(m.attachments) > 0` : db.sql``}
      `;

      return {
        results: results.map((r: any) => ({
          id: r.id,
          content: r.content,
          highlighted_content: r.highlighted_content,
          channel_id: r.channel_id,
          created_at: r.created_at,
          edited_at: r.edited_at,
          attachments: r.attachments,
          author: {
            id: r.author_id,
            username: r.username,
            display_name: r.display_name || r.username,
            avatar_url: r.avatar_url,
          },
        })),
        total_count: countResult.count,
        query: q,
      };
    },
  });

  // ============================================================
  // PINNED MESSAGES
  // ============================================================

  /**
   * GET /channels/:id/pinned - List pinned messages in a channel
   */
  fastify.get<{ Params: { id: string } }>('/:id/pinned', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;

      const canAccess = await canAccessChannel(request.user!.id, id);
      if (!canAccess) {
        return forbidden(reply, 'Cannot access this channel');
      }

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      const pinnedMessages = await db.sql`
        SELECT 
          pm.id as pin_id,
          pm.pinned_at,
          pm.pinned_by,
          m.id,
          m.content,
          m.created_at,
          m.edited_at,
          m.attachments,
          u.id as author_id,
          u.username as author_username,
          u.avatar_url as author_avatar_url,
          pinner.username as pinned_by_username
        FROM pinned_messages pm
        JOIN messages m ON pm.message_id = m.id
        LEFT JOIN users u ON m.author_id = u.id
        LEFT JOIN users pinner ON pm.pinned_by = pinner.id
        WHERE pm.channel_id = ${id}
        ORDER BY pm.pinned_at DESC
      `;

      return pinnedMessages.map((pm: any) => ({
        id: pm.id,
        content: pm.content,
        author: {
          id: pm.author_id,
          username: pm.author_username,
          display_name: pm.author_username,
          avatar_url: pm.author_avatar_url,
        },
        created_at: pm.created_at,
        edited_at: pm.edited_at,
        attachments: pm.attachments || [],
        pinned: true,
        pinned_at: pm.pinned_at,
        pinned_by: {
          id: pm.pinned_by,
          username: pm.pinned_by_username,
        },
      }));
    },
  });

  /**
   * POST /channels/:id/messages/:messageId/pin - Pin a message
   */
  fastify.post<{ Params: { id: string; messageId: string } }>('/:id/messages/:messageId/pin', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, messageId } = request.params;

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id, id);
      if (!hasPermission(perms.text, TextPermissions.MANAGE_MESSAGES)) {
        return forbidden(reply, 'Missing MANAGE_MESSAGES permission');
      }

      // Verify message exists and belongs to this channel
      const [message] = await db.sql`
        SELECT id, content, author_id, created_at FROM messages 
        WHERE id = ${messageId} AND channel_id = ${id}
      `;
      if (!message) {
        return notFound(reply, 'Message');
      }

      // Check if already pinned
      const [existing] = await db.sql`
        SELECT id FROM pinned_messages 
        WHERE channel_id = ${id} AND message_id = ${messageId}
      `;
      if (existing) {
        return badRequest(reply, 'Message already pinned');
      }

      // Pin the message with exempt_from_trimming flag
      await db.sql`
        INSERT INTO pinned_messages (channel_id, message_id, pinned_by, exempt_from_trimming)
        VALUES (${id}, ${messageId}, ${request.user!.id}, true)
      `;

      // Also mark the message itself as exempt from trimming
      await db.sql`
        UPDATE messages SET exempt_from_trimming = true WHERE id = ${messageId}
      `;

      // Get author info for socket event
      const [author] = await db.sql`SELECT id, username, avatar_url FROM users WHERE id = ${message.author_id}`;

      // Emit socket event
      await emitEncrypted(fastify.io, `channel:${id}`, 'message.pin', {
        channel_id: id,
        message: {
          id: message.id,
          content: message.content,
          author: {
            id: author?.id,
            username: author?.username,
            avatar_url: author?.avatar_url,
          },
          created_at: message.created_at,
        },
        pinned_by: request.user!.id,
      });

      return { message: 'Message pinned' };
    },
  });

  /**
   * DELETE /channels/:id/messages/:messageId/pin - Unpin a message
   */
  fastify.delete<{ Params: { id: string; messageId: string } }>('/:id/messages/:messageId/pin', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, messageId } = request.params;

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id, id);
      if (!hasPermission(perms.text, TextPermissions.MANAGE_MESSAGES)) {
        return forbidden(reply, 'Missing MANAGE_MESSAGES permission');
      }

      // Check if message is pinned
      const [pinned] = await db.sql`
        SELECT id FROM pinned_messages 
        WHERE channel_id = ${id} AND message_id = ${messageId}
      `;
      if (!pinned) {
        return notFound(reply, 'Pinned message');
      }

      // Unpin the message
      await db.sql`
        DELETE FROM pinned_messages
        WHERE channel_id = ${id} AND message_id = ${messageId}
      `;

      // Remove the exempt_from_trimming flag from the message
      // (unless it was manually exempted separately)
      await db.sql`
        UPDATE messages SET exempt_from_trimming = false 
        WHERE id = ${messageId} AND exempt_from_trimming = true
      `;

      // Emit socket event
      await emitEncrypted(fastify.io, `channel:${id}`, 'message.unpin', {
        channel_id: id,
        message_id: messageId,
        unpinned_by: request.user!.id,
      });

      return { message: 'Message unpinned' };
    },
  });

  // ============================================================
  // RETENTION & STORAGE MANAGEMENT
  // ============================================================

  const retentionUpdateSchema = z.object({
    retention_days: z.number().min(1).max(730).nullable().optional(), // 1 day to 2 years
    retention_never: z.boolean().optional(),
    size_limit_bytes: z.number().min(0).nullable().optional(),
    pruning_enabled: z.boolean().optional(),
  });

  /**
   * GET /channels/:id/retention - Get channel retention settings
   */
  fastify.get<{ Params: { id: string } }>('/:id/retention', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_CHANNELS)) {
        return forbidden(reply, 'Missing MANAGE_CHANNELS permission');
      }

      const retention = await getEffectiveChannelRetention(id);
      return retention;
    },
  });

  /**
   * PATCH /channels/:id/retention - Update channel retention settings
   */
  fastify.patch<{ Params: { id: string } }>('/:id/retention', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      const body = retentionUpdateSchema.parse(request.body);

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_CHANNELS)) {
        return forbidden(reply, 'Missing MANAGE_CHANNELS permission');
      }

      // Update retention settings
      await db.retention.updateChannelRetention(id, body);

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (${channel.server_id}, ${request.user!.id}, 'channel_update', 'channel', ${id}, ${JSON.stringify({ retention: body })})
      `;

      const updated = await getEffectiveChannelRetention(id);
      return updated;
    },
  });

  /**
   * GET /channels/:id/storage-stats - Get storage usage for channel
   */
  fastify.get<{ Params: { id: string } }>('/:id/storage-stats', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_CHANNELS)) {
        return forbidden(reply, 'Missing MANAGE_CHANNELS permission');
      }

      const stats = await getChannelStorageStats(id);
      const retention = await getEffectiveChannelRetention(id);

      return {
        ...stats,
        size_limit_bytes: retention.size_limit_bytes,
        usage_percent: retention.size_limit_bytes
          ? Math.round((stats.total_size_bytes / retention.size_limit_bytes) * 100)
          : null,
      };
    },
  });

  /**
   * GET /channels/:id/segments - List message segments
   */
  fastify.get<{ Params: { id: string }; Querystring: { limit?: string; offset?: string; include_archived?: string } }>('/:id/segments', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      const { limit, offset, include_archived } = request.query;

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_CHANNELS)) {
        return forbidden(reply, 'Missing MANAGE_CHANNELS permission');
      }

      const segments = await getSegmentsForChannel(id, {
        limit: parseInt(limit || '50'),
        offset: parseInt(offset || '0'),
        includeArchived: include_archived !== 'false',
      });

      return { segments };
    },
  });

  /**
   * GET /channels/:id/segments/:segmentId/messages - Load messages from a segment (including archived)
   */
  fastify.get<{ Params: { id: string; segmentId: string } }>('/:id/segments/:segmentId/messages', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, segmentId } = request.params;

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      const canAccess = await canAccessChannel(request.user!.id, id);
      if (!canAccess) {
        return forbidden(reply, 'Cannot access this channel');
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id, id);
      if (!hasPermission(perms.text, TextPermissions.READ_MESSAGE_HISTORY)) {
        return forbidden(reply, 'Missing READ_MESSAGE_HISTORY permission');
      }

      // Get segment info
      const segment = await db.segments.findById(segmentId);
      if (!segment) {
        return notFound(reply, 'Segment');
      }

      // Verify segment belongs to this channel
      if (segment.channel_id !== id) {
        return badRequest(reply, 'Segment does not belong to this channel');
      }

      let messages;
      if (segment.is_archived) {
        // Load from archive
        messages = await loadArchivedMessages(segmentId);
        reply.header('X-Segment-Info', 'archived');
      } else {
        // Load from database
        messages = await db.sql`
          SELECT 
            m.id, m.content, m.created_at, m.edited_at,
            m.attachments, m.reply_to_id, m.system_event,
            u.id as author_id, u.username as author_username,
            u.display_name as author_display_name, u.avatar_url as author_avatar_url
          FROM messages m
          LEFT JOIN users u ON m.author_id = u.id
          WHERE m.segment_id = ${segmentId}
          ORDER BY m.created_at ASC
        `;
        reply.header('X-Segment-Info', 'active');
      }

      reply.header('X-Segment-Start', new Date(segment.segment_start).toISOString());
      reply.header('X-Segment-End', new Date(segment.segment_end).toISOString());

      return { messages, segment };
    },
  });

  /**
   * POST /channels/:id/cleanup - Manually trigger cleanup for a channel
   */
  fastify.post<{ Params: { id: string }; Body: { dry_run?: boolean } }>('/:id/cleanup', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      const { dry_run = false } = (request.body || {}) as { dry_run?: boolean };

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id);
      if (!hasPermission(perms.server, ServerPermissions.ADMINISTRATOR)) {
        return forbidden(reply, 'Administrator permission required');
      }

      // Run retention cleanup
      const retentionResult = await applyRetentionPolicy(id, null, { dryRun: dry_run });

      // Run size limit cleanup
      const sizeResult = await applySizeLimitPolicy(id, null, { dryRun: dry_run });

      // Audit log (only if not dry run)
      if (!dry_run) {
        await db.sql`
          INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
          VALUES (${channel.server_id}, ${request.user!.id}, 'channel_update', 'channel', ${id}, 
            ${JSON.stringify({
          cleanup: {
            retention: retentionResult,
            size_limit: sizeResult
          }
        })})
        `;
      }

      return {
        dry_run,
        retention_cleanup: retentionResult,
        size_limit_cleanup: sizeResult,
        total_messages_deleted: retentionResult.messages_deleted + sizeResult.messages_deleted,
        total_bytes_freed: retentionResult.bytes_freed + sizeResult.bytes_freed,
      };
    },
  });

  /**
   * PATCH /channels/:id/messages/:messageId/exempt - Toggle message exemption from trimming
   */
  fastify.patch<{ Params: { id: string; messageId: string } }>('/:id/messages/:messageId/exempt', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, messageId } = request.params;
      const { exempt } = (request.body || {}) as { exempt?: boolean };

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id, id);
      if (!hasPermission(perms.text, TextPermissions.MANAGE_MESSAGES)) {
        return forbidden(reply, 'Missing MANAGE_MESSAGES permission');
      }

      // Verify message exists and belongs to this channel
      const [message] = await db.sql`
        SELECT id, exempt_from_trimming FROM messages 
        WHERE id = ${messageId} AND channel_id = ${id}
      `;
      if (!message) {
        return notFound(reply, 'Message');
      }

      const newExemptStatus = exempt !== undefined ? exempt : !message.exempt_from_trimming;

      await db.sql`
        UPDATE messages SET exempt_from_trimming = ${newExemptStatus} WHERE id = ${messageId}
      `;

      return {
        message_id: messageId,
        exempt_from_trimming: newExemptStatus,
      };
    },
  });

  // ============================================================
  // EXPORT FUNCTIONALITY
  // ============================================================

  const exportSchema = z.object({
    format: z.enum(['json', 'csv']).default('json'),
    include_attachment_urls: z.boolean().default(true),
    include_user_info: z.boolean().default(true),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    compress: z.boolean().default(true),
  });

  /**
   * POST /channels/:id/export - Export channel messages for compliance/backup
   */
  fastify.post<{ Params: { id: string } }>('/:id/export', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      const body = exportSchema.parse(request.body);

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id, id);
      const server = await db.servers.findById(channel.server_id);
      const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) ||
                      server?.owner_id === request.user!.id;

      if (!isAdmin) {
        return forbidden(reply, 'Administrator permission required for exports');
      }

      const { exportChannelMessages } = await import('../services/archive.js');

      const result = await exportChannelMessages(id, {
        format: body.format,
        includeAttachmentUrls: body.include_attachment_urls,
        includeUserInfo: body.include_user_info,
        startDate: body.start_date ? new Date(body.start_date) : undefined,
        endDate: body.end_date ? new Date(body.end_date) : undefined,
        compress: body.compress,
      });

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (${channel.server_id}, ${request.user!.id}, 'channel_update', 'channel', ${id}, 
          ${JSON.stringify({ export: result })})
      `;

      return result;
    },
  });

  /**
   * GET /channels/:id/exports - List available exports for a channel
   */
  fastify.get<{ Params: { id: string } }>('/:id/exports', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id, id);
      const server = await db.servers.findById(channel.server_id);
      const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) ||
                      server?.owner_id === request.user!.id;

      if (!isAdmin) {
        return forbidden(reply, 'Administrator permission required');
      }

      const { listExports } = await import('../services/archive.js');
      const exports = await listExports(id, null);

      return { exports };
    },
  });

  /**
   * GET /channels/:id/exports/:exportPath/download - Download an export file
   */
  fastify.get<{ Params: { id: string; exportPath: string } }>('/:id/exports/:exportPath/download', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, exportPath } = request.params;

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id, id);
      const server = await db.servers.findById(channel.server_id);
      const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) ||
                      server?.owner_id === request.user!.id;

      if (!isAdmin) {
        return forbidden(reply, 'Administrator permission required');
      }

      const { downloadExport } = await import('../services/archive.js');
      
      const fullPath = decodeURIComponent(exportPath);
      if (!fullPath.startsWith(`exports/channels/${id}/`)) {
        return forbidden(reply, 'Invalid export path');
      }

      const data = await downloadExport(fullPath);

      const isCompressed = fullPath.endsWith('.gz');
      const isJson = fullPath.includes('.json');

      reply.header('Content-Type', isCompressed ? 'application/gzip' : (isJson ? 'application/json' : 'text/csv'));
      reply.header('Content-Disposition', `attachment; filename="${fullPath.split('/').pop()}"`);

      return reply.send(data);
    },
  });

  /**
   * DELETE /channels/:id/exports/:exportPath - Delete an export file
   */
  fastify.delete<{ Params: { id: string; exportPath: string } }>('/:id/exports/:exportPath', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, exportPath } = request.params;

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id, id);
      const server = await db.servers.findById(channel.server_id);
      const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) ||
                      server?.owner_id === request.user!.id;

      if (!isAdmin) {
        return forbidden(reply, 'Administrator permission required');
      }

      const { deleteExport } = await import('../services/archive.js');
      
      const fullPath = decodeURIComponent(exportPath);
      if (!fullPath.startsWith(`exports/channels/${id}/`)) {
        return forbidden(reply, 'Invalid export path');
      }

      await deleteExport(fullPath);

      return { deleted: true };
    },
  });

  /**
   * GET /channels/:id/storage-stats/comprehensive - Get comprehensive storage stats including media
   */
  fastify.get<{ Params: { id: string } }>('/:id/storage-stats/comprehensive', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id, id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_CHANNELS)) {
        return forbidden(reply, 'Missing MANAGE_CHANNELS permission');
      }

      const { getComprehensiveStorageStats } = await import('../services/trimming.js');
      const stats = await getComprehensiveStorageStats(id, null);
      const retention = await getEffectiveChannelRetention(id);

      return {
        ...stats,
        size_limit_bytes: retention.size_limit_bytes,
        usage_percent: retention.size_limit_bytes
          ? Math.round((stats.total_size_bytes / retention.size_limit_bytes) * 100)
          : null,
      };
    },
  });

  // ── Per-Channel Notification Settings ──────────────────────

  // GET /channels/notification-settings - Bulk fetch all overrides for current user
  fastify.get('/notification-settings', {
    onRequest: [authenticate],
    handler: async (request) => {
      const rows = await db.sql`
        SELECT channel_id, level, suppress_everyone, suppress_roles
        FROM channel_notification_settings
        WHERE user_id = ${request.user!.id}
      `;
      return { settings: rows };
    },
  });

  // GET /channels/:id/notification-settings
  fastify.get('/:id/notification-settings', {
    onRequest: [authenticate],
    handler: async (request) => {
      const { id } = request.params as { id: string };
      const [row] = await db.sql`
        SELECT level, suppress_everyone, suppress_roles
        FROM channel_notification_settings
        WHERE user_id = ${request.user!.id} AND channel_id = ${id}
      `;
      return row ?? { level: 'default', suppress_everyone: false, suppress_roles: false };
    },
  });

  // PATCH /channels/:id/notification-settings
  fastify.patch('/:id/notification-settings', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = channelNotificationSettingsSchema.safeParse(request.body);
      if (!parsed.success) return badRequest(reply, parsed.error.message);

      const { level, suppress_everyone, suppress_roles } = parsed.data;
      const userId = request.user!.id;

      const [row] = await db.sql`
        INSERT INTO channel_notification_settings (user_id, channel_id, level, suppress_everyone, suppress_roles)
        VALUES (${userId}, ${id}, ${level}, ${suppress_everyone ?? false}, ${suppress_roles ?? false})
        ON CONFLICT (user_id, channel_id)
        DO UPDATE SET
          level = ${level},
          suppress_everyone = ${suppress_everyone ?? false},
          suppress_roles = ${suppress_roles ?? false}
        RETURNING level, suppress_everyone, suppress_roles
      `;
      return row;
    },
  });

  // DELETE /channels/:id/notification-settings - Remove override
  fastify.delete('/:id/notification-settings', {
    onRequest: [authenticate],
    handler: async (request) => {
      const { id } = request.params as { id: string };
      await db.sql`
        DELETE FROM channel_notification_settings
        WHERE user_id = ${request.user!.id} AND channel_id = ${id}
      `;
      return { success: true };
    },
  });
};
