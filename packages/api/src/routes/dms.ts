import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { sendMessageSchema } from '@sgchat/shared';
import { notFound, forbidden, badRequest } from '../utils/errors.js';
import { areFriends, isBlocked } from './friends.js';
import { z } from 'zod';
import { getDMStorageStats, getSegmentsForDM, getOrCreateSegment, onMessageCreated } from '../services/segmentation.js';
import { getEffectiveDMRetention, applyRetentionPolicy } from '../services/trimming.js';
import { loadArchivedMessages } from '../services/archive.js';
import { publishEvent } from '../lib/eventBus.js';

export const dmRoutes: FastifyPluginAsync = async (fastify) => {
  // Get user's DM channels
  fastify.get('/', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const dmChannels = await db.dmChannels.findByUserId(request.user!.id);
      return dmChannels;
    },
  });

  // Create or get DM channel with user
  fastify.post('/', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { user_id } = request.body as { user_id: string };
      
      if (user_id === request.user!.id) {
        return badRequest(reply, 'Cannot DM yourself');
      }

      // Check if target user exists
      const targetUser = await db.users.findById(user_id);
      if (!targetUser) {
        return notFound(reply, 'User');
      }

      // Check if users are friends
      if (!await areFriends(request.user!.id, user_id)) {
        return forbidden(reply, 'You must be friends to send direct messages');
      }

      // Check if either user has blocked the other
      if (await isBlocked(request.user!.id, user_id)) {
        return forbidden(reply, 'Cannot message this user');
      }

      // Check if DM already exists
      let dm = await db.dmChannels.findByUsers(request.user!.id, user_id);
      
      if (!dm) {
        dm = await db.dmChannels.create(request.user!.id, user_id);
      }

      return dm;
    },
  });

  // Get DM messages
  fastify.get('/:id/messages', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const { limit, before } = request.query as { limit?: string; before?: string };
      
      const dm = await db.dmChannels.findById(id);
      if (!dm) {
        return notFound(reply, 'DM channel');
      }

      // Verify user is part of this DM
      if (dm.user1_id !== request.user!.id && dm.user2_id !== request.user!.id) {
        return forbidden(reply, 'Not part of this DM');
      }

      const messages = await db.messages.findByDMChannelId(
        id,
        limit ? parseInt(limit) : 50,
        before
      );
      
      return messages.reverse();
    },
  });

  // Send DM message
  fastify.post('/:id/messages', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 5, timeWindow: '5 seconds' },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = sendMessageSchema.parse(request.body);
      
      const dm = await db.dmChannels.findById(id);
      if (!dm) {
        return notFound(reply, 'DM channel');
      }

      // Verify user is part of this DM
      if (dm.user1_id !== request.user!.id && dm.user2_id !== request.user!.id) {
        return forbidden(reply, 'Not part of this DM');
      }

      // Get recipient ID
      const recipientId = dm.user1_id === request.user!.id ? dm.user2_id : dm.user1_id;

      // Verify users are still friends
      if (!await areFriends(request.user!.id, recipientId)) {
        return forbidden(reply, 'You must be friends to send direct messages');
      }

      // Check if either user has blocked the other
      if (await isBlocked(request.user!.id, recipientId)) {
        return forbidden(reply, 'Cannot message this user');
      }

      const message = await db.messages.create({
        dm_channel_id: id,
        author_id: request.user!.id,
        content: body.content,
        attachments: body.attachments,
        queued_at: body.queued_at ? new Date(body.queued_at) : undefined,
      });

      // Assign message to a segment for history management
      try {
        const segment = await getOrCreateSegment(null, id, new Date(message.created_at));
        await db.sql`UPDATE messages SET segment_id = ${segment.id} WHERE id = ${message.id}`;
        await onMessageCreated(segment.id, body.content, body.attachments || []);
      } catch (segmentError) {
        console.error('Failed to assign DM message to segment:', segmentError);
      }
      
      // Get author info for the formatted message
      const author = await db.users.findById(request.user!.id);
      
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

      // Broadcast via event bus (consistent with Socket.IO handler)
      await publishEvent({
        type: 'dm.message.new',
        actorId: request.user!.id,
        resourceId: `dm:${id}`,
        payload: {
          from_user_id: request.user!.id,
          message: formattedMessage,
        },
      });

      // TODO: Handle offline user - send push notification

      return message;
    },
  });

  // ============================================================
  // User-ID based routes (client compatibility)
  // These routes accept the friend's user ID instead of DM channel ID
  // ============================================================

  // Get DM messages by user ID (client-friendly route)
  fastify.get('/user/:userId/messages', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const { limit, before, after } = request.query as { limit?: string; before?: string; after?: string };
      
      // Check if target user exists
      const targetUser = await db.users.findById(userId);
      if (!targetUser) {
        return notFound(reply, 'User');
      }

      // Check if users are friends
      if (!await areFriends(request.user!.id, userId)) {
        return forbidden(reply, 'You must be friends to view messages');
      }

      // Find the DM channel between these users
      const dm = await db.dmChannels.findByUsers(request.user!.id, userId);
      if (!dm) {
        // No messages yet - return empty array
        return [];
      }

      const messages = await db.messages.findByDMChannelId(
        dm.id,
        limit ? parseInt(limit) : 50,
        before
      );
      
      // Transform to match expected format (sender_id instead of author_id)
      return messages.reverse().map((m: any) => ({
        id: m.id,
        content: m.content,
        sender_id: m.author_id,
        created_at: m.created_at,
        edited_at: m.edited_at,
      }));
    },
  });

  // Send DM message by user ID (client-friendly route)
  fastify.post('/user/:userId/messages', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 5, timeWindow: '5 seconds' },
    },
    handler: async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const body = sendMessageSchema.parse(request.body);
      
      // Check if target user exists
      const targetUser = await db.users.findById(userId);
      if (!targetUser) {
        return notFound(reply, 'User');
      }

      // Check if users are friends
      if (!await areFriends(request.user!.id, userId)) {
        return forbidden(reply, 'You must be friends to send messages');
      }

      // Check if either user has blocked the other
      if (await isBlocked(request.user!.id, userId)) {
        return forbidden(reply, 'Cannot message this user');
      }

      // Find or create DM channel
      let dm = await db.dmChannels.findByUsers(request.user!.id, userId);
      if (!dm) {
        dm = await db.dmChannels.create(request.user!.id, userId);
      }

      const message = await db.messages.create({
        dm_channel_id: dm.id,
        author_id: request.user!.id,
        content: body.content,
        attachments: body.attachments,
        queued_at: body.queued_at ? new Date(body.queued_at) : undefined,
      });

      // Assign message to a segment for history management
      try {
        const segment = await getOrCreateSegment(null, dm.id, new Date(message.created_at));
        await db.sql`UPDATE messages SET segment_id = ${segment.id} WHERE id = ${message.id}`;
        await onMessageCreated(segment.id, body.content, body.attachments || []);
      } catch (segmentError) {
        console.error('Failed to assign DM message to segment:', segmentError);
      }
      
      // Get author info for the formatted message
      const author = await db.users.findById(request.user!.id);
      
      const formattedMessage = {
        id: message.id,
        dm_channel_id: dm.id,
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

      // Broadcast via event bus (consistent with Socket.IO handler)
      await publishEvent({
        type: 'dm.message.new',
        actorId: request.user!.id,
        resourceId: `dm:${dm.id}`,
        payload: {
          from_user_id: request.user!.id,
          message: formattedMessage,
        },
      });

      // Return in expected format
      return {
        id: message.id,
        content: message.content,
        sender_id: message.author_id,
        created_at: message.created_at,
        edited_at: message.edited_at,
      };
    },
  });

  // Acknowledge messages (mark as received)
  fastify.post('/ack', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { message_ids } = request.body as { message_ids: string[] };
      
      const now = new Date();
      for (const messageId of message_ids) {
        await db.messages.updateStatus(messageId, 'received', now);
      }

      // TODO: Notify sender via Socket.IO

      return { acknowledged: message_ids.length };
    },
  });

  // Get unread DMs
  fastify.get('/unread', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      // Get all DM channels for user
      const dmChannels = await db.dmChannels.findByUserId(request.user!.id);
      
      const unreadCounts: { channel_id: string; count: number; last_message_at: string | null }[] = [];
      
      for (const dm of dmChannels) {
        // Count messages not authored by current user that are in 'sent' status (not 'received' or 'read')
        const result = await db.sql`
          SELECT COUNT(*) as count, MAX(created_at) as last_message_at
          FROM messages
          WHERE dm_channel_id = ${dm.id}
            AND author_id != ${request.user!.id}
            AND status = 'sent'
        `;
        
        const count = parseInt(result[0]?.count || '0');
        if (count > 0) {
          unreadCounts.push({
            channel_id: dm.id,
            count,
            last_message_at: result[0]?.last_message_at || null,
          });
        }
      }
      
      return {
        total: unreadCounts.reduce((sum, c) => sum + c.count, 0),
        channels: unreadCounts,
      };
    },
  });

  // ============================================================
  // DM RETENTION & STORAGE MANAGEMENT
  // ============================================================

  const dmRetentionUpdateSchema = z.object({
    retention_days: z.number().min(1).max(730).nullable().optional(),
    retention_never: z.boolean().optional(),
    size_limit_bytes: z.number().min(0).nullable().optional(),
  });

  /**
   * Helper to verify user is part of a DM channel
   */
  async function verifyDMAccess(userId: string, dmId: string): Promise<boolean> {
    const dm = await db.dmChannels.findById(dmId);
    if (!dm) return false;
    return dm.user1_id === userId || dm.user2_id === userId;
  }

  /**
   * GET /dms/:id/retention - Get DM retention settings
   */
  fastify.get<{ Params: { id: string } }>('/:id/retention', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;

      if (!await verifyDMAccess(request.user!.id, id)) {
        return forbidden(reply, 'Not part of this DM');
      }

      const retention = await getEffectiveDMRetention(id);
      return retention;
    },
  });

  /**
   * PATCH /dms/:id/retention - Update DM retention settings
   * Both users in the DM can update retention settings
   */
  fastify.patch<{ Params: { id: string } }>('/:id/retention', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      const body = dmRetentionUpdateSchema.parse(request.body);

      if (!await verifyDMAccess(request.user!.id, id)) {
        return forbidden(reply, 'Not part of this DM');
      }

      await db.retention.updateDMRetention(id, body);

      const updated = await getEffectiveDMRetention(id);
      return updated;
    },
  });

  /**
   * GET /dms/:id/storage-stats - Get storage usage for DM
   */
  fastify.get<{ Params: { id: string } }>('/:id/storage-stats', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;

      if (!await verifyDMAccess(request.user!.id, id)) {
        return forbidden(reply, 'Not part of this DM');
      }

      const stats = await getDMStorageStats(id);
      const retention = await getEffectiveDMRetention(id);

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
   * GET /dms/:id/segments - List message segments
   */
  fastify.get<{ Params: { id: string }; Querystring: { limit?: string; offset?: string; include_archived?: string } }>('/:id/segments', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      const { limit, offset, include_archived } = request.query;

      if (!await verifyDMAccess(request.user!.id, id)) {
        return forbidden(reply, 'Not part of this DM');
      }

      const segments = await getSegmentsForDM(id, {
        limit: parseInt(limit || '50'),
        offset: parseInt(offset || '0'),
        includeArchived: include_archived !== 'false',
      });

      return { segments };
    },
  });

  /**
   * GET /dms/:id/segments/:segmentId/messages - Load messages from a segment
   */
  fastify.get<{ Params: { id: string; segmentId: string } }>('/:id/segments/:segmentId/messages', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, segmentId } = request.params;

      if (!await verifyDMAccess(request.user!.id, id)) {
        return forbidden(reply, 'Not part of this DM');
      }

      // Get segment info
      const segment = await db.segments.findById(segmentId);
      if (!segment) {
        return notFound(reply, 'Segment');
      }

      // Verify segment belongs to this DM
      if (segment.dm_channel_id !== id) {
        return badRequest(reply, 'Segment does not belong to this DM');
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
            m.author_id as sender_id
          FROM messages m
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
   * POST /dms/:id/cleanup - Manually trigger cleanup for a DM
   */
  fastify.post<{ Params: { id: string }; Body: { dry_run?: boolean } }>('/:id/cleanup', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      const { dry_run = false } = (request.body || {}) as { dry_run?: boolean };

      if (!await verifyDMAccess(request.user!.id, id)) {
        return forbidden(reply, 'Not part of this DM');
      }

      const result = await applyRetentionPolicy(null, id, { dryRun: dry_run });

      return {
        dry_run,
        messages_deleted: result.messages_deleted,
        bytes_freed: result.bytes_freed,
        segments_trimmed: result.segments_trimmed,
      };
    },
  });
};
