import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { sendMessageSchema } from '@sgchat/shared';
import { notFound, forbidden, badRequest } from '../utils/errors.js';
import { areFriends } from './friends.js';

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

      const message = await db.messages.create({
        dm_channel_id: id,
        author_id: request.user!.id,
        content: body.content,
        attachments: body.attachments,
        queued_at: body.queued_at ? new Date(body.queued_at) : undefined,
      });
      
      // Broadcast to both users via Socket.IO
      fastify.io?.to(`user:${request.user!.id}`).emit('dm:message', message);
      fastify.io?.to(`user:${recipientId}`).emit('dm:message', message);

      // TODO: Handle offline user - send push notification

      return message;
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
