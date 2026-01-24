import { FastifyPluginAsync } from 'fastify';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { registerSchema, loginSchema, ServerPermissions, TextPermissions, VoicePermissions } from '@sgchat/shared';
import { z } from 'zod';

const claimAdminSchema = z.object({
  code: z.string().min(1).max(64),
});

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // Register
  fastify.post('/register', {
    config: {
      rateLimit: {
        max: 3,
        timeWindow: '1 hour',
        keyGenerator: (req) => req.ip,
      },
    },
    handler: async (request, reply) => {
      const body = registerSchema.parse(request.body);

      // Check if username or email already exists
      const existingUser = await db.users.findByUsername(body.username);
      if (existingUser) {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'Username already taken',
        });
      }

      const existingEmail = await db.users.findByEmail(body.email);
      if (existingEmail) {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'Email already registered',
        });
      }

      // Hash password
      const password_hash = await argon2.hash(body.password);

      // Create user
      const user = await db.users.create({
        username: body.username,
        email: body.email,
        password_hash,
      });

      // Create user settings with defaults
      await db.sql`
        INSERT INTO user_settings (user_id) VALUES (${user.id})
      `;

      // Generate tokens
      const access_token = fastify.jwt.sign({
        id: user.id,
        username: user.username,
        email: user.email,
      });

      const refresh_token = nanoid(32);
      await redis.setSession(user.id, refresh_token);

      // Set refresh token as httpOnly cookie
      const isProduction = process.env.NODE_ENV === 'production';
      reply.setCookie('refresh_token', refresh_token, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        path: '/auth',
        maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
      });

      // Remove sensitive data
      const { password_hash: _, ...safeUser } = user;

      return {
        access_token,
        user: safeUser,
      };
    },
  });

  // Login
  fastify.post('/login', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '15 minutes',
        keyGenerator: (req) => req.ip,
      },
    },
    handler: async (request, reply) => {
      const body = loginSchema.parse(request.body);

      // Find user by email
      const user = await db.users.findByEmail(body.email);
      if (!user) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid email or password',
        });
      }

      // Verify password
      const validPassword = await argon2.verify(user.password_hash, body.password);
      if (!validPassword) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid email or password',
        });
      }

      // Generate tokens
      const access_token = fastify.jwt.sign({
        id: user.id,
        username: user.username,
        email: user.email,
      });

      const refresh_token = nanoid(32);
      await redis.setSession(user.id, refresh_token);

      // Update last seen
      await db.users.updateStatus(user.id, 'active');

      // Set refresh token as httpOnly cookie
      const isProduction = process.env.NODE_ENV === 'production';
      reply.setCookie('refresh_token', refresh_token, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        path: '/auth',
        maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
      });

      // Remove sensitive data
      const { password_hash: _, ...safeUser } = user;

      return {
        access_token,
        user: safeUser,
      };
    },
  });

  // Refresh token (reads from httpOnly cookie, rotates token)
  fastify.post('/refresh', async (request, reply) => {
    const refresh_token = request.cookies.refresh_token;

    if (!refresh_token) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'No refresh token provided',
      });
    }

    try {
      // Look up session by token (no Bearer header needed)
      const session = await redis.getSessionByToken(refresh_token);
      if (!session) {
        // Clear invalid cookie
        reply.clearCookie('refresh_token', { path: '/auth' });
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid refresh token',
        });
      }

      // Get fresh user data
      const user = await db.users.findById(session.userId);
      if (!user) {
        await redis.deleteSession(session.userId);
        reply.clearCookie('refresh_token', { path: '/auth' });
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'User not found',
        });
      }

      // Delete old session (invalidates old refresh token)
      await redis.deleteSession(session.userId);

      // Generate new tokens (rotation)
      const access_token = fastify.jwt.sign({
        id: user.id,
        username: user.username,
        email: user.email,
      });

      const new_refresh_token = nanoid(32);
      await redis.setSession(user.id, new_refresh_token);

      // Set new refresh token cookie
      const isProduction = process.env.NODE_ENV === 'production';
      reply.setCookie('refresh_token', new_refresh_token, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        path: '/auth',
        maxAge: 7 * 24 * 60 * 60, // 7 days
      });

      return { access_token };
    } catch (err) {
      reply.clearCookie('refresh_token', { path: '/auth' });
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid or expired refresh token',
      });
    }
  });

  // Logout
  fastify.post('/logout', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const userId = request.user.id;
      
      // Delete refresh token from Redis
      await redis.deleteSession(userId);
      
      // Clear the refresh token cookie
      reply.clearCookie('refresh_token', { path: '/auth' });
      
      // Update user status to offline
      await db.users.updateStatus(userId, 'offline');
      await redis.setUserOffline(userId);

      return { message: 'Logged out successfully' };
    },
  });

  /**
   * POST /auth/claim-admin - Claim server ownership with admin code
   * 
   * On first server startup, an admin claim code is generated.
   * The first user to submit this code becomes the server owner
   * with full Administrator permissions.
   */
  fastify.post('/claim-admin', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { code } = claimAdminSchema.parse(request.body);
      const userId = request.user!.id;

      // Get the server
      const [server] = await db.sql`
        SELECT id, admin_claim_code, admin_claimed, owner_id 
        FROM servers 
        ORDER BY created_at ASC 
        LIMIT 1
      `;

      if (!server) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'No server exists yet',
        });
      }

      // Check if already claimed
      if (server.admin_claimed) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Server ownership has already been claimed',
        });
      }

      // Validate claim code
      if (server.admin_claim_code !== code) {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Invalid admin claim code',
        });
      }

      // Claim the server - set user as owner
      await db.sql`
        UPDATE servers
        SET 
          owner_id = ${userId},
          admin_claimed = true,
          admin_claim_code = NULL
        WHERE id = ${server.id}
      `;

      // Add user as member if not already
      const [existingMember] = await db.sql`
        SELECT 1 FROM members WHERE user_id = ${userId} AND server_id = ${server.id}
      `;

      if (!existingMember) {
        await db.sql`
          INSERT INTO members (user_id, server_id)
          VALUES (${userId}, ${server.id})
        `;
      }

      // Create Administrator role with ALL permissions
      const ALL_SERVER_PERMS = (
        ServerPermissions.ADMINISTRATOR |
        ServerPermissions.MANAGE_SERVER |
        ServerPermissions.MANAGE_CHANNELS |
        ServerPermissions.MANAGE_ROLES |
        ServerPermissions.KICK_MEMBERS |
        ServerPermissions.BAN_MEMBERS |
        ServerPermissions.CREATE_INVITES |
        ServerPermissions.CHANGE_NICKNAME |
        ServerPermissions.MANAGE_NICKNAMES |
        ServerPermissions.VIEW_AUDIT_LOG
      ).toString();

      const ALL_TEXT_PERMS = (
        TextPermissions.VIEW_CHANNEL |
        TextPermissions.SEND_MESSAGES |
        TextPermissions.EMBED_LINKS |
        TextPermissions.ATTACH_FILES |
        TextPermissions.ADD_REACTIONS |
        TextPermissions.MENTION_EVERYONE |
        TextPermissions.MANAGE_MESSAGES |
        TextPermissions.READ_MESSAGE_HISTORY
      ).toString();

      const ALL_VOICE_PERMS = (
        VoicePermissions.CONNECT |
        VoicePermissions.SPEAK |
        VoicePermissions.VIDEO |
        VoicePermissions.STREAM |
        VoicePermissions.MUTE_MEMBERS |
        VoicePermissions.DEAFEN_MEMBERS |
        VoicePermissions.MOVE_MEMBERS |
        VoicePermissions.DISCONNECT_MEMBERS |
        VoicePermissions.PRIORITY_SPEAKER |
        VoicePermissions.USE_VOICE_ACTIVITY
      ).toString();

      // Check if Administrator role exists
      const [existingAdminRole] = await db.sql`
        SELECT id FROM roles WHERE server_id = ${server.id} AND name = 'Administrator'
      `;

      let adminRoleId: string;

      if (existingAdminRole) {
        adminRoleId = existingAdminRole.id;
        // Update permissions to ensure they're complete
        await db.sql`
          UPDATE roles
          SET 
            server_permissions = ${ALL_SERVER_PERMS},
            text_permissions = ${ALL_TEXT_PERMS},
            voice_permissions = ${ALL_VOICE_PERMS}
          WHERE id = ${adminRoleId}
        `;
      } else {
        // Create Administrator role at highest position
        const [maxPos] = await db.sql`
          SELECT COALESCE(MAX(position), 0) + 1 as pos FROM roles WHERE server_id = ${server.id}
        `;

        const [adminRole] = await db.sql`
          INSERT INTO roles (
            server_id,
            name,
            color,
            position,
            server_permissions,
            text_permissions,
            voice_permissions
          ) VALUES (
            ${server.id},
            'Administrator',
            '#FF0000',
            ${maxPos.pos},
            ${ALL_SERVER_PERMS},
            ${ALL_TEXT_PERMS},
            ${ALL_VOICE_PERMS}
          )
          RETURNING id
        `;
        adminRoleId = adminRole.id;
      }

      // Assign Administrator role to user
      const [existingRoleAssignment] = await db.sql`
        SELECT 1 FROM member_roles 
        WHERE member_user_id = ${userId} 
          AND member_server_id = ${server.id} 
          AND role_id = ${adminRoleId}
      `;

      if (!existingRoleAssignment) {
        await db.sql`
          INSERT INTO member_roles (member_user_id, member_server_id, role_id)
          VALUES (${userId}, ${server.id}, ${adminRoleId})
        `;
      }

      // Log to audit
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (
          ${server.id}, 
          ${userId}, 
          'admin_claimed', 
          'server', 
          ${server.id}, 
          ${JSON.stringify({ claimed_by: userId })}
        )
      `;

      console.log(`🎉 Server ownership claimed by user ${userId}`);

      // Get updated server info
      const [updatedServer] = await db.sql`
        SELECT * FROM servers WHERE id = ${server.id}
      `;

      return {
        message: 'Server ownership claimed successfully! You are now the administrator.',
        server: {
          id: updatedServer.id,
          name: updatedServer.name,
          owner_id: updatedServer.owner_id,
        },
      };
    },
  });
};
