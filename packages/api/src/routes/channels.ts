import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { canAccessChannel, calculatePermissions } from '../services/permissions.js';
import { ServerPermissions, TextPermissions, hasPermission, sendMessageSchema } from '@sgchat/shared';
import { notFound, forbidden, badRequest } from '../utils/errors.js';

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

  // Get channel messages
  fastify.get('/:id/messages', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const { limit, before } = request.query as { limit?: string; before?: string };
      
      const canAccess = await canAccessChannel(request.user!.id, id);
      if (!canAccess) {
        return forbidden(reply, 'Cannot access this channel');
      }

      const channel = await db.channels.findById(id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }
      const perms = await calculatePermissions(request.user!.id, channel.server_id, id);
      
      if (!hasPermission(perms.text, TextPermissions.READ_MESSAGE_HISTORY)) {
        return forbidden(reply, 'Missing READ_MESSAGE_HISTORY permission');
      }

      const messages = await db.messages.findByChannelId(
        id,
        limit ? parseInt(limit) : 50,
        before
      );
      
      return messages.reverse();
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

      // Broadcast via Socket.IO
      fastify.io?.to(`channel:${id}`).emit('message:new', message);

      return message;
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
};
