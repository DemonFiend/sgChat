import { FastifyPluginAsync } from 'fastify';
import argon2 from 'argon2';
import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { sendPasswordResetEmail } from '../lib/email.js';
import { handleMemberJoin } from '../services/server.js';
import {
  registerSchema,
  loginSchema,
  ServerPermissions,
  ALL_PERMISSIONS,
  permissionToString,
  RoleTemplates,
} from '@sgchat/shared';
import { z } from 'zod';

// Password reset schemas
const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(32).max(128),
  password: z.string().min(1), // Already client-side hashed
});

const claimAdminSchema = z.object({
  code: z.string().min(1).max(64),
});

// Helper to get consistent cookie options for refresh_token
function getRefreshTokenCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
  } as const;
}

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

      // Single-tenant: Auto-join user to the server
      const [server] = await db.sql`
        SELECT id FROM servers ORDER BY created_at ASC LIMIT 1
      `;
      if (server) {
        await handleMemberJoin(user.id, server.id, fastify.io);
      }

      // Generate tokens
      const access_token = fastify.jwt.sign({
        id: user.id,
        username: user.username,
        email: user.email,
      });

      const refresh_token = nanoid(32);
      await redis.setSession(user.id, refresh_token);

      // Set refresh token as httpOnly cookie
      reply.setCookie('refresh_token', refresh_token, {
        ...getRefreshTokenCookieOptions(),
        maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
      });

      return {
        access_token,
        user,
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

      // Find user by email (with password hash for verification)
      const userWithPassword = await db.users.findByEmailWithPassword(body.email);
      if (!userWithPassword) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid email or password',
        });
      }

      // Verify password (client sends sha256-hashed password, argon2 verifies against stored hash)
      const validPassword = await argon2.verify(userWithPassword.password_hash, body.password);
      if (!validPassword) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid email or password',
        });
      }

      // Generate tokens
      const access_token = fastify.jwt.sign({
        id: userWithPassword.id,
        username: userWithPassword.username,
        email: userWithPassword.email,
      });

      const refresh_token = nanoid(32);
      await redis.setSession(userWithPassword.id, refresh_token);

      // Update last seen
      await db.users.updateStatus(userWithPassword.id, 'online');

      // Single-tenant: Ensure user is a member of the server
      const [server] = await db.sql`
        SELECT id FROM servers ORDER BY created_at ASC LIMIT 1
      `;
      if (server) {
        const [existingMember] = await db.sql`
          SELECT 1 FROM members WHERE user_id = ${userWithPassword.id} AND server_id = ${server.id}
        `;
        if (!existingMember) {
          await handleMemberJoin(userWithPassword.id, server.id, fastify.io);
        }
      }

      // Set refresh token as httpOnly cookie
      reply.setCookie('refresh_token', refresh_token, {
        ...getRefreshTokenCookieOptions(),
        maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
      });

      // Get safe user data (no password_hash)
      const safeUser = await db.users.findById(userWithPassword.id);

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
        reply.clearCookie('refresh_token', getRefreshTokenCookieOptions());
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
        reply.clearCookie('refresh_token', getRefreshTokenCookieOptions());
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
      reply.setCookie('refresh_token', new_refresh_token, {
        ...getRefreshTokenCookieOptions(),
        maxAge: 7 * 24 * 60 * 60, // 7 days
      });

      return { access_token };
    } catch (err) {
      reply.clearCookie('refresh_token', getRefreshTokenCookieOptions());
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid or expired refresh token',
      });
    }
  });

  // Logout - validate via refresh token cookie (not JWT)
  // This ensures logout works even if the access token is expired
  fastify.post('/logout', {
    handler: async (request, reply) => {
      const refresh_token = request.cookies.refresh_token;
      
      if (!refresh_token) {
        // Already logged out or no session
        return { message: 'Already logged out' };
      }
      
      // Look up session by token
      const session = await redis.getSessionByToken(refresh_token);
      
      if (session) {
        // Delete refresh token from Redis
        await redis.deleteSession(session.userId);
        // Update user status to offline
        await db.users.updateStatus(session.userId, 'offline');
        await redis.setUserOffline(session.userId);
      }
      
      // Always clear the cookie
      reply.clearCookie('refresh_token', getRefreshTokenCookieOptions());
      
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

      // Use the Admin role template for full Administrator permissions
      const adminTemplate = RoleTemplates.ADMIN;

      // Check if Admin role exists (from server creation or previous claim)
      const [existingAdminRole] = await db.sql`
        SELECT id FROM roles WHERE server_id = ${server.id} AND name = ${adminTemplate.name}
      `;

      let adminRoleId: string;

      if (existingAdminRole) {
        adminRoleId = existingAdminRole.id;
        // Update permissions to ensure they're complete (use ADMINISTRATOR which bypasses all)
        await db.sql`
          UPDATE roles
          SET 
            server_permissions = ${permissionToString(ServerPermissions.ADMINISTRATOR)},
            text_permissions = ${permissionToString(ALL_PERMISSIONS.text)},
            voice_permissions = ${permissionToString(ALL_PERMISSIONS.voice)},
            is_hoisted = true,
            description = ${adminTemplate.description}
          WHERE id = ${adminRoleId}
        `;
      } else {
        // Create Admin role at highest position
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
            voice_permissions,
            is_hoisted,
            is_mentionable,
            description
          ) VALUES (
            ${server.id},
            ${adminTemplate.name},
            ${adminTemplate.color},
            ${maxPos.pos},
            ${permissionToString(ServerPermissions.ADMINISTRATOR)},
            ${permissionToString(ALL_PERMISSIONS.text)},
            ${permissionToString(ALL_PERMISSIONS.voice)},
            true,
            false,
            ${adminTemplate.description}
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

  // ============================================================
  // PASSWORD RESET (A12)
  // ============================================================

  /**
   * POST /auth/forgot-password - Request password reset
   * 
   * Sends a password reset token. For security, always returns success
   * even if the email doesn't exist (prevents user enumeration).
   */
  fastify.post('/forgot-password', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '15 minutes',
        keyGenerator: (req) => req.ip,
      },
    },
    handler: async (request, reply) => {
      const { email } = forgotPasswordSchema.parse(request.body);

      // Always respond with success to prevent user enumeration
      const genericResponse = {
        message: 'If an account exists with that email, a reset link has been sent.',
      };

      try {
        // Find user by email
        const user = await db.users.findByEmail(email);
        if (!user) {
          // Don't reveal that email doesn't exist
          return genericResponse;
        }

        // Generate a secure token
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

        // Set expiration to 15 minutes from now
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

        // Delete any existing tokens for this user
        await db.sql`
          DELETE FROM password_reset_tokens WHERE user_id = ${user.id}
        `;

        // Store the hashed token
        await db.sql`
          INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
          VALUES (${user.id}, ${tokenHash}, ${expiresAt})
        `;

        // Build reset link and send email
        const appUrl = process.env.APP_URL || 'http://localhost:3040';
        const resetLink = `${appUrl}/reset-password?token=${token}`;
        
        try {
          await sendPasswordResetEmail(user.email, resetLink, user.username);
        } catch (emailErr) {
          fastify.log.error(emailErr, 'Failed to send password reset email');
          // Continue anyway - user can try again
        }

        return genericResponse;
      } catch (err) {
        fastify.log.error(err, 'Password reset request failed');
        // Still return generic response to prevent information leakage
        return genericResponse;
      }
    },
  });

  /**
   * POST /auth/reset-password - Complete password reset
   * 
   * Validates the reset token and updates the user's password.
   * Invalidates all existing sessions after reset.
   */
  fastify.post('/reset-password', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '15 minutes',
        keyGenerator: (req) => req.ip,
      },
    },
    handler: async (request, reply) => {
      const { token, password } = resetPasswordSchema.parse(request.body);

      // Hash the provided token to compare with stored hash
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      // Find a valid, unused token
      const [resetToken] = await db.sql`
        SELECT id, user_id, expires_at, used_at
        FROM password_reset_tokens
        WHERE token_hash = ${tokenHash}
        LIMIT 1
      `;

      if (!resetToken) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Invalid or expired reset token',
        });
      }

      // Check if token has already been used
      if (resetToken.used_at) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'This reset token has already been used',
        });
      }

      // Check if token has expired
      if (new Date(resetToken.expires_at) < new Date()) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'This reset token has expired',
        });
      }

      try {
        // Hash the new password (client sends pre-hashed, we hash again)
        const hashedPassword = await argon2.hash(password);

        // Update the user's password
        await db.sql`
          UPDATE users
          SET password_hash = ${hashedPassword}, updated_at = NOW()
          WHERE id = ${resetToken.user_id}
        `;

        // Mark the token as used
        await db.sql`
          UPDATE password_reset_tokens
          SET used_at = NOW()
          WHERE id = ${resetToken.id}
        `;

        // Invalidate all sessions for this user
        await redis.deleteSession(resetToken.user_id);

        // Clean up old tokens for this user
        await db.sql`
          DELETE FROM password_reset_tokens
          WHERE user_id = ${resetToken.user_id}
            AND (used_at IS NOT NULL OR expires_at < NOW())
        `;

        console.log(`✅ Password reset completed for user ${resetToken.user_id}`);

        return {
          message: 'Password reset successfully. Please log in with your new password.',
        };
      } catch (err) {
        fastify.log.error(err, 'Password reset failed');
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Failed to reset password. Please try again.',
        });
      }
    },
  });

  /**
   * GET /auth/verify-reset-token - Check if a reset token is valid
   * 
   * Allows the client to validate a token before showing the reset form.
   */
  fastify.get('/verify-reset-token', {
    handler: async (request, reply) => {
      const { token } = request.query as { token?: string };

      if (!token || token.length < 32) {
        return reply.status(400).send({
          valid: false,
          message: 'Invalid token format',
        });
      }

      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const [resetToken] = await db.sql`
        SELECT expires_at, used_at
        FROM password_reset_tokens
        WHERE token_hash = ${tokenHash}
        LIMIT 1
      `;

      if (!resetToken) {
        return { valid: false, message: 'Token not found' };
      }

      if (resetToken.used_at) {
        return { valid: false, message: 'Token has already been used' };
      }

      if (new Date(resetToken.expires_at) < new Date()) {
        return { valid: false, message: 'Token has expired' };
      }

      return { valid: true };
    },
  });
};
