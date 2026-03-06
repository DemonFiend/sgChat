import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { sql } from '../lib/db.js';
import { createReleaseSchema } from '@sgchat/shared';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { getDefaultServer } from './server.js';

export const releasesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /releases/latest - Get latest release for a platform (unauthenticated)
  fastify.get('/releases/latest', {
    handler: async (request, reply) => {
      const { platform } = request.query as { platform?: string };
      const plat = platform || 'windows';

      const [release] = await sql`
        SELECT id, version, platform, download_url, changelog, required, published_at
        FROM releases
        WHERE platform IN (${plat}, 'all')
        ORDER BY published_at DESC
        LIMIT 1
      `;

      if (!release) return notFound(reply, 'Release');
      return release;
    },
  });

  // GET /releases - List all releases (admin only)
  fastify.get('/releases', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (server?.owner_id !== request.user!.id) {
        return forbidden(reply, 'Admin only');
      }

      const { limit, before } = request.query as { limit?: string; before?: string };
      const lim = Math.min(parseInt(limit || '50', 10), 100);

      const releases = before
        ? await sql`
            SELECT * FROM releases
            WHERE published_at < (SELECT published_at FROM releases WHERE id = ${before})
            ORDER BY published_at DESC LIMIT ${lim}
          `
        : await sql`
            SELECT * FROM releases ORDER BY published_at DESC LIMIT ${lim}
          `;

      return { releases };
    },
  });

  // POST /releases - Create a release (admin only)
  fastify.post('/releases', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (server?.owner_id !== request.user!.id) {
        return forbidden(reply, 'Admin only');
      }

      const parsed = createReleaseSchema.safeParse(request.body);
      if (!parsed.success) return badRequest(reply, parsed.error.message);

      const { version, platform, download_url, changelog, required } = parsed.data;

      const [release] = await sql`
        INSERT INTO releases (version, platform, download_url, changelog, required)
        VALUES (${version}, ${platform || 'windows'}, ${download_url}, ${changelog || null}, ${required || false})
        RETURNING *
      `;

      return release;
    },
  });

  // DELETE /releases/:id - Delete a release (admin only)
  fastify.delete('/releases/:id', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (server?.owner_id !== request.user!.id) {
        return forbidden(reply, 'Admin only');
      }

      const { id } = request.params as { id: string };
      const result = await sql`DELETE FROM releases WHERE id = ${id}`;
      if (result.count === 0) return notFound(reply, 'Release');

      return { success: true };
    },
  });
};
