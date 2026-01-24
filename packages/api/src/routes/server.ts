/**
 * Global Server Endpoint - Single-Tenant Model
 * 
 * In sgChat's single-tenant architecture, each deployment IS a server.
 * This endpoint provides info about the instance itself.
 */
import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { toNamedPermissions, ServerPermissions, hasPermission } from '@sgchat/shared';
import { calculatePermissions } from '../services/permissions.js';
import { forbidden, notFound, badRequest } from '../utils/errors.js';
import { z } from 'zod';

const updateServerSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  icon_url: z.string().url().nullable().optional(),
  banner_url: z.string().url().nullable().optional(),
  announce_joins: z.boolean().optional(),
  announce_leaves: z.boolean().optional(),
  announce_online: z.boolean().optional(),
});

/**
 * Get the default/primary server for single-tenant mode
 * Returns the first server created (by created_at)
 */
async function getDefaultServer() {
  const [server] = await db.sql`
    SELECT * FROM servers 
    ORDER BY created_at ASC 
    LIMIT 1
  `;
  return server;
}

export const globalServerRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /server - Get instance/server info
   * Public info about this sgChat deployment
   */
  fastify.get('/', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      
      if (!server) {
        // No server exists yet - return basic instance info
        return {
          id: null,
          name: process.env.SERVER_NAME || 'sgChat Server',
          description: null,
          icon_url: null,
          banner_url: null,
          owner_id: null,
          created_at: null,
          member_count: 0,
          features: ['voice', 'video', 'file_uploads'],
        };
      }

      // Get member count
      const [{ count }] = await db.sql`
        SELECT COUNT(*) as count FROM members WHERE server_id = ${server.id}
      `;

      return {
        id: server.id,
        name: server.name,
        description: server.description || null,
        icon_url: server.icon_url,
        banner_url: server.banner_url || null,
        owner_id: server.owner_id,
        created_at: server.created_at,
        member_count: parseInt(count, 10),
        features: ['voice', 'video', 'file_uploads'],
        settings: {
          announce_joins: server.announce_joins,
          announce_leaves: server.announce_leaves,
          announce_online: server.announce_online,
          afk_timeout: server.afk_timeout,
          welcome_channel_id: server.welcome_channel_id,
          afk_channel_id: server.afk_channel_id,
        },
      };
    },
  });

  /**
   * PATCH /server - Update instance/server settings
   * Requires manage_server permission
   */
  fastify.patch('/', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) {
        return notFound(reply, 'Server');
      }

      const perms = await calculatePermissions(request.user!.id, server.id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_SERVER)) {
        return forbidden(reply, 'Missing MANAGE_SERVER permission');
      }

      const body = updateServerSchema.parse(request.body);
      
      const updates: Record<string, any> = {};
      if (body.name !== undefined) updates.name = body.name;
      if ('description' in body) updates.description = body.description;
      if ('icon_url' in body) updates.icon_url = body.icon_url;
      if ('banner_url' in body) updates.banner_url = body.banner_url;
      if (body.announce_joins !== undefined) updates.announce_joins = body.announce_joins;
      if (body.announce_leaves !== undefined) updates.announce_leaves = body.announce_leaves;
      if (body.announce_online !== undefined) updates.announce_online = body.announce_online;

      if (Object.keys(updates).length === 0) {
        return badRequest(reply, 'No updates provided');
      }

      await db.sql`
        UPDATE servers
        SET ${db.sql(updates)}
        WHERE id = ${server.id}
      `;

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (${server.id}, ${request.user!.id}, 'server_update', 'server', ${server.id}, ${JSON.stringify(updates)})
      `;

      // Broadcast update
      const updated = await getDefaultServer();
      fastify.io?.to(`server:${server.id}`).emit('server:update', updated);

      return updated;
    },
  });
};

// Export helper for other routes to use
export { getDefaultServer };
