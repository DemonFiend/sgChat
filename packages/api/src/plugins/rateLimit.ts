import { FastifyPluginAsync } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { redis } from '../lib/redis.js';
import { RATE_LIMITS } from '@sgchat/shared';

export const rateLimitPlugin: FastifyPluginAsync = async (fastify) => {
  // Global rate limit
  await fastify.register(rateLimit, {
    global: true,
    max: RATE_LIMITS.API_READ.max,
    timeWindow: `${RATE_LIMITS.API_READ.window} seconds`,
    redis,
    nameSpace: 'rl:',
    keyGenerator: (req) => {
      // Use user ID if authenticated, otherwise IP
      return (req.user as any)?.id || req.ip;
    },
    errorResponseBuilder: (req, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Retry after ${context.after}`,
      retryAfter: context.after,
    }),
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });
};
