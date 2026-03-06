import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { sql } from '../lib/db.js';
import { canAccessChannel } from '../services/permissions.js';
import { badRequest } from '../utils/errors.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const searchRoutes: FastifyPluginAsync = async (fastify) => {
  // Server-wide message search across all accessible channels
  fastify.get('/messages', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 10, timeWindow: '60 seconds' },
    },
    handler: async (request, reply) => {
      const {
        q,
        author_id,
        before,
        after,
        has_attachment,
        limit: limitStr,
        offset: offsetStr,
      } = request.query as {
        q?: string;
        author_id?: string;
        before?: string;
        after?: string;
        has_attachment?: string;
        limit?: string;
        offset?: string;
      };

      if (!q || q.trim().length < 2) {
        return badRequest(reply, 'Search query must be at least 2 characters');
      }

      if (author_id && !UUID_REGEX.test(author_id)) {
        return badRequest(reply, 'Invalid author_id');
      }

      // Get the single-tenant server
      const [server] = await sql`SELECT id FROM servers LIMIT 1`;
      if (!server) {
        return badRequest(reply, 'No server found');
      }

      // Get all text/announcement channels
      const channels = await sql`
        SELECT id, type FROM channels
        WHERE server_id = ${server.id}
          AND type IN ('text', 'announcement')
      `;

      // Filter to channels the user can access
      const accessibleChannelIds: string[] = [];
      for (const ch of channels) {
        if (await canAccessChannel(request.user!.id, ch.id)) {
          accessibleChannelIds.push(ch.id);
        }
      }

      if (accessibleChannelIds.length === 0) {
        return { results: [], total_count: 0, query: q };
      }

      const searchLimit = Math.min(parseInt(limitStr || '25', 10), 50);
      const searchOffset = Math.max(parseInt(offsetStr || '0', 10), 0);
      const query = q.trim();

      const results = await sql`
        SELECT
          m.id, m.content, m.created_at, m.edited_at, m.channel_id,
          m.attachments, m.author_id,
          u.username, u.display_name, u.avatar_url,
          c.name as channel_name,
          ts_headline('english', m.content, plainto_tsquery('english', ${query}),
            'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=30, MinWords=15'
          ) as highlighted_content,
          ts_rank(m.search_vector, plainto_tsquery('english', ${query})) as rank
        FROM messages m
        LEFT JOIN users u ON m.author_id = u.id
        LEFT JOIN channels c ON m.channel_id = c.id
        WHERE m.channel_id = ANY(${accessibleChannelIds})
          AND m.search_vector @@ plainto_tsquery('english', ${query})
          ${author_id ? sql`AND m.author_id = ${author_id}` : sql``}
          ${before ? sql`AND m.created_at < ${before}` : sql``}
          ${after ? sql`AND m.created_at > ${after}` : sql``}
          ${has_attachment === 'true' ? sql`AND jsonb_array_length(m.attachments) > 0` : sql``}
        ORDER BY rank DESC, m.created_at DESC
        LIMIT ${searchLimit} OFFSET ${searchOffset}
      `;

      const [countResult] = await sql`
        SELECT COUNT(*)::int as count
        FROM messages m
        WHERE m.channel_id = ANY(${accessibleChannelIds})
          AND m.search_vector @@ plainto_tsquery('english', ${query})
          ${author_id ? sql`AND m.author_id = ${author_id}` : sql``}
          ${before ? sql`AND m.created_at < ${before}` : sql``}
          ${after ? sql`AND m.created_at > ${after}` : sql``}
          ${has_attachment === 'true' ? sql`AND jsonb_array_length(m.attachments) > 0` : sql``}
      `;

      return {
        results: results.map((r: any) => ({
          id: r.id,
          content: r.content,
          highlighted_content: r.highlighted_content,
          channel_id: r.channel_id,
          channel_name: r.channel_name,
          created_at: r.created_at,
          edited_at: r.edited_at,
          attachments: r.attachments,
          author: {
            id: r.author_id,
            username: r.username,
            display_name: r.display_name || r.username,
            avatar_url: r.avatar_url,
          },
        })),
        total_count: countResult.count,
        query: q,
      };
    },
  });
};
