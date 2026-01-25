import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { storage } from '../lib/storage.js';
import { UserStatus, usernameSchema, updateStatusSchema, updateCustomStatusSchema, toNamedPermissions } from '@sgchat/shared';
import { z } from 'zod';
import { notFound, badRequest, unauthorized, forbidden } from '../utils/errors.js';
import argon2 from 'argon2';
import { getDefaultServer } from './server.js';

const updateProfileSchema = z.object({
  username: usernameSchema.optional(),
  avatar_url: z.string().url().nullable().optional(),
  display_name: z.string().min(1).max(32).nullable().optional(),
  status: z.enum(['online', 'idle', 'dnd', 'offline']).optional(),
  custom_status: z.string().max(128).nullable().optional(),
  custom_status_expires_at: z.string().datetime().nullable().optional(),
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
  // Get current user with roles and permissions (single-tenant: flat structure)
  fastify.get('/me', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const user = await db.users.findById(request.user!.id);
      if (!user) {
        return notFound(reply, 'User');
      }

      const { password_hash: _, ...safeUser } = user;

      // Get the default server for single-tenant model
      const server = await getDefaultServer();
      
      // If no server exists yet, return user without server info
      if (!server) {
        return {
          ...safeUser,
          roles: [],
          permissions: toNamedPermissions(0, 0, 0),
          is_owner: false,
          nickname: null,
        };
      }

      const isOwner = server.owner_id === request.user!.id;

      // Check if user is a member of this server
      const [membership] = await db.sql`
        SELECT nickname, joined_at FROM members
        WHERE user_id = ${request.user!.id} AND server_id = ${server.id}
      `;

      // If not a member, return basic info
      if (!membership) {
        return {
          ...safeUser,
          roles: [],
          permissions: toNamedPermissions(0, 0, 0),
          is_owner: false,
          nickname: null,
        };
      }

      // Get roles for this member
      const memberRoles = await db.sql`
        SELECT r.id, r.name, r.color, r.position, 
               r.server_permissions, r.text_permissions, r.voice_permissions
        FROM roles r
        JOIN member_roles mr ON mr.role_id = r.id
        WHERE mr.member_user_id = ${request.user!.id}
          AND mr.member_server_id = ${server.id}
        ORDER BY r.position DESC
      `;

      // Include @everyone role
      const [everyoneRole] = await db.sql`
        SELECT id, name, color, position, 
               server_permissions, text_permissions, voice_permissions
        FROM roles
        WHERE server_id = ${server.id} AND name = '@everyone'
      `;

      const allRoles = everyoneRole ? [...memberRoles, everyoneRole] : memberRoles;

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
        ...safeUser,
        nickname: membership.nickname,
        joined_at: membership.joined_at,
        is_owner: isOwner,
        roles: allRoles.map((r: any) => ({
          id: r.id,
          name: r.name,
          color: r.color,
          position: r.position,
        })),
        permissions: toNamedPermissions(serverPerms, textPerms, voicePerms),
      };
    },
  });

  // Update profile (supports status, custom_status, and other profile fields)
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
      if ('display_name' in body) updates.display_name = body.display_name;
      if ('status' in body) updates.status = body.status;
      if ('custom_status' in body) updates.custom_status = body.custom_status;
      if ('custom_status_expires_at' in body) {
        updates.status_expires_at = body.custom_status_expires_at 
          ? new Date(body.custom_status_expires_at) 
          : null;
      }

      if (Object.keys(updates).length === 0) {
        return badRequest(reply, 'No updates provided');
      }

      await db.sql`
        UPDATE users
        SET ${db.sql(updates)}
        WHERE id = ${request.user!.id}
      `;

      const user = await db.users.findById(request.user!.id);
      const { password_hash: _, ...safeUser } = user;

      // If status-related fields changed, emit presence:update to all servers
      if ('status' in body || 'custom_status' in body) {
        const servers = await db.servers.findByUserId(request.user!.id);
        for (const server of servers) {
          fastify.io?.to(`server:${server.id}`).emit('presence:update', {
            user_id: request.user!.id,
            status: user.status,
            custom_status: user.custom_status,
          });
        }
      }

      // Broadcast profile update to user's own room
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
          custom_status = ${body.text ?? null},
          status_expires_at = ${body.expires_at ? new Date(body.expires_at) : null}
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

  // Alias: /me/preferences -> /me/settings (for client compatibility)
  fastify.get('/me/preferences', {
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

      // Get updated settings and emit socket event for real-time sync
      const [updatedSettings] = await db.sql`
        SELECT * FROM user_settings WHERE user_id = ${request.user!.id}
      `;
      fastify.io?.to(`user:${request.user!.id}`).emit('user:settings:update', updatedSettings || {});

      return { message: 'Settings updated' };
    },
  });

  // Alias: PATCH /me/preferences -> /me/settings
  fastify.patch('/me/preferences', {
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

      // Get updated settings and emit socket event for real-time sync
      const [updatedSettings] = await db.sql`
        SELECT * FROM user_settings WHERE user_id = ${request.user!.id}
      `;
      fastify.io?.to(`user:${request.user!.id}`).emit('user:settings:update', updatedSettings || {});

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

  // ============================================================
  // BLOCKED USERS
  // ============================================================

  // Get blocked users list
  fastify.get('/blocked', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const currentUserId = request.user!.id;

      const blockedUsers = await db.sql`
        SELECT 
          u.id,
          u.username,
          u.avatar_url,
          b.created_at as blocked_at
        FROM blocked_users b
        JOIN users u ON b.blocked_id = u.id
        WHERE b.blocker_id = ${currentUserId}
        ORDER BY b.created_at DESC
      `;

      return blockedUsers.map((u: any) => ({
        id: u.id,
        username: u.username,
        display_name: u.username,
        avatar_url: u.avatar_url,
        blocked_at: u.blocked_at,
      }));
    },
  });

  // Block a user
  fastify.post('/:userId/block', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const currentUserId = request.user!.id;

      // Cannot block yourself
      if (userId === currentUserId) {
        return badRequest(reply, 'Cannot block yourself');
      }

      // Check if target user exists
      const targetUser = await db.users.findById(userId);
      if (!targetUser) {
        return notFound(reply, 'User');
      }

      // Check if already blocked
      const [existingBlock] = await db.sql`
        SELECT 1 FROM blocked_users
        WHERE blocker_id = ${currentUserId} AND blocked_id = ${userId}
      `;

      if (existingBlock) {
        return badRequest(reply, 'User already blocked');
      }

      // Insert block record
      await db.sql`
        INSERT INTO blocked_users (blocker_id, blocked_id)
        VALUES (${currentUserId}, ${userId})
      `;

      // Remove existing friendship (if any)
      const [user1, user2] = currentUserId < userId 
        ? [currentUserId, userId] 
        : [userId, currentUserId];

      await db.sql`
        DELETE FROM friendships
        WHERE user1_id = ${user1} AND user2_id = ${user2}
      `;

      // Cancel any pending friend requests (both directions)
      await db.sql`
        DELETE FROM friend_requests
        WHERE (from_user_id = ${currentUserId} AND to_user_id = ${userId})
           OR (from_user_id = ${userId} AND to_user_id = ${currentUserId})
      `;

      // Emit socket event to blocked user
      fastify.io?.to(`user:${userId}`).emit('user:block', {
        user_id: currentUserId,
      });

      // Get block timestamp
      const [blockRecord] = await db.sql`
        SELECT created_at FROM blocked_users
        WHERE blocker_id = ${currentUserId} AND blocked_id = ${userId}
      `;

      return {
        message: 'User blocked',
        blocked_user: {
          id: targetUser.id,
          username: targetUser.username,
          display_name: targetUser.username,
          avatar_url: targetUser.avatar_url,
          blocked_at: blockRecord.created_at,
        },
      };
    },
  });

  // Unblock a user
  fastify.delete('/:userId/block', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const currentUserId = request.user!.id;

      // Check if user is blocked
      const [existingBlock] = await db.sql`
        SELECT 1 FROM blocked_users
        WHERE blocker_id = ${currentUserId} AND blocked_id = ${userId}
      `;

      if (!existingBlock) {
        return notFound(reply, 'User not blocked');
      }

      // Remove block record
      await db.sql`
        DELETE FROM blocked_users
        WHERE blocker_id = ${currentUserId} AND blocked_id = ${userId}
      `;

      return { message: 'User unblocked' };
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

      // Return limited public profile with last_seen_at
      return {
        id: user.id,
        username: user.username,
        display_name: user.display_name || user.username,
        avatar_url: user.avatar_url,
        status: user.status,
        custom_status_emoji: user.custom_status_emoji,
        custom_status: user.custom_status,
        created_at: user.created_at,
        last_seen_at: user.last_seen_at || null,
      };
    },
  });

  // Search users by username
  fastify.get('/search', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 30, timeWindow: '1 minute' },
    },
    handler: async (request, reply) => {
      const { q, limit = '20' } = request.query as { q?: string; limit?: string };

      if (!q || q.trim().length < 2) {
        return badRequest(reply, 'Search query must be at least 2 characters');
      }

      const searchTerm = q.trim();
      const maxLimit = Math.min(parseInt(limit) || 20, 50);
      const currentUserId = request.user!.id;

      // Search users by username (case-insensitive), excluding current user
      const users = await db.sql`
        SELECT 
          u.id,
          u.username,
          u.avatar_url,
          u.status,
          -- Check if friends
          EXISTS (
            SELECT 1 FROM friendships f 
            WHERE (f.user1_id = ${currentUserId} AND f.user2_id = u.id)
               OR (f.user1_id = u.id AND f.user2_id = ${currentUserId})
          ) as is_friend,
          -- Check for outgoing request
          EXISTS (
            SELECT 1 FROM friend_requests fr 
            WHERE fr.from_user_id = ${currentUserId} AND fr.to_user_id = u.id
          ) as has_outgoing_request,
          -- Check for incoming request
          EXISTS (
            SELECT 1 FROM friend_requests fr 
            WHERE fr.from_user_id = u.id AND fr.to_user_id = ${currentUserId}
          ) as has_incoming_request,
          -- Check if blocked by current user
          EXISTS (
            SELECT 1 FROM blocked_users b
            WHERE b.blocker_id = ${currentUserId} AND b.blocked_id = u.id
          ) as is_blocked
        FROM users u
        WHERE u.id != ${currentUserId}
          AND (u.username ILIKE ${'%' + searchTerm + '%'})
        ORDER BY 
          -- Exact match first
          CASE WHEN u.username ILIKE ${searchTerm} THEN 0 ELSE 1 END,
          -- Then starts with
          CASE WHEN u.username ILIKE ${searchTerm + '%'} THEN 0 ELSE 1 END,
          u.username ASC
        LIMIT ${maxLimit}
      `;

      return users.map((u: any) => ({
        id: u.id,
        username: u.username,
        display_name: u.username,
        avatar_url: u.avatar_url,
        is_friend: u.is_friend,
        request_pending: u.has_outgoing_request || u.has_incoming_request,
        request_direction: u.has_outgoing_request ? 'outgoing' : u.has_incoming_request ? 'incoming' : null,
        is_blocked: u.is_blocked,
      }));
    },
  });
};
