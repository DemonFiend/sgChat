import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { calculatePermissions } from '../services/permissions.js';
import { TextPermissions, hasPermission } from '@sgchat/shared';
import { notFound, forbidden } from '../utils/errors.js';

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
        return notFound(reply, 'Message');
      }

      // Can only edit own messages
      if (message.author_id !== request.user!.id) {
        return forbidden(reply, 'Can only edit own messages');
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
        return notFound(reply, 'Message');
      }

      // Can delete own messages OR if has MANAGE_MESSAGES permission
      const canDelete = message.author_id === request.user!.id;
      
      if (!canDelete && message.channel_id) {
        const channel = await db.channels.findById(message.channel_id);
        if (!channel) {
          return notFound(reply, 'Channel');
        }
        const perms = await calculatePermissions(request.user!.id, channel.server_id, message.channel_id);
        
        if (!hasPermission(perms.text, TextPermissions.MANAGE_MESSAGES)) {
          return forbidden(reply, 'Cannot delete this message');
        }
      } else if (!canDelete) {
        return forbidden(reply, 'Cannot delete this message');
      }

      await db.messages.delete(id);
      
      // Broadcast deletion via Socket.IO
      const roomId = message.channel_id ? `channel:${message.channel_id}` : `dm:${message.dm_channel_id}`;
      fastify.io?.to(roomId).emit('message:delete', { id });

      return { message: 'Message deleted' };
    },
  });

  /**
   * PUT /messages/:id/reactions/:emoji - Add reaction to message
   */
  fastify.put<{ Params: { id: string; emoji: string } }>('/:id/reactions/:emoji', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 30, timeWindow: '1 minute' },
    },
    handler: async (request, reply) => {
      const { id, emoji } = request.params;
      
      const message = await db.messages.findById(id);
      if (!message) {
        return notFound(reply, 'Message');
      }

      // Check user has access to the channel
      if (message.channel_id) {
        const channel = await db.channels.findById(message.channel_id);
        if (!channel) {
          return notFound(reply, 'Channel');
        }
        // Check membership
        const [membership] = await db.sql`
          SELECT 1 FROM members WHERE user_id = ${request.user!.id} AND server_id = ${channel.server_id}
        `;
        if (!membership) {
          return forbidden(reply, 'Not a member of this server');
        }
      }

      // Validate emoji (basic check: allow common emojis and shortcodes)
      const emojiDecoded = decodeURIComponent(emoji);
      if (emojiDecoded.length > 32) {
        return reply.code(400).send({ error: 'Invalid emoji' });
      }

      // Add reaction (upsert - ignore if already exists)
      await db.sql`
        INSERT INTO message_reactions (message_id, user_id, emoji)
        VALUES (${id}, ${request.user!.id}, ${emojiDecoded})
        ON CONFLICT (message_id, user_id, emoji) DO NOTHING
      `;

      // Get updated reaction counts
      const reactions = await db.sql`
        SELECT emoji, COUNT(*)::int as count,
               BOOL_OR(user_id = ${request.user!.id}) as me
        FROM message_reactions
        WHERE message_id = ${id}
        GROUP BY emoji
      `;

      // Broadcast reaction update
      const roomId = message.channel_id ? `channel:${message.channel_id}` : `dm:${message.dm_channel_id}`;
      fastify.io?.to(roomId).emit('message:reaction', {
        message_id: id,
        emoji: emojiDecoded,
        user_id: request.user!.id,
        action: 'add',
        reactions,
      });

      return { reactions };
    },
  });

  /**
   * DELETE /messages/:id/reactions/:emoji - Remove reaction from message
   */
  fastify.delete<{ Params: { id: string; emoji: string } }>('/:id/reactions/:emoji', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 30, timeWindow: '1 minute' },
    },
    handler: async (request, reply) => {
      const { id, emoji } = request.params;
      
      const message = await db.messages.findById(id);
      if (!message) {
        return notFound(reply, 'Message');
      }

      const emojiDecoded = decodeURIComponent(emoji);

      // Remove reaction
      await db.sql`
        DELETE FROM message_reactions
        WHERE message_id = ${id} AND user_id = ${request.user!.id} AND emoji = ${emojiDecoded}
      `;

      // Get updated reaction counts
      const reactions = await db.sql`
        SELECT emoji, COUNT(*)::int as count,
               BOOL_OR(user_id = ${request.user!.id}) as me
        FROM message_reactions
        WHERE message_id = ${id}
        GROUP BY emoji
      `;

      // Broadcast reaction update
      const roomId = message.channel_id ? `channel:${message.channel_id}` : `dm:${message.dm_channel_id}`;
      fastify.io?.to(roomId).emit('message:reaction', {
        message_id: id,
        emoji: emojiDecoded,
        user_id: request.user!.id,
        action: 'remove',
        reactions,
      });

      return { reactions };
    },
  });

  /**
   * GET /messages/:id/reactions - Get all reactions for a message
   */
  fastify.get<{ Params: { id: string } }>('/:id/reactions', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      
      const message = await db.messages.findById(id);
      if (!message) {
        return notFound(reply, 'Message');
      }

      // Get reactions grouped by emoji with user list
      const reactions = await db.sql`
        SELECT emoji, 
               COUNT(*)::int as count,
               BOOL_OR(user_id = ${request.user!.id}) as me,
               ARRAY_AGG(user_id) as user_ids
        FROM message_reactions
        WHERE message_id = ${id}
        GROUP BY emoji
      `;

      return reactions;
    },
  });
};
