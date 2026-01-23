import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { calculatePermissions } from '../services/permissions.js';
import { TextPermissions, hasPermission } from '@sgchat/shared';

export const messageRoutes: FastifyPluginAsync = async (fastify) => {
  // Edit message
  fastify.patch('/:id', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const { content } = request.body as { content: string };
      
      const message = await db.messages.findById(id);
      if (!message) {
        return reply.status(404).send({ error: 'Message not found' });
      }

      // Can only edit own messages
      if (message.author_id !== request.user!.id) {
        return reply.status(403).send({ error: 'Can only edit own messages' });
      }

      const updated = await db.messages.update(id, {
        content,
        edited_at: new Date(),
      });
      
      // Broadcast edit via Socket.IO
      const roomId = message.channel_id ? `channel:${message.channel_id}` : `dm:${message.dm_channel_id}`;
      fastify.io?.to(roomId).emit('message:edit', updated);

      return updated;
    },
  });

  // Delete message
  fastify.delete('/:id', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 20, timeWindow: '1 minute' },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      
      const message = await db.messages.findById(id);
      if (!message) {
        return reply.status(404).send({ error: 'Message not found' });
      }

      // Can delete own messages OR if has MANAGE_MESSAGES permission
      const canDelete = message.author_id === request.user!.id;
      
      if (!canDelete && message.channel_id) {
        const channel = await db.channels.findById(message.channel_id);
        const perms = await calculatePermissions(request.user!.id, channel.server_id, message.channel_id);
        
        if (!hasPermission(perms.text, TextPermissions.MANAGE_MESSAGES)) {
          return reply.status(403).send({ error: 'Cannot delete this message' });
        }
      } else if (!canDelete) {
        return reply.status(403).send({ error: 'Cannot delete this message' });
      }

      await db.messages.delete(id);
      
      // Broadcast deletion via Socket.IO
      const roomId = message.channel_id ? `channel:${message.channel_id}` : `dm:${message.dm_channel_id}`;
      fastify.io?.to(roomId).emit('message:delete', { id });

      return { message: 'Message deleted' };
    },
  });
};
