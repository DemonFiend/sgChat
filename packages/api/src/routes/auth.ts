import { FastifyPluginAsync } from 'fastify';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { registerSchema, loginSchema } from '@sgchat/shared';

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
};
