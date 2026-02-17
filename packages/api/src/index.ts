// dotenv not needed in Docker - environment variables are passed by container
// import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync } from 'fs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { Server as SocketIOServer } from 'socket.io';
import { db, initDatabase } from './lib/db.js';
import { redis, initRedis } from './lib/redis.js';
import { initEventBus, shutdownEventBus } from './lib/eventBus.js';
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
import { serverPopupConfigRoutes } from './routes/serverPopupConfig.js';
import { standaloneRoutes } from './routes/standalone.js';
import { categoryRoutes } from './routes/categories.js';
import { uploadRoutes } from './routes/upload.js';
import { gatewayRoutes } from './routes/gateway.js';
import { notificationRoutes } from './routes/notifications.js';
import { giphyRoutes } from './routes/giphy.js';
import { initSocketIO } from './socket/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Resolve the web client dist directory
function getWebClientPath(): string | null {
  const candidates: string[] = [];

  // Check environment override first
  if (process.env.WEB_CLIENT_PATH) {
    candidates.push(resolve(process.env.WEB_CLIENT_PATH));
  }

  // Relative to compiled dist/index.js -> ../../web/dist
  candidates.push(join(__dirname, '..', '..', 'web', 'dist'));

  // Relative to compiled dist/index.js -> ../../../web/dist (in case of nested dist/src/)
  candidates.push(join(__dirname, '..', '..', '..', 'web', 'dist'));

  // Docker explicit location
  candidates.push('/app/packages/web/dist');
  candidates.push('/app/web-dist');

  // Relative to process.cwd()
  candidates.push(join(process.cwd(), '..', 'web', 'dist'));

  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    const hasIndex = existsSync(join(resolved, 'index.html'));
    if (hasIndex) {
      return resolved;
    }
  }

  // Log all attempted paths for debugging
  console.warn('Web client not found. Searched paths:');
  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    console.warn(`  ${resolved} (exists: ${existsSync(resolved)}, has index.html: ${existsSync(join(resolved, 'index.html'))})`);
  }

  return null;
}

async function start() {
  // Initialize database, redis, event bus, and storage
  await initDatabase();
  await initRedis();
  await initEventBus();
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

  // ============================================================
  // API routes - all prefixed under /api
  // ============================================================
  await fastify.register(async function apiRoutes(api) {
    await api.register(authRoutes, { prefix: '/auth' });
    await api.register(userRoutes, { prefix: '/users' });
    await api.register(serverRoutes, { prefix: '/servers' });
    await api.register(channelRoutes, { prefix: '/channels' });
    await api.register(messageRoutes, { prefix: '/messages' });
    await api.register(dmRoutes, { prefix: '/dms' });
    await api.register(friendRoutes, { prefix: '/friends' });
    await api.register(voiceRoutes, { prefix: '/voice' });

    // Single-tenant routes
    await api.register(globalServerRoutes, { prefix: '/server' });
    await api.register(serverPopupConfigRoutes, { prefix: '/server/popup-config' });
    await api.register(standaloneRoutes);
    await api.register(categoryRoutes);
    await api.register(uploadRoutes);

    // A0: Gateway routes (SSE fallback, resync, sequence)
    await api.register(gatewayRoutes);

    // A4: Notification routes
    await api.register(notificationRoutes, { prefix: '/notifications' });

    // Giphy proxy routes
    await api.register(giphyRoutes, { prefix: '/giphy' });

    // Health check with server info for client network discovery
    api.get('/health', async () => {
      return {
        status: 'ok',
        name: process.env.SERVER_NAME || 'sgChat Server',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
      };
    });
  }, { prefix: '/api' });

  // Also keep /health at root for backward compatibility and Docker health checks
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      name: process.env.SERVER_NAME || 'sgChat Server',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    };
  });

  // ============================================================
  // Legacy routes (no /api prefix) for backward compat with existing clients
  // ============================================================
  await fastify.register(authRoutes, { prefix: '/auth' });
  await fastify.register(userRoutes, { prefix: '/users' });
  await fastify.register(serverRoutes, { prefix: '/servers' });
  await fastify.register(channelRoutes, { prefix: '/channels' });
  await fastify.register(messageRoutes, { prefix: '/messages' });
  await fastify.register(dmRoutes, { prefix: '/dms' });
  await fastify.register(friendRoutes, { prefix: '/friends' });
  await fastify.register(voiceRoutes, { prefix: '/voice' });
  await fastify.register(serverPopupConfigRoutes, { prefix: '/server/popup-config' });
  await fastify.register(globalServerRoutes, { prefix: '/server' });
  await fastify.register(standaloneRoutes);
  await fastify.register(categoryRoutes);
  await fastify.register(uploadRoutes);
  await fastify.register(gatewayRoutes);
  await fastify.register(notificationRoutes, { prefix: '/notifications' });
  await fastify.register(giphyRoutes, { prefix: '/giphy' });

  // ============================================================
  // Web Client - serve built SPA from packages/web/dist
  // ============================================================
  const webClientPath = getWebClientPath();
  if (webClientPath) {
    fastify.log.info(`📁 Serving web client from: ${webClientPath}`);

    // Serve static assets (JS, CSS, images, etc.)
    await fastify.register(fastifyStatic, {
      root: webClientPath,
      prefix: '/',
      wildcard: false, // Don't wildcard match - let SPA fallback handle unknown routes
      decorateReply: true,
    });

    // SPA fallback - serve index.html for any non-API, non-file route
    fastify.setNotFoundHandler(async (request, reply) => {
      // If it's an API request, return 404 JSON
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'Not found', statusCode: 404 });
      }

      // For everything else, serve the SPA's index.html
      return reply.sendFile('index.html');
    });
  } else {
    fastify.log.warn('⚠️  Web client not found. Run "pnpm --filter=@sgchat/web build" to build the web client.');
    fastify.log.warn('⚠️  The API server will run without serving a web interface.');
  }

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

  fastify.log.info(`🚀 sgChat running on http://${HOST}:${PORT}`);
  fastify.log.info(`📡 Socket.IO ready for connections`);
  if (webClientPath) {
    fastify.log.info(`🌐 Web client available at http://${HOST}:${PORT}`);
  }
  fastify.log.info(`📋 API available at http://${HOST}:${PORT}/api`);

  // Graceful shutdown
  const gracefulShutdown = async (signal: string) => {
    fastify.log.info(`${signal} received, shutting down gracefully...`);

    await fastify.close();
    await shutdownEventBus();
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
