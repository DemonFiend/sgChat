/**
 * A4: Live Notifications (Core)
 *
 * REST endpoints for the notification system.
 * Notifications are created by server-side logic (friend requests, mentions,
 * reactions, etc.) and delivered in real-time via the event bus.
 *
 * Endpoints:
 *   GET    /notifications           — list notifications (paginated, filterable)
 *   GET    /notifications/unread-count — quick unread badge count
 *   PATCH  /notifications/:id/read  — mark a single notification as read
 *   POST   /notifications/read-all  — mark all notifications as read
 *   DELETE /notifications/:id       — dismiss a notification
 */

import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { publishEvent } from '../lib/eventBus.js';
import { notFound, badRequest } from '../utils/errors.js';
import { z } from 'zod';

// ── Notification helper: create + push ─────────────────────────
// Other modules (friends, messages, etc.) import this to generate
// notifications, keeping the notification logic centralised here.

export interface CreateNotificationOpts {
  userId: string;
  type: string;
  data: Record<string, unknown>;
  priority?: 'low' | 'normal' | 'high';
}

/**
 * Insert a notification row and push it over the event bus.
 * Returns the created notification.
 */
export async function createNotification(opts: CreateNotificationOpts) {
  const { userId, type, data, priority = 'normal' } = opts;

  const [notification] = await db.sql`
    INSERT INTO notifications (user_id, type, data, priority)
    VALUES (${userId}, ${type}, ${JSON.stringify(data)}, ${priority})
    RETURNING *
  `;

  // Push real-time event to the user's personal room
  await publishEvent({
    type: 'notification.new',
    actorId: null, // system-generated
    resourceId: `user:${userId}`,
    payload: notification,
  });

  return notification;
}

// ── Query helpers ──────────────────────────────────────────────

const listQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  before: z.string().uuid().optional(),          // cursor: notifications before this id
  type: z.string().optional(),                    // filter by type
  unread_only: z.coerce.boolean().default(false), // only unread
});

// ── Routes ─────────────────────────────────────────────────────

export const notificationRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /notifications — paginated list
  fastify.get('/', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const userId = request.user!.id;
      const query = listQuerySchema.parse(request.query);

      let whereClause = db.sql`WHERE n.user_id = ${userId}`;

      // Cursor-based pagination
      if (query.before) {
        const [ref] = await db.sql`
          SELECT created_at FROM notifications WHERE id = ${query.before}
        `;
        if (ref) {
          whereClause = db.sql`
            WHERE n.user_id = ${userId}
              AND n.created_at < ${ref.created_at}
          `;
        }
      }

      // We build the query with conditional filters
      let results;
      if (query.unread_only && query.type) {
        results = await db.sql`
          SELECT n.* FROM notifications n
          ${whereClause}
            AND n.read_at IS NULL
            AND n.type = ${query.type}
          ORDER BY n.created_at DESC
          LIMIT ${query.limit}
        `;
      } else if (query.unread_only) {
        results = await db.sql`
          SELECT n.* FROM notifications n
          ${whereClause}
            AND n.read_at IS NULL
          ORDER BY n.created_at DESC
          LIMIT ${query.limit}
        `;
      } else if (query.type) {
        results = await db.sql`
          SELECT n.* FROM notifications n
          ${whereClause}
            AND n.type = ${query.type}
          ORDER BY n.created_at DESC
          LIMIT ${query.limit}
        `;
      } else {
        results = await db.sql`
          SELECT n.* FROM notifications n
          ${whereClause}
          ORDER BY n.created_at DESC
          LIMIT ${query.limit}
        `;
      }

      return {
        notifications: results,
        has_more: results.length === query.limit,
      };
    },
  });

  // GET /notifications/unread-count — lightweight badge count
  fastify.get('/unread-count', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const userId = request.user!.id;

      const [row] = await db.sql`
        SELECT COUNT(*)::int AS count
        FROM notifications
        WHERE user_id = ${userId} AND read_at IS NULL
      `;

      return { count: row?.count ?? 0 };
    },
  });

  // PATCH /notifications/:id/read — mark one notification read/unread
  fastify.patch('/:id/read', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = request.user!.id;

      const [notification] = await db.sql`
        SELECT * FROM notifications
        WHERE id = ${id} AND user_id = ${userId}
      `;

      if (!notification) {
        return notFound(reply, 'Notification');
      }

      // Toggle or explicit set
      const body = (request.body as any) || {};
      const readAt = body.read === false ? null : new Date();

      const [updated] = await db.sql`
        UPDATE notifications
        SET read_at = ${readAt}
        WHERE id = ${id}
        RETURNING *
      `;

      // Broadcast read event so other devices stay in sync
      await publishEvent({
        type: 'notification.read',
        actorId: userId,
        resourceId: `user:${userId}`,
        payload: {
          id: updated.id,
          read_at: updated.read_at,
        },
      });

      return updated;
    },
  });

  // POST /notifications/read-all — mark all as read
  fastify.post('/read-all', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const userId = request.user!.id;
      const body = (request.body as any) || {};
      const before = body.before ? new Date(body.before) : new Date();

      const result = await db.sql`
        UPDATE notifications
        SET read_at = NOW()
        WHERE user_id = ${userId}
          AND read_at IS NULL
          AND created_at <= ${before}
      `;

      // Broadcast bulk-read event
      await publishEvent({
        type: 'notification.read',
        actorId: userId,
        resourceId: `user:${userId}`,
        payload: {
          all: true,
          before: before.toISOString(),
        },
      });

      return { message: 'All notifications marked as read' };
    },
  });

  // DELETE /notifications/:id — dismiss a notification
  fastify.delete('/:id', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = request.user!.id;

      const deleted = await db.sql`
        DELETE FROM notifications
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING id
      `;

      if (deleted.length === 0) {
        return notFound(reply, 'Notification');
      }

      return { message: 'Notification dismissed' };
    },
  });
};
