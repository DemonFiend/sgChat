import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { canAccessChannel, calculatePermissions } from '../services/permissions.js';
import { ServerPermissions, TextPermissions, hasPermission, sendMessageSchema } from '@sgchat/shared';
import { notFound, forbidden, badRequest } from '../utils/errors.js';
import { z } from 'zod';

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

export const channelRoutes: FastifyPluginAsync = async (fastify) => {
  // Get channel by ID
  fastify.get('/:id', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      
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

  // Get channel messages with full author info and reactions
  fastify.get('/:id/messages', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const { limit, before } = request.query as { limit?: string; before?: string };
      const currentUserId = request.user!.id;
      
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

      // Get messages with full author info
      const maxLimit = Math.min(parseInt(limit || '50') || 50, 100);
      let messages;
      
      if (before) {
        messages = await db.sql`
          SELECT 
            m.id,
            m.content,
            m.created_at,
            m.edited_at,
            m.attachments,
            m.reply_to_id,
            u.id as author_id,
            u.username as author_username,
            u.avatar_url as author_avatar_url
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
            u.id as author_id,
            u.username as author_username,
            u.avatar_url as author_avatar_url
          FROM messages m
          LEFT JOIN users u ON m.author_id = u.id
          WHERE m.channel_id = ${id}
          ORDER BY m.created_at DESC
          LIMIT ${maxLimit}
        `;
      }

      // Get reactions for all messages
      const messageIds = messages.map((m: any) => m.id);
      let reactionsMap: Map<string, any[]> = new Map();
      
      if (messageIds.length > 0) {
        const reactions = await db.sql`
          SELECT 
            mr.message_id,
            mr.emoji,
            mr.user_id,
            ${currentUserId} = mr.user_id as me
          FROM message_reactions mr
          WHERE mr.message_id = ANY(${messageIds})
          ORDER BY mr.created_at ASC
        `;

        // Group reactions by message and emoji
        for (const r of reactions) {
          if (!reactionsMap.has(r.message_id)) {
            reactionsMap.set(r.message_id, []);
          }
          const msgReactions = reactionsMap.get(r.message_id)!;
          let emojiReaction = msgReactions.find(er => er.emoji === r.emoji);
          if (!emojiReaction) {
            emojiReaction = { emoji: r.emoji, count: 0, users: [], me: false };
            msgReactions.push(emojiReaction);
          }
          emojiReaction.count++;
          emojiReaction.users.push(r.user_id);
          if (r.me) emojiReaction.me = true;
        }
      }

      // Format response
      const formattedMessages = messages.reverse().map((m: any) => ({
        id: m.id,
        content: m.content,
        author: {
          id: m.author_id,
          username: m.author_username,
          display_name: m.author_username, // Use username as display_name
          avatar_url: m.author_avatar_url,
        },
        created_at: m.created_at,
        edited_at: m.edited_at,
        attachments: m.attachments || [],
        reply_to_id: m.reply_to_id,
        reactions: reactionsMap.get(m.id) || [],
      }));
      
      return formattedMessages;
    },
  });

  // Send message to channel
  fastify.post('/:id/messages', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 5, timeWindow: '5 seconds' },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = sendMessageSchema.parse(request.body);
      
      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id, id);
      
      if (!hasPermission(perms.text, TextPermissions.SEND_MESSAGES)) {
        return forbidden(reply, 'Missing SEND_MESSAGES permission');
      }

      const message = await db.messages.create({
        channel_id: id,
        author_id: request.user!.id,
        content: body.content,
        attachments: body.attachments,
        queued_at: body.queued_at ? new Date(body.queued_at) : undefined,
      });

      // Get author info for response
      const author = await db.users.findById(request.user!.id);

      // Format response with full author object
      const formattedMessage = {
        id: message.id,
        content: message.content,
        author: {
          id: author.id,
          username: author.username,
          display_name: author.username,
          avatar_url: author.avatar_url,
        },
        created_at: message.created_at,
        edited_at: message.edited_at,
        attachments: message.attachments || [],
        reactions: [],
      };

      // Broadcast via Socket.IO
      fastify.io?.to(`channel:${id}`).emit('message:new', formattedMessage);

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
      fastify.io?.to(`server:${channel.server_id}`).emit('channel:update', updatedChannel);

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

      await db.sql`DELETE FROM channels WHERE id = ${id}`;

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (${channel.server_id}, ${request.user!.id}, 'channel_delete', 'channel', ${id}, ${JSON.stringify({ deleted: channel })})
      `;

      fastify.io?.to(`server:${channel.server_id}`).emit('channel:delete', { id, server_id: channel.server_id });

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
      fastify.io?.to(`server:${id}`).emit('channels:reorder', updatedChannels);

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

      if (channel.type !== 'voice') {
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
        };
      }));

      return { participants };
    },
  });
};
