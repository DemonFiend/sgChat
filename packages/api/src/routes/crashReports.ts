import { FastifyPluginAsync } from 'fastify';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { sql } from '../lib/db.js';
import { crashReportSchema } from '@sgchat/shared';
import { badRequest, forbidden } from '../utils/errors.js';
import { getDefaultServer } from './server.js';

export const crashReportsRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /crash-reports - Submit a crash report (optional auth)
  fastify.post('/crash-reports', {
    onRequest: [optionalAuth],
    handler: async (request, reply) => {
      const parsed = crashReportSchema.safeParse(request.body);
      if (!parsed.success) return badRequest(reply, parsed.error.message);

      const { version, platform, error_type, error_message, stack_trace, metadata } = parsed.data;
      const userId = request.user?.id || null;

      const [report] = await sql`
        INSERT INTO crash_reports (user_id, version, platform, error_type, error_message, stack_trace, metadata)
        VALUES (${userId}, ${version}, ${platform}, ${error_type || null}, ${error_message || null}, ${stack_trace || null}, ${JSON.stringify(metadata || {})})
        RETURNING id
      `;

      return { success: true, id: report.id };
    },
  });

  // GET /crash-reports - List crash reports (admin only)
  fastify.get('/crash-reports', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (server?.owner_id !== request.user!.id) {
        return forbidden(reply, 'Admin only');
      }

      const { limit, before, platform, version } = request.query as {
        limit?: string;
        before?: string;
        platform?: string;
        version?: string;
      };
      const lim = Math.min(parseInt(limit || '50', 10), 100);

      let reports;
      if (platform && version) {
        reports = await sql`
          SELECT * FROM crash_reports
          WHERE platform = ${platform} AND version = ${version}
          ORDER BY created_at DESC LIMIT ${lim}
        `;
      } else if (platform) {
        reports = await sql`
          SELECT * FROM crash_reports
          WHERE platform = ${platform}
          ORDER BY created_at DESC LIMIT ${lim}
        `;
      } else {
        reports = await sql`
          SELECT * FROM crash_reports
          ORDER BY created_at DESC LIMIT ${lim}
        `;
      }

      return { reports };
    },
  });
};
