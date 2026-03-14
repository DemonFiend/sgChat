import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { publishEvent } from '../lib/eventBus.js';
import { calculatePermissions } from '../services/permissions.js';
import { TextPermissions, hasPermission } from '@sgchat/shared';
import { notFound, forbidden } from '../utils/errors.js';
import { handleCrossSegmentEdit, handleCrossSegmentDelete } from '../services/archive.js';
import { onMessageDeleted } from '../services/segmentation.js';
import { assignRoleFromReaction, removeRoleFromReaction } from '../services/roleReactions.js';
import { storage } from '../lib/storage.js';

/**
 * Enrich raw reaction rows with custom emoji url/shortcode/is_animated.
 */
async function enrichReactions(reactions: any[]): Promise<any[]> {
  const customReactions = reactions.filter((r) => r.type === 'custom' && r.emojiId);
  if (customReactions.length === 0) return reactions;

  const emojiIds = [...new Set(customReactions.map((r) => r.emojiId))];
  const emojis = await db.sql`SELECT id, shortcode, asset_key, is_animated FROM emojis WHERE id = ANY(${emojiIds})`;
  const emojiMap = new Map(emojis.map((e: any) => [e.id, e]));

  return reactions.map((r) => {
    if (r.type !== 'custom' || !r.emojiId) return r;
    const emoji = emojiMap.get(r.emojiId);
    if (!emoji) return r;
    return {
      ...r,
      shortcode: emoji.shortcode,
      url: emoji.asset_key ? storage.getPublicUrl(emoji.asset_key) : undefined,
      is_animated: emoji.is_animated,
    };
  });
}

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

      // Track cross-segment reference impacts (edits may affect reply previews in archives)
      try {
        await handleCrossSegmentEdit(id, content);
      } catch (err) {
        console.error('Failed to track cross-segment edit:', err);
      }

      const author = await db.users.findById(message.author_id);

      const formattedMessage = {
        id: updated.id,
        channel_id: updated.channel_id || null,
        dm_channel_id: updated.dm_channel_id || null,
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
      
      // A1: Publish through event bus (replaces direct io.emit)
      const resourceId = message.channel_id ? `channel:${message.channel_id}` : `dm:${message.dm_channel_id}`;
      const eventType = message.channel_id ? 'message.update' : 'dm.message.update';
      await publishEvent({
        type: eventType,
        actorId: request.user!.id,
        resourceId,
        payload: formattedMessage,
      });

      return formattedMessage;
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

      // Track cross-segment reference impacts (deletions break reply chains)
      try {
        await handleCrossSegmentDelete(id, message.channel_id, message.dm_channel_id);
      } catch (err) {
        console.error('Failed to track cross-segment delete:', err);
      }

      // Update segment statistics before deletion
      if (message.segment_id) {
        try {
          await onMessageDeleted(message.segment_id, message.content, message.attachments || []);
        } catch (err) {
          console.error('Failed to update segment stats on delete:', err);
        }
      }

      await db.messages.delete(id);
      
      // A1: Publish through event bus (replaces direct io.emit)
      const resourceId = message.channel_id ? `channel:${message.channel_id}` : `dm:${message.dm_channel_id}`;
      const eventType = message.channel_id ? 'message.delete' : 'dm.message.delete';
      await publishEvent({
        type: eventType,
        actorId: request.user!.id,
        resourceId,
        payload: { id, channel_id: message.channel_id, dm_channel_id: message.dm_channel_id },
      });

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
        INSERT INTO message_reactions (message_id, user_id, reaction_type, unicode_emoji)
        VALUES (${id}, ${request.user!.id}, 'unicode', ${emojiDecoded})
        ON CONFLICT (message_id, user_id, reaction_type, COALESCE(unicode_emoji, ''), COALESCE(custom_emoji_id, '00000000-0000-0000-0000-000000000000')) DO NOTHING
      `;

      // Get updated reaction counts
      const rawReactions = await db.sql`
        SELECT
          reaction_type as type,
          unicode_emoji as emoji,
          custom_emoji_id as "emojiId",
          COUNT(*)::int as count,
          BOOL_OR(user_id = ${request.user!.id}) as me
        FROM message_reactions
        WHERE message_id = ${id}
        GROUP BY reaction_type, unicode_emoji, custom_emoji_id
      `;
      const reactions = await enrichReactions(rawReactions);

      // A1: Publish reaction through event bus
      const resourceId = message.channel_id ? `channel:${message.channel_id}` : `dm:${message.dm_channel_id}`;
      await publishEvent({
        type: message.channel_id ? 'message.update' : 'dm.message.update',
        actorId: request.user!.id,
        resourceId,
        payload: {
          message_id: id,
          emoji: emojiDecoded,
          user_id: request.user!.id,
          action: 'add',
          reactions,
        },
      });

      // Role reaction intercept: assign role if this is a role-reaction message
      if (message.channel_id) {
        const channel = await db.channels.findById(message.channel_id);
        if (channel) {
          const result = await assignRoleFromReaction(
            request.user!.id, channel.server_id, emojiDecoded, id
          );
          if (result) {
            // Broadcast role update so other clients see the change
            const userRoles = await db.sql`
              SELECT r.id, r.name, r.color, r.position
              FROM member_roles mr
              JOIN roles r ON mr.role_id = r.id
              WHERE mr.member_user_id = ${request.user!.id}
                AND mr.member_server_id = ${channel.server_id}
              ORDER BY r.position DESC
            `;
            await publishEvent({
              type: 'member.update',
              resourceId: `server:${channel.server_id}`,
              actorId: null,
              payload: {
                user_id: request.user!.id,
                server_id: channel.server_id,
                roles: userRoles,
              },
            });
            // If exclusive group removed other reactions, broadcast updated reaction counts
            if (result.removedReactions.length > 0) {
              const updatedReactions = await db.sql`
                SELECT
                  reaction_type as type, unicode_emoji as emoji, custom_emoji_id as "emojiId",
                  COUNT(*)::int as count, BOOL_OR(user_id = ${request.user!.id}) as me
                FROM message_reactions WHERE message_id = ${id}
                GROUP BY reaction_type, unicode_emoji, custom_emoji_id
              `;
              const enrichedReactions = await enrichReactions(updatedReactions);
              await publishEvent({
                type: 'message.update',
                actorId: request.user!.id,
                resourceId: `channel:${message.channel_id}`,
                payload: { message_id: id, action: 'remove', reactions: enrichedReactions },
              });
            }
          }
        }
      }

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
        WHERE message_id = ${id} AND user_id = ${request.user!.id} AND reaction_type = 'unicode' AND unicode_emoji = ${emojiDecoded}
      `;

      // Get updated reaction counts
      const rawReactions2 = await db.sql`
        SELECT
          reaction_type as type,
          unicode_emoji as emoji,
          custom_emoji_id as "emojiId",
          COUNT(*)::int as count,
          BOOL_OR(user_id = ${request.user!.id}) as me
        FROM message_reactions
        WHERE message_id = ${id}
        GROUP BY reaction_type, unicode_emoji, custom_emoji_id
      `;
      const reactions = await enrichReactions(rawReactions2);

      // A1: Publish reaction removal through event bus
      const resourceId = message.channel_id ? `channel:${message.channel_id}` : `dm:${message.dm_channel_id}`;
      await publishEvent({
        type: message.channel_id ? 'message.update' : 'dm.message.update',
        actorId: request.user!.id,
        resourceId,
        payload: {
          message_id: id,
          emoji: emojiDecoded,
          user_id: request.user!.id,
          action: 'remove',
          reactions,
        },
      });

      // Role reaction intercept: remove role if this is a role-reaction message
      if (message.channel_id) {
        const channel = await db.channels.findById(message.channel_id);
        if (channel) {
          const roleId = await removeRoleFromReaction(
            request.user!.id, channel.server_id, emojiDecoded, id
          );
          if (roleId) {
            const userRoles = await db.sql`
              SELECT r.id, r.name, r.color, r.position
              FROM member_roles mr
              JOIN roles r ON mr.role_id = r.id
              WHERE mr.member_user_id = ${request.user!.id}
                AND mr.member_server_id = ${channel.server_id}
              ORDER BY r.position DESC
            `;
            await publishEvent({
              type: 'member.update',
              resourceId: `server:${channel.server_id}`,
              actorId: null,
              payload: {
                user_id: request.user!.id,
                server_id: channel.server_id,
                roles: userRoles,
              },
            });
          }
        }
      }

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

      // Get reactions grouped by type with user list
      const rawReactions3 = await db.sql`
        SELECT
          reaction_type as type,
          unicode_emoji as emoji,
          custom_emoji_id as "emojiId",
          COUNT(*)::int as count,
          BOOL_OR(user_id = ${request.user!.id}) as me,
          ARRAY_AGG(user_id) as user_ids
        FROM message_reactions
        WHERE message_id = ${id}
        GROUP BY reaction_type, unicode_emoji, custom_emoji_id
      `;

      return enrichReactions(rawReactions3);
    },
  });

  /**
   * POST /messages/:id/reactions - Add typed reaction
   */
  fastify.post<{ Params: { id: string } }>('/:id/reactions', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 30, timeWindow: '1 minute' },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const body = request.body as { reaction: { type: string; value?: string; emojiId?: string } };

      if (!body.reaction || !body.reaction.type) {
        return reply.code(400).send({ error: 'Invalid reaction format' });
      }

      const { type, value, emojiId } = body.reaction;

      const message = await db.messages.findById(id);
      if (!message) return notFound(reply, 'Message');

      // Check access
      if (message.channel_id) {
        const channel = await db.channels.findById(message.channel_id);
        if (!channel) return notFound(reply, 'Channel');
        const [membership] = await db.sql`
          SELECT 1 FROM members WHERE user_id = ${request.user!.id} AND server_id = ${channel.server_id}
        `;
        if (!membership) return forbidden(reply, 'Not a member of this server');
      }

      if (type === 'unicode') {
        if (!value || value.length > 32) return reply.code(400).send({ error: 'Invalid unicode emoji' });
        await db.sql`
          INSERT INTO message_reactions (message_id, user_id, reaction_type, unicode_emoji)
          VALUES (${id}, ${request.user!.id}, 'unicode', ${value})
          ON CONFLICT (message_id, user_id, reaction_type, COALESCE(unicode_emoji, ''), COALESCE(custom_emoji_id, '00000000-0000-0000-0000-000000000000')) DO NOTHING
        `;
      } else if (type === 'custom') {
        if (!emojiId) return reply.code(400).send({ error: 'Missing emojiId' });
        // Validate emoji exists and belongs to server
        const emoji = await db.emojis.findById(emojiId);
        if (!emoji) return reply.code(400).send({ error: 'Custom emoji not found' });
        if (message.channel_id) {
          const channel = await db.channels.findById(message.channel_id);
          if (channel && emoji.server_id !== channel.server_id) {
            return reply.code(400).send({ error: 'Emoji does not belong to this server' });
          }
        }
        await db.sql`
          INSERT INTO message_reactions (message_id, user_id, reaction_type, custom_emoji_id)
          VALUES (${id}, ${request.user!.id}, 'custom', ${emojiId})
          ON CONFLICT (message_id, user_id, reaction_type, COALESCE(unicode_emoji, ''), COALESCE(custom_emoji_id, '00000000-0000-0000-0000-000000000000')) DO NOTHING
        `;
      } else {
        return reply.code(400).send({ error: 'Invalid reaction type' });
      }

      // Get updated reactions
      const rawReactions4 = await db.sql`
        SELECT
          mr.reaction_type as type,
          mr.unicode_emoji as emoji,
          mr.custom_emoji_id as "emojiId",
          COUNT(*)::int as count,
          BOOL_OR(mr.user_id = ${request.user!.id}) as me
        FROM message_reactions mr
        WHERE mr.message_id = ${id}
        GROUP BY mr.reaction_type, mr.unicode_emoji, mr.custom_emoji_id
      `;
      const reactions = await enrichReactions(rawReactions4);

      // Publish event
      const resourceId = message.channel_id ? `channel:${message.channel_id}` : `dm:${message.dm_channel_id}`;
      await publishEvent({
        type: message.channel_id ? 'message.update' : 'dm.message.update',
        actorId: request.user!.id,
        resourceId,
        payload: { message_id: id, action: 'add', reactions },
      });

      // Role reaction intercept for unicode and custom
      if (message.channel_id && ((type === 'unicode' && value) || (type === 'custom' && emojiId))) {
        const channel = await db.channels.findById(message.channel_id);
        if (channel) {
          const result = await assignRoleFromReaction(
            request.user!.id, channel.server_id, value || '', id,
            type === 'custom' ? emojiId : undefined
          );
          if (result) {
            const userRoles = await db.sql`
              SELECT r.id, r.name, r.color, r.position FROM member_roles mr JOIN roles r ON mr.role_id = r.id
              WHERE mr.member_user_id = ${request.user!.id} AND mr.member_server_id = ${channel.server_id}
              ORDER BY r.position DESC
            `;
            await publishEvent({
              type: 'member.update', resourceId: `server:${channel.server_id}`, actorId: null,
              payload: { user_id: request.user!.id, server_id: channel.server_id, roles: userRoles },
            });
            // If exclusive group removed other reactions, broadcast updated reaction counts
            if (result.removedReactions.length > 0) {
              const updatedReactions = await db.sql`
                SELECT
                  reaction_type as type, unicode_emoji as emoji, custom_emoji_id as "emojiId",
                  COUNT(*)::int as count, BOOL_OR(user_id = ${request.user!.id}) as me
                FROM message_reactions WHERE message_id = ${id}
                GROUP BY reaction_type, unicode_emoji, custom_emoji_id
              `;
              const enrichedReactions = await enrichReactions(updatedReactions);
              await publishEvent({
                type: 'message.update', actorId: request.user!.id,
                resourceId: `channel:${message.channel_id}`,
                payload: { message_id: id, action: 'remove', reactions: enrichedReactions },
              });
            }
          }
        }
      }

      return { reactions };
    },
  });

  /**
   * DELETE /messages/:id/reactions - Remove typed reaction (body-based)
   */
  fastify.delete<{ Params: { id: string } }>('/:id/reactions', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 30, timeWindow: '1 minute' },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const body = request.body as { reaction: { type: string; value?: string; emojiId?: string } };

      if (!body?.reaction?.type) {
        return reply.code(400).send({ error: 'Invalid reaction format' });
      }

      const { type, value, emojiId } = body.reaction;

      const message = await db.messages.findById(id);
      if (!message) return notFound(reply, 'Message');

      if (type === 'unicode' && value) {
        await db.sql`
          DELETE FROM message_reactions
          WHERE message_id = ${id} AND user_id = ${request.user!.id} AND reaction_type = 'unicode' AND unicode_emoji = ${value}
        `;
      } else if (type === 'custom' && emojiId) {
        await db.sql`
          DELETE FROM message_reactions
          WHERE message_id = ${id} AND user_id = ${request.user!.id} AND reaction_type = 'custom' AND custom_emoji_id = ${emojiId}
        `;
      } else {
        return reply.code(400).send({ error: 'Invalid reaction type' });
      }

      const rawReactions5 = await db.sql`
        SELECT
          mr.reaction_type as type, mr.unicode_emoji as emoji, mr.custom_emoji_id as "emojiId",
          COUNT(*)::int as count, BOOL_OR(mr.user_id = ${request.user!.id}) as me
        FROM message_reactions mr WHERE mr.message_id = ${id}
        GROUP BY mr.reaction_type, mr.unicode_emoji, mr.custom_emoji_id
      `;
      const reactions = await enrichReactions(rawReactions5);

      const resourceId = message.channel_id ? `channel:${message.channel_id}` : `dm:${message.dm_channel_id}`;
      await publishEvent({
        type: message.channel_id ? 'message.update' : 'dm.message.update',
        actorId: request.user!.id, resourceId,
        payload: { message_id: id, action: 'remove', reactions },
      });

      // Role reaction intercept for unicode and custom
      if (message.channel_id && ((type === 'unicode' && value) || (type === 'custom' && emojiId))) {
        const channel = await db.channels.findById(message.channel_id);
        if (channel) {
          const roleId = await removeRoleFromReaction(
            request.user!.id, channel.server_id, value || '', id,
            type === 'custom' ? emojiId : undefined
          );
          if (roleId) {
            const userRoles = await db.sql`
              SELECT r.id, r.name, r.color, r.position FROM member_roles mr JOIN roles r ON mr.role_id = r.id
              WHERE mr.member_user_id = ${request.user!.id} AND mr.member_server_id = ${channel.server_id}
              ORDER BY r.position DESC
            `;
            await publishEvent({
              type: 'member.update', resourceId: `server:${channel.server_id}`, actorId: null,
              payload: { user_id: request.user!.id, server_id: channel.server_id, roles: userRoles },
            });
          }
        }
      }

      return { reactions };
    },
  });

  /**
   * GET /messages/:id/preview - Compact message preview for link embedding.
   * Checks read permissions before returning.
   */
  fastify.get<{ Params: { id: string } }>('/:id/preview', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 60, timeWindow: '1 minute' },
    },
    handler: async (request, reply) => {
      const { id } = request.params;

      const message = await db.messages.findById(id);
      if (!message) return notFound(reply, 'Message');

      // Channel message: check read permission
      if (message.channel_id) {
        const channel = await db.channels.findById(message.channel_id);
        if (!channel) return notFound(reply, 'Channel');

        const perms = await calculatePermissions(request.user!.id, channel.server_id, message.channel_id);
        if (!hasPermission(perms.text, TextPermissions.READ_MESSAGE_HISTORY)) {
          return reply.code(403).send({ error: 'no_permission' });
        }

        const author = message.author_id ? await db.users.findById(message.author_id) : null;

        return {
          id: message.id,
          channel_id: message.channel_id,
          channel_name: channel.name,
          content_preview: (message.content || '').slice(0, 200),
          author: author
            ? { id: author.id, username: author.username, display_name: author.display_name || author.username, avatar_url: author.avatar_url }
            : null,
          created_at: message.created_at,
        };
      }

      // DM message: only participants can view
      if (message.dm_channel_id) {
        const [dm] = await db.sql`SELECT * FROM dm_channels WHERE id = ${message.dm_channel_id}`;
        if (!dm) return notFound(reply, 'DM channel');
        if (dm.user1_id !== request.user!.id && dm.user2_id !== request.user!.id) {
          return reply.code(403).send({ error: 'no_permission' });
        }

        const author = message.author_id ? await db.users.findById(message.author_id) : null;

        return {
          id: message.id,
          dm_channel_id: message.dm_channel_id,
          content_preview: (message.content || '').slice(0, 200),
          author: author
            ? { id: author.id, username: author.username, display_name: author.display_name || author.username, avatar_url: author.avatar_url }
            : null,
          created_at: message.created_at,
        };
      }

      return notFound(reply, 'Message');
    },
  });
};
