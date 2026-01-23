// dotenv not needed in Docker - environment variables are passed by container
// import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import { Server as SocketIOServer } from 'socket.io';
import { db, initDatabase } from './lib/db.js';
import { redis, initRedis } from './lib/redis.js';
import { rateLimitPlugin } from './plugins/rateLimit.js';
import { errorHandler } from './plugins/errorHandler.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { serverRoutes } from './routes/servers.js';
import { channelRoutes } from './routes/channels.js';
import { messageRoutes } from './routes/messages.js';
import { dmRoutes } from './routes/dms.js';
import { voiceRoutes } from './routes/voice.js';
import { initSocketIO } from './socket/index.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  // Initialize database and redis
  await initDatabase();
  await initRedis();

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

  // Register plugins
  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  });

  await fastify.register(cookie);

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
  await fastify.register(voiceRoutes, { prefix: '/voice' });

  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Start HTTP server
  await fastify.listen({ port: PORT, host: HOST });

  // Initialize Socket.IO
  const io = new SocketIOServer(fastify.server, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      credentials: true,
    },
  });

  // Attach io to fastify instance
  fastify.decorate('io', io);
  
  initSocketIO(io, fastify);

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
