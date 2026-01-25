// dotenv not needed in Docker - environment variables are passed by container
// import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { Server as SocketIOServer } from 'socket.io';
import { db, initDatabase } from './lib/db.js';
import { redis, initRedis } from './lib/redis.js';
import { initStorage } from './lib/storage.js';
import { bootstrapServer } from './lib/bootstrap.js';
import { rateLimitPlugin } from './plugins/rateLimit.js';
import { errorHandler } from './plugins/errorHandler.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { serverRoutes } from './routes/servers.js';
import { channelRoutes } from './routes/channels.js';
import { messageRoutes } from './routes/messages.js';
import { dmRoutes } from './routes/dms.js';
import { friendRoutes } from './routes/friends.js';
import { voiceRoutes } from './routes/voice.js';
import { globalServerRoutes } from './routes/server.js';
import { standaloneRoutes } from './routes/standalone.js';
import { categoryRoutes } from './routes/categories.js';
import { uploadRoutes } from './routes/upload.js';
import { initSocketIO } from './socket/index.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  // Initialize database, redis, and storage
  await initDatabase();
  await initRedis();
  await initStorage();

  // Bootstrap server (creates default server/channels on first run)
  await bootstrapServer();

  // Create Fastify instance
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    },
  });

  // Parse CORS origins - supports comma-separated list or single origin
  const corsOrigins = process.env.CORS_ORIGIN 
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
    : true; // true = reflect request origin (allow all)

  // Register plugins
  await fastify.register(cors, {
    origin: corsOrigins,
    credentials: true,
  });

  await fastify.register(cookie);

  await fastify.register(multipart, {
    limits: {
      fileSize: 8 * 1024 * 1024, // 8MB max file size
      files: 1, // Max 1 file per request for avatars
    },
  });

  await fastify.register(jwt, {
    secret: process.env.JWT_SECRET || 'change-me-in-production',
    sign: {
      expiresIn: '15m', // Access token expires in 15 minutes
    },
  });

  await fastify.register(rateLimitPlugin);
  await fastify.register(errorHandler);

  // Register routes
  await fastify.register(authRoutes, { prefix: '/auth' });
  await fastify.register(userRoutes, { prefix: '/users' });
  await fastify.register(serverRoutes, { prefix: '/servers' });
  await fastify.register(channelRoutes, { prefix: '/channels' });
  await fastify.register(messageRoutes, { prefix: '/messages' });
  await fastify.register(dmRoutes, { prefix: '/dms' });
  await fastify.register(friendRoutes, { prefix: '/friends' });
  await fastify.register(voiceRoutes, { prefix: '/voice' });
  
  // Single-tenant routes (no prefix - global endpoints)
  await fastify.register(globalServerRoutes); // GET/PATCH /server
  await fastify.register(standaloneRoutes);   // /roles, /members, /invites, /bans, /audit-log
  await fastify.register(categoryRoutes);     // /categories
  await fastify.register(uploadRoutes);       // /upload, /upload/image

  // Health check with server info for client network discovery
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      name: process.env.SERVER_NAME || 'sgChat Server',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    };
  });

  // Initialize Socket.IO BEFORE starting the server
  // We need to use fastify.server which is available after ready()
  await fastify.ready();
  
  const io = new SocketIOServer(fastify.server, {
    cors: {
      origin: corsOrigins,
      credentials: true,
    },
  });

  initSocketIO(io, fastify);

  // Start HTTP server
  await fastify.listen({ port: PORT, host: HOST });

  fastify.log.info(`🚀 sgChat API running on http://${HOST}:${PORT}`);
  fastify.log.info(`📡 Socket.IO ready for connections`);

  // Graceful shutdown
  const gracefulShutdown = async (signal: string) => {
    fastify.log.info(`${signal} received, shutting down gracefully...`);
    
    await fastify.close();
    await redis.client.quit();
    await db.end();
    
    process.exit(0);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
