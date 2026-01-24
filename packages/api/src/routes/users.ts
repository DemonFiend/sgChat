import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { storage } from '../lib/storage.js';
import { UserStatus, usernameSchema, updateStatusSchema, updateCustomStatusSchema } from '@sgchat/shared';
import { z } from 'zod';
import { notFound, badRequest, unauthorized } from '../utils/errors.js';
import argon2 from 'argon2';

const updateProfileSchema = z.object({
  username: usernameSchema.optional(),
  avatar_url: z.string().url().nullable().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

const changeEmailSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const userRoutes: FastifyPluginAsync = async (fastify) => {
  // Get current user with roles and permissions per server
  fastify.get('/me', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const user = await db.users.findById(request.user!.id);
      if (!user) {
        return notFound(reply, 'User');
      }

      const { password_hash: _, ...safeUser } = user;

      // Get user's server memberships with roles
      const memberships = await db.sql`
        SELECT 
          m.server_id,
          m.nickname,
          m.joined_at,
          s.name as server_name,
          s.owner_id
        FROM members m
        JOIN servers s ON s.id = m.server_id
        WHERE m.user_id = ${request.user!.id}
      `;

      // For each server, get roles and compute permissions
      const servers = await Promise.all(memberships.map(async (membership: any) => {
        const isOwner = membership.owner_id === request.user!.id;

        // Get roles for this member
        const roles = await db.sql`
          SELECT r.id, r.name, r.color, r.position, 
                 r.server_permissions, r.text_permissions, r.voice_permissions
          FROM roles r
          JOIN member_roles mr ON mr.role_id = r.id
          WHERE mr.member_user_id = ${request.user!.id}
            AND mr.member_server_id = ${membership.server_id}
          ORDER BY r.position DESC
        `;

        // Include @everyone role
        const [everyoneRole] = await db.sql`
          SELECT id, name, color, position, 
                 server_permissions, text_permissions, voice_permissions
          FROM roles
          WHERE server_id = ${membership.server_id} AND name = '@everyone'
        `;

        const allRoles = everyoneRole ? [...roles, everyoneRole] : roles;

        // Compute combined permissions (owner has all perms)
        let serverPerms = 0, textPerms = 0, voicePerms = 0;
        
        if (isOwner) {
          // Owner has all permissions
          serverPerms = 0xFFFFFFFF;
          textPerms = 0xFFFFFFFF;
          voicePerms = 0xFFFFFFFF;
        } else {
          // Combine all role permissions (bitwise OR)
          for (const role of allRoles) {
            serverPerms |= role.server_permissions || 0;
            textPerms |= role.text_permissions || 0;
            voicePerms |= role.voice_permissions || 0;
          }
        }

        return {
          server_id: membership.server_id,
          server_name: membership.server_name,
          nickname: membership.nickname,
          joined_at: membership.joined_at,
          is_owner: isOwner,
          roles: allRoles.map((r: any) => ({
            id: r.id,
            name: r.name,
            color: r.color,
            position: r.position,
          })),
          permissions: {
            server: serverPerms,
            text: textPerms,
            voice: voicePerms,
          },
        };
      }));

      return {
        ...safeUser,
        servers,
      };
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

  // Change password
  fastify.post('/me/password', {
    onRequest: [authenticate],
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 hour',
      },
    },
    handler: async (request, reply) => {
      const { currentPassword, newPassword } = changePasswordSchema.parse(request.body);

      const user = await db.users.findById(request.user!.id);
      if (!user) {
        return notFound(reply, 'User');
      }

      // Verify current password
      const isValid = await argon2.verify(user.password_hash, currentPassword);
      if (!isValid) {
        return unauthorized(reply, 'Current password is incorrect');
      }

      // Hash new password and update
      const newHash = await argon2.hash(newPassword);
      await db.sql`
        UPDATE users
        SET password_hash = ${newHash}, updated_at = NOW()
        WHERE id = ${request.user!.id}
      `;

      // Invalidate all refresh tokens for this user
      await redis.deleteSession(request.user!.id);

      return { message: 'Password changed successfully' };
    },
  });

  // Change email
  fastify.post('/me/email', {
    onRequest: [authenticate],
    config: {
      rateLimit: {
        max: 3,
        timeWindow: '1 hour',
      },
    },
    handler: async (request, reply) => {
      const { email, password } = changeEmailSchema.parse(request.body);

      const user = await db.users.findById(request.user!.id);
      if (!user) {
        return notFound(reply, 'User');
      }

      // Verify password
      const isValid = await argon2.verify(user.password_hash, password);
      if (!isValid) {
        return unauthorized(reply, 'Password is incorrect');
      }

      // Check if email is already in use
      const existing = await db.users.findByEmail(email);
      if (existing && existing.id !== request.user!.id) {
        return badRequest(reply, 'Email already in use');
      }

      // Update email
      await db.sql`
        UPDATE users
        SET email = ${email}, updated_at = NOW()
        WHERE id = ${request.user!.id}
      `;

      return { message: 'Email changed successfully', email };
    },
  });

  // Upload avatar
  fastify.post('/me/avatar', {
    onRequest: [authenticate],
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 hour',
      },
    },
    handler: async (request, reply) => {
      const data = await request.file();
      if (!data) {
        return badRequest(reply, 'No file uploaded');
      }

      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(data.mimetype)) {
        return badRequest(reply, 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP');
      }

      // Get current user to delete old avatar if exists
      const user = await db.users.findById(request.user!.id);
      if (user?.avatar_url) {
        await storage.deleteAvatar(user.avatar_url);
      }

      // Upload new avatar
      const buffer = await data.toBuffer();
      const avatarUrl = await storage.uploadAvatar(request.user!.id, buffer, data.mimetype);

      // Update user record
      await db.sql`
        UPDATE users
        SET avatar_url = ${avatarUrl}, updated_at = NOW()
        WHERE id = ${request.user!.id}
      `;

      // Broadcast update
      const updatedUser = await db.users.findById(request.user!.id);
      const { password_hash: _, ...safeUser } = updatedUser;
      fastify.io?.to(`user:${request.user!.id}`).emit('user:update', safeUser);

      return { avatar_url: avatarUrl };
    },
  });

  // Delete avatar
  fastify.delete('/me/avatar', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const user = await db.users.findById(request.user!.id);
      if (!user?.avatar_url) {
        return badRequest(reply, 'No avatar to delete');
      }

      // Delete from storage
      await storage.deleteAvatar(user.avatar_url);

      // Update user record
      await db.sql`
        UPDATE users
        SET avatar_url = NULL, updated_at = NOW()
        WHERE id = ${request.user!.id}
      `;

      // Broadcast update
      const updatedUser = await db.users.findById(request.user!.id);
      const { password_hash: _, ...safeUser } = updatedUser;
      fastify.io?.to(`user:${request.user!.id}`).emit('user:update', safeUser);

      return { message: 'Avatar deleted' };
    },
  });

  // Get another user's profile (limited info)
  fastify.get('/:userId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { userId } = request.params as { userId: string };

      const user = await db.users.findById(userId);
      if (!user) {
        return notFound(reply, 'User');
      }

      // Return limited public profile
      return {
        id: user.id,
        username: user.username,
        avatar_url: user.avatar_url,
        status: user.status,
        custom_status_emoji: user.custom_status_emoji,
        custom_status_text: user.custom_status_text,
        created_at: user.created_at,
      };
    },
  });
};
