import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { sendMessageSchema } from '@sgchat/shared';
import { notFound, forbidden, badRequest } from '../utils/errors.js';
import { areFriends, isBlocked } from './friends.js';

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
      
      // Broadcast to both users via Socket.IO (use dm:message:create as client expects)
      const dmEvent = {
        from_user_id: request.user!.id,
        message: message,
      };
      fastify.io?.to(`user:${request.user!.id}`).emit('dm.message.new', dmEvent);
      fastify.io?.to(`user:${recipientId}`).emit('dm.message.new', dmEvent);

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
      
      // Broadcast to both users via Socket.IO
      const dmEvent = {
        from_user_id: request.user!.id,
        message: {
          id: message.id,
          content: message.content,
          sender_id: message.author_id,
          created_at: message.created_at,
          edited_at: message.edited_at,
        },
      };
      fastify.io?.to(`user:${request.user!.id}`).emit('dm.message.new', dmEvent);
      fastify.io?.to(`user:${userId}`).emit('dm.message.new', dmEvent);

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
};
