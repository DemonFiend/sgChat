import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { canAccessChannel, calculatePermissions } from '../services/permissions.js';
import { ServerPermissions, TextPermissions, hasPermission, sendMessageSchema } from '@sgchat/shared';

export const channelRoutes: FastifyPluginAsync = async (fastify) => {
  // Get channel by ID
  fastify.get('/:id', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      
      const canAccess = await canAccessChannel(request.user!.id, id);
      if (!canAccess) {
        return reply.status(403).send({ error: 'Cannot access this channel' });
      }

      const channel = await db.channels.findById(id);
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
        return reply.status(403).send({ error: 'Cannot access this channel' });
      }

      const channel = await db.channels.findById(id);
      const perms = await calculatePermissions(request.user!.id, channel.server_id, id);
      
      if (!hasPermission(perms.text, TextPermissions.READ_MESSAGE_HISTORY)) {
        return reply.status(403).send({ error: 'Missing READ_MESSAGE_HISTORY permission' });
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
        return reply.status(404).send({ error: 'Channel not found' });
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id, id);
      
      if (!hasPermission(perms.text, TextPermissions.SEND_MESSAGES)) {
        return reply.status(403).send({ error: 'Missing SEND_MESSAGES permission' });
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
      if (channel.type !== 'voice') {
        return reply.status(400).send({ error: 'Not a voice channel' });
      }

      const perms = await calculatePermissions(request.user!.id, channel.server_id);
      // Moderators can adjust bitrate - check for either MANAGE_CHANNELS or MOVE_MEMBERS voice permission
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_CHANNELS)) {
        return reply.status(403).send({ error: 'Missing permission' });
      }

      await db.channels.updateBitrate(id, bitrate);
      return { bitrate };
    },
  });
};
