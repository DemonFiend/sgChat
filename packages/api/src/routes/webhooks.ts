import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { sql } from '../lib/db.js';
import { publishEvent } from '../lib/eventBus.js';
import { calculatePermissions } from '../services/permissions.js';
import { ServerPermissions, hasPermission, createWebhookSchema } from '@sgchat/shared';
import { notFound, forbidden, badRequest } from '../utils/errors.js';
import { sanitizeMessage } from '../utils/sanitize.js';
import { resolveTextMentions } from '../utils/mentionResolver.js';

export const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /webhooks?server_id=X - List webhooks for the server
  fastify.get('/', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { server_id } = request.query as { server_id?: string };
      if (!server_id) return badRequest(reply, 'server_id query parameter is required');

      // Check MANAGE_WEBHOOKS permission
      const perms = await calculatePermissions(request.user!.id, server_id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_WEBHOOKS)) {
        return forbidden(reply, 'Missing MANAGE_WEBHOOKS permission');
      }

      const webhooks = await sql`
        SELECT w.*, c.name as channel_name, u.username as created_by_username
        FROM webhooks w
        LEFT JOIN channels c ON w.channel_id = c.id
        LEFT JOIN users u ON w.created_by = u.id
        WHERE w.server_id = ${server_id}
        ORDER BY w.created_at DESC
      `;

      return { webhooks };
    },
  });

  // POST /webhooks - Create a webhook
  fastify.post('/', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
    handler: async (request, reply) => {
      const body = createWebhookSchema.parse(request.body);

      // Verify the channel exists and get its server_id
      const [channel] = await sql`
        SELECT id, server_id, name, type FROM channels WHERE id = ${body.channel_id}
      `;
      if (!channel) return notFound(reply, 'Channel');

      // Only text-type channels
      if (channel.type !== 'text' && channel.type !== 'announcement') {
        return badRequest(reply, 'Webhooks can only be created for text or announcement channels');
      }

      // Check MANAGE_WEBHOOKS permission
      const perms = await calculatePermissions(request.user!.id, channel.server_id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_WEBHOOKS)) {
        return forbidden(reply, 'Missing MANAGE_WEBHOOKS permission');
      }

      const [webhook] = await sql`
        INSERT INTO webhooks (server_id, channel_id, name, avatar_url, created_by)
        VALUES (${channel.server_id}, ${body.channel_id}, ${body.name}, ${body.avatar_url || null}, ${request.user!.id})
        RETURNING *
      `;

      return reply.status(201).send(webhook);
    },
  });

  // PATCH /webhooks/:id - Update a webhook
  fastify.patch('/:id', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { name?: string; avatar_url?: string | null; channel_id?: string };

      const [webhook] = await sql`
        SELECT * FROM webhooks WHERE id = ${id}
      `;
      if (!webhook) return notFound(reply, 'Webhook');

      // Check MANAGE_WEBHOOKS permission
      const perms = await calculatePermissions(request.user!.id, webhook.server_id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_WEBHOOKS)) {
        return forbidden(reply, 'Missing MANAGE_WEBHOOKS permission');
      }

      // Validate channel_id if provided
      if (body.channel_id) {
        const [channel] = await sql`
          SELECT id, server_id FROM channels WHERE id = ${body.channel_id}
        `;
        if (!channel || channel.server_id !== webhook.server_id) {
          return badRequest(reply, 'Invalid channel_id');
        }
      }

      const name = body.name ?? webhook.name;
      const avatar_url = body.avatar_url !== undefined ? body.avatar_url : webhook.avatar_url;
      const channel_id = body.channel_id ?? webhook.channel_id;

      const [updated] = await sql`
        UPDATE webhooks
        SET name = ${name}, avatar_url = ${avatar_url}, channel_id = ${channel_id}
        WHERE id = ${id}
        RETURNING *
      `;

      return updated;
    },
  });

  // DELETE /webhooks/:id - Delete a webhook
  fastify.delete('/:id', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };

      const [webhook] = await sql`
        SELECT * FROM webhooks WHERE id = ${id}
      `;
      if (!webhook) return notFound(reply, 'Webhook');

      // Check MANAGE_WEBHOOKS permission
      const perms = await calculatePermissions(request.user!.id, webhook.server_id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_WEBHOOKS)) {
        return forbidden(reply, 'Missing MANAGE_WEBHOOKS permission');
      }

      await sql`DELETE FROM webhooks WHERE id = ${id}`;

      return reply.status(204).send();
    },
  });

  // POST /webhooks/:id/:token - Execute a webhook (send a message)
  // No authentication required - the token IS the authentication
  fastify.post('/:id/:token', {
    config: {
      rateLimit: { max: 30, timeWindow: '1 minute' },
    },
    handler: async (request, reply) => {
      const { id, token } = request.params as { id: string; token: string };
      const body = request.body as { content?: string; username?: string; avatar_url?: string };

      // Validate the webhook by ID and token
      const [webhook] = await sql`
        SELECT w.*
        FROM webhooks w
        WHERE w.id = ${id} AND w.token = ${token}
      `;
      if (!webhook) return notFound(reply, 'Webhook');

      if (!body.content || body.content.trim().length === 0) {
        return badRequest(reply, 'Message content is required');
      }

      if (body.content.length > 4000) {
        return badRequest(reply, 'Message content must be at most 4000 characters');
      }

      // Sanitize message content
      let content = sanitizeMessage(body.content);
      content = await resolveTextMentions(content, webhook.server_id);

      // Use the webhook name/avatar or override from the request body
      const displayName = body.username || webhook.name;
      const displayAvatar = body.avatar_url || webhook.avatar_url;

      // Create the message with author_id = null (webhook message)
      const [message] = await sql`
        INSERT INTO messages (channel_id, author_id, content, attachments, status)
        VALUES (${webhook.channel_id}, ${null}, ${content}, ${JSON.stringify([])}, 'sent')
        RETURNING *
      `;

      // Format the message payload with webhook info
      const formattedMessage = {
        id: message.id,
        channel_id: webhook.channel_id,
        content: message.content,
        author: null,
        webhook: {
          id: webhook.id,
          name: displayName,
          avatar_url: displayAvatar,
        },
        created_at: message.created_at,
        edited_at: message.edited_at,
        attachments: [],
        reactions: [],
        reply_to_id: null,
      };

      // Publish through event bus
      await publishEvent({
        type: 'message.new',
        actorId: webhook.id, // Use webhook ID as the actor
        resourceId: `channel:${webhook.channel_id}`,
        payload: formattedMessage,
      });

      return formattedMessage;
    },
  });
};
