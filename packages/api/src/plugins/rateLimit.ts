import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import { redis } from '../lib/redis.js';
import { RATE_LIMITS } from '@sgchat/shared';

const RATE_LIMIT_DISABLED = process.env.DISABLE_RATE_LIMIT === 'true';

/** Shared key generator: user ID if authenticated, otherwise IP */
const rateLimitKeyGenerator = (req: any) => {
  return req.user?.id || req.ip;
};

// Use fastify-plugin to break encapsulation so the onRoute hook
// propagates to all sibling and child contexts (e.g. apiRoutes)
export const rateLimitPlugin = fp(async (fastify) => {
  if (RATE_LIMIT_DISABLED) {
    fastify.log.warn('Rate limiting is DISABLED (DISABLE_RATE_LIMIT=true). Do NOT use in production.');
  }

  await fastify.register(rateLimit, {
    global: true,
    max: RATE_LIMITS.API_READ.max,
    timeWindow: `${RATE_LIMITS.API_READ.window} seconds`,
    redis: redis.client,
    nameSpace: 'rl:',
    keyGenerator: rateLimitKeyGenerator,
    ...(RATE_LIMIT_DISABLED && { allowList: () => true }),
    errorResponseBuilder: (_req, context) => ({
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

  fastify.decorate('rateLimitKeyGenerator', rateLimitKeyGenerator);
});
