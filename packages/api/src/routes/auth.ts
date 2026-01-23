import { FastifyPluginAsync } from 'fastify';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { registerSchema, loginSchema } from '@voxcord/shared';

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

      // Remove sensitive data
      const { password_hash: _, ...safeUser } = user;

      return {
        access_token,
        refresh_token,
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

      // Find user by username
      const user = await db.users.findByUsername(body.username);
      if (!user) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid username or password',
        });
      }

      // Verify password
      const validPassword = await argon2.verify(user.password_hash, body.password);
      if (!validPassword) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid username or password',
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

      // Remove sensitive data
      const { password_hash: _, ...safeUser } = user;

      return {
        access_token,
        refresh_token,
        user: safeUser,
      };
    },
  });

  // Refresh token
  fastify.post('/refresh', async (request, reply) => {
    const { refresh_token } = request.body as { refresh_token: string };

    if (!refresh_token) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Refresh token required',
      });
    }

    try {
      // Decode the current token to get user ID (even if expired)
      const decoded = fastify.jwt.decode(
        request.headers.authorization?.replace('Bearer ', '') || ''
      ) as any;

      if (!decoded?.id) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid token',
        });
      }

      // Verify refresh token
      const storedToken = await redis.getSession(decoded.id);
      if (storedToken !== refresh_token) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid refresh token',
        });
      }

      // Get fresh user data
      const user = await db.users.findById(decoded.id);
      if (!user) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'User not found',
        });
      }

      // Generate new access token
      const access_token = fastify.jwt.sign({
        id: user.id,
        username: user.username,
        email: user.email,
      });

      return { access_token };
    } catch (err) {
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
      
      // Delete refresh token
      await redis.deleteSession(userId);
      
      // Update user status to offline
      await db.users.updateStatus(userId, 'offline');
      await redis.setUserOffline(userId);

      return { message: 'Logged out successfully' };
    },
  });
};
