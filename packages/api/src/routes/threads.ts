import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { sql, db } from '../lib/db.js';
import { calculatePermissions, canAccessChannel } from '../services/permissions.js';
import { publishEvent } from '../lib/eventBus.js';
import {
  ServerPermissions,
  TextPermissions,
  hasPermission,
  createThreadSchema,
  updateThreadSchema,
  sendMessageSchema,
} from '@sgchat/shared';
import { notFound, forbidden, badRequest } from '../utils/errors.js';
import { sanitizeMessage } from '../utils/sanitize.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const threadRoutes: FastifyPluginAsync = async (fastify) => {
  // ============================================================
  // GET /channels/:id/threads - List threads for a channel
  // ============================================================
  fastify.get('/channels/:id/threads', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };

      if (!UUID_REGEX.test(id)) {
        return badRequest(reply, 'Invalid channel ID');
      }

      const canAccess = await canAccessChannel(request.user!.id, id);
      if (!canAccess) {
        return forbidden(reply, 'Cannot access this channel');
      }

      const threads = await sql`
        SELECT t.*,
          u.username as creator_username,
          u.avatar_url as creator_avatar_url
        FROM threads t
        LEFT JOIN users u ON t.creator_id = u.id
        WHERE t.channel_id = ${id}
        ORDER BY t.last_message_at DESC NULLS LAST, t.created_at DESC
      `;

      return { threads };
    },
  });

  // ============================================================
  // POST /threads - Create a thread
  // ============================================================
  fastify.post('/threads', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 5, timeWindow: '10 seconds' },
    },
    handler: async (request, reply) => {
      const body = createThreadSchema.parse(request.body);
      const userId = request.user!.id;

      // Validate channel exists
      const channel = await db.channels.findById(body.channel_id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      // Only text-based channels can have threads
      if (channel.type !== 'text' && channel.type !== 'announcement') {
        return badRequest(reply, 'Threads can only be created in text channels');
      }

      // Check permissions
      const perms = await calculatePermissions(userId, channel.server_id, body.channel_id);

      if (body.is_private) {
        if (
          !hasPermission(perms.server, ServerPermissions.CREATE_PRIVATE_THREADS) &&
          !hasPermission(perms.text, TextPermissions.CREATE_PRIVATE_THREADS)
        ) {
          return forbidden(reply, 'Missing CREATE_PRIVATE_THREADS permission');
        }
      } else {
        if (
          !hasPermission(perms.server, ServerPermissions.CREATE_PUBLIC_THREADS) &&
          !hasPermission(perms.text, TextPermissions.CREATE_PUBLIC_THREADS)
        ) {
          return forbidden(reply, 'Missing CREATE_PUBLIC_THREADS permission');
        }
      }

      // Validate parent message if provided
      if (body.parent_message_id) {
        const [parentMsg] = await sql`
          SELECT id, channel_id FROM messages WHERE id = ${body.parent_message_id}
        `;
        if (!parentMsg) {
          return notFound(reply, 'Parent message');
        }
        if (parentMsg.channel_id !== body.channel_id) {
          return badRequest(reply, 'Parent message does not belong to this channel');
        }

        // Check if a thread already exists for this message
        const [existing] = await sql`
          SELECT id FROM threads WHERE parent_message_id = ${body.parent_message_id}
        `;
        if (existing) {
          return badRequest(reply, 'A thread already exists for this message');
        }
      }

      // Create the thread
      const [thread] = await sql`
        INSERT INTO threads (
          channel_id, server_id, parent_message_id,
          name, creator_id, is_private
        )
        VALUES (
          ${body.channel_id},
          ${channel.server_id},
          ${body.parent_message_id || null},
          ${body.name},
          ${userId},
          ${body.is_private || false}
        )
        RETURNING *
      `;

      // If initial message provided, create it
      if (body.initial_message) {
        const content = sanitizeMessage(body.initial_message);
        const [msg] = await sql`
          INSERT INTO messages (
            channel_id, author_id, content, thread_id, attachments
          )
          VALUES (
            ${body.channel_id},
            ${userId},
            ${content},
            ${thread.id},
            '[]'
          )
          RETURNING *
        `;

        // Update thread counts
        await sql`
          UPDATE threads
          SET message_count = 1, last_message_at = ${msg.created_at}
          WHERE id = ${thread.id}
        `;
        thread.message_count = 1;
        thread.last_message_at = msg.created_at;
      }

      // Get creator info
      const creator = await db.users.findById(userId);

      const threadPayload = {
        ...thread,
        creator_username: creator.username,
        creator_avatar_url: creator.avatar_url,
      };

      // Publish event
      await publishEvent({
        type: 'thread.create',
        actorId: userId,
        resourceId: `channel:${body.channel_id}`,
        payload: threadPayload,
      });

      return threadPayload;
    },
  });

  // ============================================================
  // GET /threads/:id - Get thread details
  // ============================================================
  fastify.get('/threads/:id', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };

      if (!UUID_REGEX.test(id)) {
        return badRequest(reply, 'Invalid thread ID');
      }

      const [thread] = await sql`
        SELECT t.*,
          u.username as creator_username,
          u.avatar_url as creator_avatar_url
        FROM threads t
        LEFT JOIN users u ON t.creator_id = u.id
        WHERE t.id = ${id}
      `;

      if (!thread) {
        return notFound(reply, 'Thread');
      }

      // Check channel access
      const canAccess = await canAccessChannel(request.user!.id, thread.channel_id);
      if (!canAccess) {
        return forbidden(reply, 'Cannot access this thread');
      }

      return thread;
    },
  });

  // ============================================================
  // GET /threads/:id/messages - Get messages in a thread
  // ============================================================
  fastify.get('/threads/:id/messages', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const { limit, before } = request.query as { limit?: string; before?: string };

      if (!UUID_REGEX.test(id)) {
        return badRequest(reply, 'Invalid thread ID');
      }

      const [thread] = await sql`SELECT * FROM threads WHERE id = ${id}`;
      if (!thread) {
        return notFound(reply, 'Thread');
      }

      // Check channel access
      const canAccess = await canAccessChannel(request.user!.id, thread.channel_id);
      if (!canAccess) {
        return forbidden(reply, 'Cannot access this thread');
      }

      const msgLimit = Math.min(parseInt(limit || '50', 10) || 50, 100);

      let messages;
      if (before && UUID_REGEX.test(before)) {
        messages = await sql`
          SELECT m.*,
            u.username as author_username,
            u.display_name as author_display_name,
            u.avatar_url as author_avatar_url,
            (
              SELECT r.color FROM roles r
              INNER JOIN member_roles mr ON r.id = mr.role_id
              WHERE mr.member_user_id = m.author_id AND mr.member_server_id = ${thread.server_id}
              ORDER BY r.position DESC LIMIT 1
            ) as author_role_color
          FROM messages m
          LEFT JOIN users u ON m.author_id = u.id
          WHERE m.thread_id = ${id}
            AND m.created_at < (SELECT created_at FROM messages WHERE id = ${before})
          ORDER BY m.created_at DESC
          LIMIT ${msgLimit}
        `;
      } else {
        messages = await sql`
          SELECT m.*,
            u.username as author_username,
            u.display_name as author_display_name,
            u.avatar_url as author_avatar_url,
            (
              SELECT r.color FROM roles r
              INNER JOIN member_roles mr ON r.id = mr.role_id
              WHERE mr.member_user_id = m.author_id AND mr.member_server_id = ${thread.server_id}
              ORDER BY r.position DESC LIMIT 1
            ) as author_role_color
          FROM messages m
          LEFT JOIN users u ON m.author_id = u.id
          WHERE m.thread_id = ${id}
          ORDER BY m.created_at DESC
          LIMIT ${msgLimit}
        `;
      }

      const formattedMessages = messages.reverse().map((m: any) => ({
        id: m.id,
        channel_id: thread.channel_id,
        thread_id: id,
        content: m.content,
        author: {
          id: m.author_id,
          username: m.author_username,
          display_name: m.author_display_name || m.author_username,
          avatar_url: m.author_avatar_url,
          role_color: m.author_role_color || null,
        },
        created_at: m.created_at,
        edited_at: m.edited_at,
        attachments: m.attachments || [],
        reply_to_id: m.reply_to_id,
        reactions: [],
      }));

      return { messages: formattedMessages };
    },
  });

  // ============================================================
  // POST /threads/:id/messages - Send message to thread
  // ============================================================
  fastify.post('/threads/:id/messages', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 5, timeWindow: '5 seconds' },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = sendMessageSchema.parse(request.body);
      const userId = request.user!.id;

      if (!UUID_REGEX.test(id)) {
        return badRequest(reply, 'Invalid thread ID');
      }

      const [thread] = await sql`SELECT * FROM threads WHERE id = ${id}`;
      if (!thread) {
        return notFound(reply, 'Thread');
      }

      if (thread.is_archived) {
        return forbidden(reply, 'This thread is archived');
      }
      if (thread.is_locked) {
        // Only users with MANAGE_THREADS can post in locked threads
        const perms = await calculatePermissions(userId, thread.server_id, thread.channel_id);
        if (
          !hasPermission(perms.server, ServerPermissions.MANAGE_THREADS) &&
          !hasPermission(perms.text, TextPermissions.MANAGE_THREADS)
        ) {
          return forbidden(reply, 'This thread is locked');
        }
      }

      // Check channel access and SEND_MESSAGES_IN_THREADS permission
      const canAccess = await canAccessChannel(userId, thread.channel_id);
      if (!canAccess) {
        return forbidden(reply, 'Cannot access this thread');
      }

      const perms = await calculatePermissions(userId, thread.server_id, thread.channel_id);
      if (!hasPermission(perms.text, TextPermissions.SEND_MESSAGES_IN_THREADS)) {
        return forbidden(reply, 'Missing SEND_MESSAGES_IN_THREADS permission');
      }

      // Sanitize and create message
      const content = sanitizeMessage(body.content);

      const [message] = await sql`
        INSERT INTO messages (
          channel_id, author_id, content, thread_id,
          reply_to_id, attachments, is_tts
        )
        VALUES (
          ${thread.channel_id},
          ${userId},
          ${content},
          ${id},
          ${body.reply_to_id || null},
          ${JSON.stringify(body.attachments || [])},
          ${body.is_tts || false}
        )
        RETURNING *
      `;

      // Update thread message_count and last_message_at
      await sql`
        UPDATE threads
        SET message_count = message_count + 1,
            last_message_at = ${message.created_at}
        WHERE id = ${id}
      `;

      // Get author info
      const author = await db.users.findById(userId);

      const formattedMessage = {
        id: message.id,
        channel_id: thread.channel_id,
        thread_id: id,
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
        reactions: [],
        reply_to_id: message.reply_to_id || null,
      };

      // Publish message event scoped to thread
      await publishEvent({
        type: 'message.new',
        actorId: userId,
        resourceId: `thread:${id}`,
        payload: formattedMessage,
      });

      // Also publish a thread update to the channel so the main chat knows
      await publishEvent({
        type: 'thread.update',
        actorId: userId,
        resourceId: `channel:${thread.channel_id}`,
        payload: {
          id: thread.id,
          channel_id: thread.channel_id,
          message_count: thread.message_count + 1,
          last_message_at: message.created_at,
        },
      });

      return formattedMessage;
    },
  });

  // ============================================================
  // PATCH /threads/:id - Update thread (archive/lock/rename)
  // ============================================================
  fastify.patch('/threads/:id', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = updateThreadSchema.parse(request.body);
      const userId = request.user!.id;

      if (!UUID_REGEX.test(id)) {
        return badRequest(reply, 'Invalid thread ID');
      }

      const [thread] = await sql`SELECT * FROM threads WHERE id = ${id}`;
      if (!thread) {
        return notFound(reply, 'Thread');
      }

      // Check permissions - thread creator can rename, MANAGE_THREADS can do everything
      const perms = await calculatePermissions(userId, thread.server_id, thread.channel_id);
      const canManage =
        hasPermission(perms.server, ServerPermissions.MANAGE_THREADS) ||
        hasPermission(perms.text, TextPermissions.MANAGE_THREADS);

      if (!canManage && thread.creator_id !== userId) {
        return forbidden(reply, 'Missing MANAGE_THREADS permission');
      }

      // Non-managers can only rename their own threads
      if (!canManage) {
        if (body.is_archived !== undefined || body.is_locked !== undefined) {
          return forbidden(reply, 'Missing MANAGE_THREADS permission to archive/lock threads');
        }
      }

      const updates: Record<string, any> = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.is_archived !== undefined) updates.is_archived = body.is_archived;
      if (body.is_locked !== undefined) updates.is_locked = body.is_locked;

      if (Object.keys(updates).length === 0) {
        return badRequest(reply, 'No updates provided');
      }

      const [updated] = await sql`
        UPDATE threads
        SET ${sql(updates)}
        WHERE id = ${id}
        RETURNING *
      `;

      await publishEvent({
        type: 'thread.update',
        actorId: userId,
        resourceId: `channel:${thread.channel_id}`,
        payload: updated,
      });

      return updated;
    },
  });

  // ============================================================
  // DELETE /threads/:id - Delete thread
  // ============================================================
  fastify.delete('/threads/:id', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = request.user!.id;

      if (!UUID_REGEX.test(id)) {
        return badRequest(reply, 'Invalid thread ID');
      }

      const [thread] = await sql`SELECT * FROM threads WHERE id = ${id}`;
      if (!thread) {
        return notFound(reply, 'Thread');
      }

      // Check MANAGE_THREADS permission
      const perms = await calculatePermissions(userId, thread.server_id, thread.channel_id);
      if (
        !hasPermission(perms.server, ServerPermissions.MANAGE_THREADS) &&
        !hasPermission(perms.text, TextPermissions.MANAGE_THREADS)
      ) {
        return forbidden(reply, 'Missing MANAGE_THREADS permission');
      }

      await sql`DELETE FROM threads WHERE id = ${id}`;

      await publishEvent({
        type: 'thread.delete',
        actorId: userId,
        resourceId: `channel:${thread.channel_id}`,
        payload: { id, channel_id: thread.channel_id },
      });

      return { success: true };
    },
  });
};
