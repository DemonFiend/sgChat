import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { UserStatus, usernameSchema, updateStatusSchema, updateCustomStatusSchema } from '@sgchat/shared';
import { z } from 'zod';
import { notFound, badRequest } from '../utils/errors.js';

const updateProfileSchema = z.object({
  username: usernameSchema.optional(),
  avatar_url: z.string().url().nullable().optional(),
});

export const userRoutes: FastifyPluginAsync = async (fastify) => {
  // Get current user
  fastify.get('/me', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const user = await db.users.findById(request.user!.id);
      if (!user) {
        return notFound(reply, 'User');
      }

      const { password_hash: _, ...safeUser } = user;
      return safeUser;
    },
  });

  // Update profile
  fastify.patch('/me', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const body = updateProfileSchema.parse(request.body);
      
      // Check if username is taken
      if (body.username) {
        const existing = await db.users.findByUsername(body.username);
        if (existing && existing.id !== request.user!.id) {
          return badRequest(reply, 'Username already taken');
        }
      }

      const updates: any = {};
      if (body.username) updates.username = body.username;
      if ('avatar_url' in body) updates.avatar_url = body.avatar_url;
      updates.updated_at = new Date();

      await db.sql`
        UPDATE users
        SET ${db.sql(updates)}
        WHERE id = ${request.user!.id}
      `;

      // Broadcast profile update to all connected clients
      const user = await db.users.findById(request.user!.id);
      const { password_hash: _, ...safeUser } = user;
      fastify.io?.to(`user:${request.user!.id}`).emit('user:update', safeUser);

      return safeUser;
    },
  });

  // Update status
  fastify.patch('/me/status', {
    onRequest: [authenticate],
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute',
      },
    },
    handler: async (request, reply) => {
      const { status } = updateStatusSchema.parse(request.body);

      await db.users.updateStatus(request.user!.id, status as UserStatus);
      await redis.setPresence(request.user!.id, true); // Status update means user is online

      // Broadcast status update to all servers user is in
      const servers = await db.servers.findByUserId(request.user!.id);
      for (const server of servers) {
        fastify.io?.to(`server:${server.id}`).emit('presence:update', {
          user_id: request.user!.id,
          status,
        });
      }

      return { status };
    },
  });

  // Update custom status
  fastify.patch('/me/custom-status', {
    onRequest: [authenticate],
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
    handler: async (request, reply) => {
      const body = updateCustomStatusSchema.parse(request.body);

      await db.sql`
        UPDATE users
        SET 
          custom_status_emoji = ${body.emoji ?? null},
          custom_status_text = ${body.text ?? null},
          custom_status_expires_at = ${body.expires_at ? new Date(body.expires_at) : null},
          updated_at = NOW()
        WHERE id = ${request.user!.id}
      `;

      // Broadcast custom status update
      const servers = await db.servers.findByUserId(request.user!.id);
      for (const server of servers) {
        fastify.io?.to(`server:${server.id}`).emit('presence:update', {
          user_id: request.user!.id,
          custom_status: {
            emoji: body.emoji,
            text: body.text,
            expires_at: body.expires_at,
          },
        });
      }

      return { message: 'Custom status updated' };
    },
  });

  // Update push token
  fastify.post('/me/push-token', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { token } = request.body as { token: string };

      await db.sql`
        UPDATE users
        SET push_token = ${token}, updated_at = NOW()
        WHERE id = ${request.user!.id}
      `;

      return { message: 'Push token registered' };
    },
  });

  // Get user settings
  fastify.get('/me/settings', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const [settings] = await db.sql`
        SELECT * FROM user_settings
        WHERE user_id = ${request.user!.id}
      `;

      return settings || {};
    },
  });

  // Update user settings
  fastify.patch('/me/settings', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const body = request.body as Record<string, any>;
      
      const updates: any = { ...body, user_id: request.user!.id };
      updates.updated_at = new Date();

      await db.sql`
        INSERT INTO user_settings ${db.sql(updates)}
        ON CONFLICT (user_id)
        DO UPDATE SET ${db.sql(updates)}
      `;

      return { message: 'Settings updated' };
    },
  });
};
