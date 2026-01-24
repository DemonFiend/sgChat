import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { z } from 'zod';
import { notFound, forbidden, badRequest } from '../utils/errors.js';
import { getDefaultServer } from './server.js';
import { ServerPermissions } from '@sgchat/shared';

const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  position: z.number().int().min(0).optional(),
});

const updateCategorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  position: z.number().int().min(0).optional(),
});

const reorderCategoriesSchema = z.object({
  categories: z.array(z.object({
    id: z.string().uuid(),
    position: z.number().int().min(0),
  })),
});

/**
 * Check if user has permission to manage channels (which includes categories)
 */
async function canManageChannels(userId: string, serverId: string): Promise<boolean> {
  // Check if owner
  const [server] = await db.sql`SELECT owner_id FROM servers WHERE id = ${serverId}`;
  if (server?.owner_id === userId) return true;

  // Get user's combined permissions from roles
  const roles = await db.sql`
    SELECT r.server_permissions
    FROM roles r
    JOIN member_roles mr ON mr.role_id = r.id
    WHERE mr.member_user_id = ${userId} AND mr.member_server_id = ${serverId}
  `;

  // Also get @everyone role permissions
  const [everyoneRole] = await db.sql`
    SELECT server_permissions FROM roles
    WHERE server_id = ${serverId} AND name = '@everyone'
  `;

  let combinedPerms = BigInt(everyoneRole?.server_permissions || 0);
  for (const role of roles) {
    combinedPerms |= BigInt(role.server_permissions || 0);
  }

  return (combinedPerms & ServerPermissions.MANAGE_CHANNELS) !== 0n;
}

export const categoryRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /categories - List all categories for the server
   */
  fastify.get('/categories', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) {
        return notFound(reply, 'Server');
      }

      const categories = await db.sql`
        SELECT id, name, position, created_at, updated_at
        FROM categories
        WHERE server_id = ${server.id}
        ORDER BY position ASC, created_at ASC
      `;

      return categories;
    },
  });

  /**
   * POST /categories - Create a new category
   */
  fastify.post('/categories', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) {
        return notFound(reply, 'Server');
      }

      // Check permissions
      if (!await canManageChannels(request.user!.id, server.id)) {
        return forbidden(reply, 'You do not have permission to manage categories');
      }

      const body = createCategorySchema.parse(request.body);

      // Get max position if not specified
      let position: number = body.position ?? 0;
      if (body.position === undefined) {
        const [result] = await db.sql`
          SELECT COALESCE(MAX(position), -1) + 1 as next_position
          FROM categories WHERE server_id = ${server.id}
        `;
        position = result.next_position;
      }

      const [category] = await db.sql`
        INSERT INTO categories (server_id, name, position)
        VALUES (${server.id}, ${body.name}, ${position})
        RETURNING id, name, position, created_at, updated_at
      `;

      // Log audit
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (${server.id}, ${request.user!.id}, 'category.create', 'category', ${category.id}, ${JSON.stringify({ name: body.name })})
      `;

      // Emit socket event
      fastify.io?.to(`server:${server.id}`).emit('category:create', category);

      reply.code(201);
      return category;
    },
  });

  /**
   * PATCH /categories/:id - Update a category
   */
  fastify.patch<{ Params: { id: string } }>('/categories/:id', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) {
        return notFound(reply, 'Server');
      }

      // Check permissions
      if (!await canManageChannels(request.user!.id, server.id)) {
        return forbidden(reply, 'You do not have permission to manage categories');
      }

      const { id } = request.params;
      const body = updateCategorySchema.parse(request.body);

      // Check category exists and belongs to this server
      const [existing] = await db.sql`
        SELECT * FROM categories WHERE id = ${id} AND server_id = ${server.id}
      `;
      if (!existing) {
        return notFound(reply, 'Category');
      }

      const updates: any = { updated_at: new Date() };
      if (body.name !== undefined) updates.name = body.name;
      if (body.position !== undefined) updates.position = body.position;

      const [category] = await db.sql`
        UPDATE categories
        SET ${db.sql(updates)}
        WHERE id = ${id}
        RETURNING id, name, position, created_at, updated_at
      `;

      // Log audit
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (${server.id}, ${request.user!.id}, 'category.update', 'category', ${id}, ${JSON.stringify(body)})
      `;

      // Emit socket event
      fastify.io?.to(`server:${server.id}`).emit('category:update', category);

      return category;
    },
  });

  /**
   * DELETE /categories/:id - Delete a category
   */
  fastify.delete<{ Params: { id: string } }>('/categories/:id', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) {
        return notFound(reply, 'Server');
      }

      // Check permissions
      if (!await canManageChannels(request.user!.id, server.id)) {
        return forbidden(reply, 'You do not have permission to manage categories');
      }

      const { id } = request.params;

      // Check category exists and belongs to this server
      const [existing] = await db.sql`
        SELECT * FROM categories WHERE id = ${id} AND server_id = ${server.id}
      `;
      if (!existing) {
        return notFound(reply, 'Category');
      }

      // Remove category_id from channels in this category (don't delete channels)
      await db.sql`
        UPDATE channels SET category_id = NULL WHERE category_id = ${id}
      `;

      // Delete category
      await db.sql`DELETE FROM categories WHERE id = ${id}`;

      // Log audit
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (${server.id}, ${request.user!.id}, 'category.delete', 'category', ${id}, ${JSON.stringify({ name: existing.name })})
      `;

      // Emit socket event
      fastify.io?.to(`server:${server.id}`).emit('category:delete', { id });

      return { message: 'Category deleted' };
    },
  });

  /**
   * POST /categories/reorder - Reorder multiple categories at once
   */
  fastify.post('/categories/reorder', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) {
        return notFound(reply, 'Server');
      }

      // Check permissions
      if (!await canManageChannels(request.user!.id, server.id)) {
        return forbidden(reply, 'You do not have permission to manage categories');
      }

      const body = reorderCategoriesSchema.parse(request.body);

      // Update each category's position
      for (const cat of body.categories) {
        await db.sql`
          UPDATE categories
          SET position = ${cat.position}, updated_at = NOW()
          WHERE id = ${cat.id} AND server_id = ${server.id}
        `;
      }

      // Get updated categories
      const categories = await db.sql`
        SELECT id, name, position, created_at, updated_at
        FROM categories
        WHERE server_id = ${server.id}
        ORDER BY position ASC
      `;

      // Emit socket event
      fastify.io?.to(`server:${server.id}`).emit('categories:reorder', categories);

      return categories;
    },
  });
};
