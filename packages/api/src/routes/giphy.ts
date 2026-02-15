/**
 * Giphy API Proxy Routes
 *
 * Provides a server-side proxy for Giphy API requests with rate limiting.
 * This keeps the API key secure on the server and allows for rate control.
 *
 * Endpoints:
 *   GET /giphy/trending  — Get trending GIFs
 *   GET /giphy/search    — Search GIFs by query
 */

import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { redis } from '../lib/redis.js';
import { z } from 'zod';

const GIPHY_API_KEY = process.env.GIPHY_API_KEY;
const GIPHY_BASE_URL = 'https://api.giphy.com/v1/gifs';

// Rate limit: 100 requests per hour per user
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW = 3600; // 1 hour in seconds

// Validation schemas
const searchQuerySchema = z.object({
  q: z.string().min(1).max(100),
  limit: z.coerce.number().min(1).max(50).optional().default(25),
  offset: z.coerce.number().min(0).optional().default(0),
});

const trendingQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(50).optional().default(25),
  offset: z.coerce.number().min(0).optional().default(0),
});

/**
 * Check and increment rate limit for a user.
 * Returns { allowed: boolean, remaining: number, resetIn: number }
 */
async function checkRateLimit(userId: string): Promise<{
  allowed: boolean;
  remaining: number;
  resetIn: number;
}> {
  const key = `giphy:ratelimit:${userId}`;
  const now = Math.floor(Date.now() / 1000);
  
  // Get current count
  const current = await redis.client.get(key);
  const count = current ? parseInt(current, 10) : 0;
  
  // Get TTL for reset time
  const ttl = await redis.client.ttl(key);
  const resetIn = ttl > 0 ? ttl : RATE_LIMIT_WINDOW;
  
  if (count >= RATE_LIMIT_MAX) {
    return {
      allowed: false,
      remaining: 0,
      resetIn,
    };
  }
  
  // Increment counter
  if (count === 0) {
    // First request in window - set with expiry
    await redis.client.setex(key, RATE_LIMIT_WINDOW, '1');
  } else {
    await redis.client.incr(key);
  }
  
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX - count - 1,
    resetIn,
  };
}

/**
 * Simplified GIF response structure
 */
interface GifItem {
  id: string;
  title: string;
  url: string;
  preview: string;
  width: number;
  height: number;
}

/**
 * Transform Giphy API response to simplified format
 */
function transformGiphyResponse(data: unknown[]): GifItem[] {
  return data.map((gif: unknown) => {
    const g = gif as {
      id: string;
      title: string;
      images: {
        fixed_height: { url: string; width: string; height: string };
        fixed_height_still: { url: string };
      };
    };
    return {
      id: g.id,
      title: g.title,
      url: g.images.fixed_height.url,
      preview: g.images.fixed_height_still.url,
      width: parseInt(g.images.fixed_height.width, 10),
      height: parseInt(g.images.fixed_height.height, 10),
    };
  });
}

export const giphyRoutes: FastifyPluginAsync = async (fastify) => {
  // Check if Giphy API key is configured
  if (!GIPHY_API_KEY) {
    fastify.log.warn('⚠️  GIPHY_API_KEY not configured. Giphy routes will return 503.');
  }

  /**
   * GET /giphy/trending
   * Returns trending GIFs from Giphy
   */
  fastify.get('/trending', {
    preHandler: [authenticate],
    handler: async (request, reply) => {
      // Check if API key is configured
      if (!GIPHY_API_KEY) {
        return reply.code(503).send({
          error: 'Giphy integration not configured',
          message: 'The server administrator has not configured a Giphy API key.',
        });
      }

      // Parse query params
      const parseResult = trendingQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: 'Invalid query parameters',
          details: parseResult.error.issues,
        });
      }
      const { limit, offset } = parseResult.data;

      // Check rate limit
      const rateLimit = await checkRateLimit(request.user!.id);
      reply.header('X-RateLimit-Limit', RATE_LIMIT_MAX);
      reply.header('X-RateLimit-Remaining', rateLimit.remaining);
      reply.header('X-RateLimit-Reset', rateLimit.resetIn);

      if (!rateLimit.allowed) {
        return reply.code(429).send({
          error: 'Rate limit exceeded',
          message: `You have exceeded ${RATE_LIMIT_MAX} Giphy requests per hour. Try again in ${rateLimit.resetIn} seconds.`,
          resetIn: rateLimit.resetIn,
        });
      }

      // Fetch from Giphy
      try {
        const url = new URL(`${GIPHY_BASE_URL}/trending`);
        url.searchParams.set('api_key', GIPHY_API_KEY);
        url.searchParams.set('limit', limit.toString());
        url.searchParams.set('offset', offset.toString());
        url.searchParams.set('rating', 'pg-13');

        const response = await fetch(url.toString());
        if (!response.ok) {
          throw new Error(`Giphy API error: ${response.status}`);
        }

        const json = await response.json() as { data: unknown[]; pagination: unknown };
        const gifs = transformGiphyResponse(json.data);

        return {
          gifs,
          pagination: json.pagination,
        };
      } catch (err) {
        fastify.log.error({ err }, 'Giphy API error');
        return reply.code(502).send({
          error: 'Failed to fetch GIFs',
          message: 'Unable to connect to Giphy API.',
        });
      }
    },
  });

  /**
   * GET /giphy/search
   * Search GIFs by query
   */
  fastify.get('/search', {
    preHandler: [authenticate],
    handler: async (request, reply) => {
      // Check if API key is configured
      if (!GIPHY_API_KEY) {
        return reply.code(503).send({
          error: 'Giphy integration not configured',
          message: 'The server administrator has not configured a Giphy API key.',
        });
      }

      // Parse query params
      const parseResult = searchQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: 'Invalid query parameters',
          details: parseResult.error.issues,
        });
      }
      const { q, limit, offset } = parseResult.data;

      // Check rate limit
      const rateLimit = await checkRateLimit(request.user!.id);
      reply.header('X-RateLimit-Limit', RATE_LIMIT_MAX);
      reply.header('X-RateLimit-Remaining', rateLimit.remaining);
      reply.header('X-RateLimit-Reset', rateLimit.resetIn);

      if (!rateLimit.allowed) {
        return reply.code(429).send({
          error: 'Rate limit exceeded',
          message: `You have exceeded ${RATE_LIMIT_MAX} Giphy requests per hour. Try again in ${rateLimit.resetIn} seconds.`,
          resetIn: rateLimit.resetIn,
        });
      }

      // Fetch from Giphy
      try {
        const url = new URL(`${GIPHY_BASE_URL}/search`);
        url.searchParams.set('api_key', GIPHY_API_KEY);
        url.searchParams.set('q', q);
        url.searchParams.set('limit', limit.toString());
        url.searchParams.set('offset', offset.toString());
        url.searchParams.set('rating', 'pg-13');

        const response = await fetch(url.toString());
        if (!response.ok) {
          throw new Error(`Giphy API error: ${response.status}`);
        }

        const json = await response.json() as { data: unknown[]; pagination: unknown };
        const gifs = transformGiphyResponse(json.data);

        return {
          gifs,
          pagination: json.pagination,
        };
      } catch (err) {
        fastify.log.error({ err }, 'Giphy API error');
        return reply.code(502).send({
          error: 'Failed to fetch GIFs',
          message: 'Unable to connect to Giphy API.',
        });
      }
    },
  });
};
