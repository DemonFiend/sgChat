/**
 * Standalone Routes - Single-Tenant Aliases
 * 
 * These routes provide standalone endpoints that internally use the default server.
 * They exist for API consistency with the single-tenant model where there's only one server.
 */
import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { getDefaultServer } from './server.js';
import { calculatePermissions } from '../services/permissions.js';
import { handleMemberLeave, generateInviteCode } from '../services/server.js';
import { 
  ServerPermissions, 
  hasPermission, 
  toNamedPermissions,
  createRoleSchema,
  createInviteSchema 
} from '@sgchat/shared';
import { notFound, forbidden, badRequest, conflict, sendError } from '../utils/errors.js';
import { z } from 'zod';

const updateRoleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  position: z.number().min(0).optional(),
  permissions: z.object({
    server: z.number().optional(),
    text: z.number().optional(),
    voice: z.number().optional(),
  }).optional(),
});

const updateMemberSchema = z.object({
  roles: z.array(z.string().uuid()).optional(),
  nickname: z.string().max(32).nullable().optional(),
});

const kickBanSchema = z.object({
  reason: z.string().max(512).optional(),
});

export const standaloneRoutes: FastifyPluginAsync = async (fastify) => {
  // ============================================================
  // ROLES - Standalone endpoints
  // ============================================================

  // List all roles
  fastify.get('/roles', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) return [];

      const roles = await db.sql`
        SELECT * FROM roles 
        WHERE server_id = ${server.id}
        ORDER BY position DESC
      `;

      // Convert permissions to named format for each role
      return roles.map((role: any) => ({
        ...role,
        permissions: toNamedPermissions(
          role.server_permissions || '0',
          role.text_permissions || '0',
          role.voice_permissions || '0'
        ),
      }));
    },
  });

  // Create role
  fastify.post('/roles', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) return notFound(reply, 'Server');

      const perms = await calculatePermissions(request.user!.id, server.id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_ROLES)) {
        return forbidden(reply, 'Missing MANAGE_ROLES permission');
      }

      const body = createRoleSchema.parse(request.body);

      const [role] = await db.sql`
        INSERT INTO roles (server_id, name, color, server_permissions, text_permissions, voice_permissions)
        VALUES (
          ${server.id}, 
          ${body.name}, 
          ${body.color || null},
          ${String(body.server_permissions || 0)},
          ${String(body.text_permissions || 0)},
          ${String(body.voice_permissions || 0)}
        )
        RETURNING *
      `;

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (${server.id}, ${request.user!.id}, 'role_create', 'role', ${role.id}, ${JSON.stringify({ created: role })})
      `;

      fastify.io?.to(`server:${server.id}`).emit('role:create', role);
      return role;
    },
  });

  // Update role
  fastify.patch('/roles/:roleId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) return notFound(reply, 'Server');
      const { roleId } = request.params as { roleId: string };

      const perms = await calculatePermissions(request.user!.id, server.id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_ROLES)) {
        return forbidden(reply, 'Missing MANAGE_ROLES permission');
      }

      const [role] = await db.sql`SELECT * FROM roles WHERE id = ${roleId} AND server_id = ${server.id}`;
      if (!role) return notFound(reply, 'Role');

      if (role.name === '@everyone') {
        const body = request.body as any;
        if (body.name && body.name !== '@everyone') {
          return badRequest(reply, 'Cannot rename @everyone role');
        }
      }

      const body = updateRoleSchema.parse(request.body);
      const updates: Record<string, any> = {};
      
      if (body.name !== undefined) updates.name = body.name;
      if ('color' in body) updates.color = body.color;
      if (body.position !== undefined) updates.position = body.position;
      if (body.permissions?.server !== undefined) updates.server_permissions = String(body.permissions.server);
      if (body.permissions?.text !== undefined) updates.text_permissions = String(body.permissions.text);
      if (body.permissions?.voice !== undefined) updates.voice_permissions = String(body.permissions.voice);

      if (Object.keys(updates).length === 0) {
        return badRequest(reply, 'No updates provided');
      }

      await db.sql`UPDATE roles SET ${db.sql(updates)} WHERE id = ${roleId}`;

      const [updated] = await db.sql`SELECT * FROM roles WHERE id = ${roleId}`;
      fastify.io?.to(`server:${server.id}`).emit('role:update', updated);
      return updated;
    },
  });

  // Delete role
  fastify.delete('/roles/:roleId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) return notFound(reply, 'Server');
      const { roleId } = request.params as { roleId: string };

      const perms = await calculatePermissions(request.user!.id, server.id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_ROLES)) {
        return forbidden(reply, 'Missing MANAGE_ROLES permission');
      }

      const [role] = await db.sql`SELECT * FROM roles WHERE id = ${roleId} AND server_id = ${server.id}`;
      if (!role) return notFound(reply, 'Role');
      if (role.name === '@everyone') return badRequest(reply, 'Cannot delete @everyone role');

      await db.sql`DELETE FROM roles WHERE id = ${roleId}`;

      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id)
        VALUES (${server.id}, ${request.user!.id}, 'role_delete', 'role', ${roleId})
      `;

      fastify.io?.to(`server:${server.id}`).emit('role:delete', { id: roleId });
      return { message: 'Role deleted' };
    },
  });

  // Reorder roles
  fastify.patch('/roles/reorder', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) return notFound(reply, 'Server');

      const perms = await calculatePermissions(request.user!.id, server.id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_ROLES)) {
        return forbidden(reply, 'Missing MANAGE_ROLES permission');
      }

      const { role_ids } = request.body as { role_ids: string[] };
      if (!role_ids || !Array.isArray(role_ids)) {
        return badRequest(reply, 'role_ids array required');
      }

      // Update positions based on array order (highest position = first in array)
      for (let i = 0; i < role_ids.length; i++) {
        await db.sql`
          UPDATE roles SET position = ${role_ids.length - i}
          WHERE id = ${role_ids[i]} AND server_id = ${server.id}
        `;
      }

      const roles = await db.sql`SELECT * FROM roles WHERE server_id = ${server.id} ORDER BY position DESC`;
      fastify.io?.to(`server:${server.id}`).emit('roles:reorder', roles);
      return roles;
    },
  });

  // ============================================================
  // MEMBERS - Standalone endpoints
  // ============================================================

  // List members with pagination and search
  fastify.get('/members', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) return { members: [], total: 0 };

      const { limit = '100', offset = '0', search } = request.query as { 
        limit?: string; 
        offset?: string; 
        search?: string;
      };

      const limitNum = Math.min(parseInt(limit, 10) || 100, 100);
      const offsetNum = parseInt(offset, 10) || 0;

      let members;
      let total;

      if (search) {
        members = await db.sql`
          SELECT m.*, u.id as user_id, u.username, u.avatar_url, u.status,
                 u.custom_status, u.custom_status_emoji
          FROM members m
          JOIN users u ON u.id = m.user_id
          WHERE m.server_id = ${server.id}
            AND (u.username ILIKE ${'%' + search + '%'} OR m.nickname ILIKE ${'%' + search + '%'})
          ORDER BY m.joined_at DESC
          LIMIT ${limitNum} OFFSET ${offsetNum}
        `;
        const [{ count }] = await db.sql`
          SELECT COUNT(*) as count FROM members m
          JOIN users u ON u.id = m.user_id
          WHERE m.server_id = ${server.id}
            AND (u.username ILIKE ${'%' + search + '%'} OR m.nickname ILIKE ${'%' + search + '%'})
        `;
        total = parseInt(count, 10);
      } else {
        members = await db.sql`
          SELECT m.*, u.id as user_id, u.username, u.avatar_url, u.status,
                 u.custom_status, u.custom_status_emoji
          FROM members m
          JOIN users u ON u.id = m.user_id
          WHERE m.server_id = ${server.id}
          ORDER BY m.joined_at DESC
          LIMIT ${limitNum} OFFSET ${offsetNum}
        `;
        const [{ count }] = await db.sql`
          SELECT COUNT(*) as count FROM members WHERE server_id = ${server.id}
        `;
        total = parseInt(count, 10);
      }

      // Get roles for each member
      const membersWithRoles = await Promise.all(members.map(async (m: any) => {
        const roles = await db.sql`
          SELECT r.id FROM roles r
          JOIN member_roles mr ON mr.role_id = r.id
          WHERE mr.member_user_id = ${m.user_id} AND mr.member_server_id = ${server.id}
        `;
        return {
          user: {
            id: m.user_id,
            username: m.username,
            avatar_url: m.avatar_url,
            status: m.status,
            custom_status: m.custom_status ? {
              text: m.custom_status,
              emoji: m.custom_status_emoji,
            } : null,
          },
          roles: roles.map((r: any) => r.id),
          joined_at: m.joined_at,
          nickname: m.nickname,
        };
      }));

      return { members: membersWithRoles, total };
    },
  });

  // Update member (roles, nickname)
  fastify.patch('/members/:userId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) return notFound(reply, 'Server');
      const { userId } = request.params as { userId: string };

      const perms = await calculatePermissions(request.user!.id, server.id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_NICKNAMES) &&
          !hasPermission(perms.server, ServerPermissions.MANAGE_ROLES)) {
        return forbidden(reply, 'Missing permission to manage members');
      }

      const member = await db.members.findByUserAndServer(userId, server.id);
      if (!member) return notFound(reply, 'Member');

      const body = updateMemberSchema.parse(request.body);

      // Update nickname if provided
      if ('nickname' in body) {
        const newNickname = body.nickname ?? null; // Convert undefined to null
        await db.sql`
          UPDATE members SET nickname = ${newNickname}
          WHERE user_id = ${userId} AND server_id = ${server.id}
        `;
      }

      // Update roles
      if (body.roles && hasPermission(perms.server, ServerPermissions.MANAGE_ROLES)) {
        // Remove all current roles (except @everyone which isn't in member_roles)
        await db.sql`
          DELETE FROM member_roles 
          WHERE member_user_id = ${userId} AND member_server_id = ${server.id}
        `;
        
        // Add new roles
        for (const roleId of body.roles) {
          await db.sql`
            INSERT INTO member_roles (member_user_id, member_server_id, role_id)
            VALUES (${userId}, ${server.id}, ${roleId})
            ON CONFLICT DO NOTHING
          `;
        }
      }

      // Return updated member
      const updated = await db.members.findByUserAndServer(userId, server.id);
      const roles = await db.sql`
        SELECT role_id FROM member_roles 
        WHERE member_user_id = ${userId} AND member_server_id = ${server.id}
      `;

      return { 
        ...updated, 
        roles: roles.map((r: any) => r.role_id) 
      };
    },
  });

  // Kick member
  fastify.post('/members/:userId/kick', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) return notFound(reply, 'Server');
      const { userId } = request.params as { userId: string };
      const body = kickBanSchema.parse(request.body || {});

      if (userId === server.owner_id) return badRequest(reply, 'Cannot kick server owner');
      if (userId === request.user!.id) return badRequest(reply, 'Cannot kick yourself');

      const perms = await calculatePermissions(request.user!.id, server.id);
      if (!hasPermission(perms.server, ServerPermissions.KICK_MEMBERS)) {
        return forbidden(reply, 'Missing KICK_MEMBERS permission');
      }

      const member = await db.members.findByUserAndServer(userId, server.id);
      if (!member) return notFound(reply, 'Member');

      await handleMemberLeave(userId, server.id);

      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, reason)
        VALUES (${server.id}, ${request.user!.id}, 'member_kick', 'member', ${userId}, ${body.reason || null})
      `;

      fastify.io?.to(`user:${userId}`).emit('server:kicked', { 
        server_id: server.id, 
        server_name: server.name,
        reason: body.reason 
      });

      return { message: 'Member kicked' };
    },
  });

  // Ban member
  fastify.post('/members/:userId/ban', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) return notFound(reply, 'Server');
      const { userId } = request.params as { userId: string };
      const body = kickBanSchema.parse(request.body || {});

      if (userId === server.owner_id) return badRequest(reply, 'Cannot ban server owner');
      if (userId === request.user!.id) return badRequest(reply, 'Cannot ban yourself');

      const perms = await calculatePermissions(request.user!.id, server.id);
      if (!hasPermission(perms.server, ServerPermissions.BAN_MEMBERS)) {
        return forbidden(reply, 'Missing BAN_MEMBERS permission');
      }

      const [existingBan] = await db.sql`
        SELECT * FROM bans WHERE server_id = ${server.id} AND user_id = ${userId}
      `;
      if (existingBan) return conflict(reply, 'User is already banned');

      // Remove from server if member
      const member = await db.members.findByUserAndServer(userId, server.id);
      if (member) await handleMemberLeave(userId, server.id);

      await db.sql`
        INSERT INTO bans (server_id, user_id, moderator_id, reason)
        VALUES (${server.id}, ${userId}, ${request.user!.id}, ${body.reason || null})
      `;

      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, reason)
        VALUES (${server.id}, ${request.user!.id}, 'member_ban', 'member', ${userId}, ${body.reason || null})
      `;

      fastify.io?.to(`user:${userId}`).emit('server:banned', { 
        server_id: server.id, 
        server_name: server.name,
        reason: body.reason 
      });

      return { message: 'Member banned' };
    },
  });

  // ============================================================
  // INVITES - Standalone endpoints
  // ============================================================

  // List invites
  fastify.get('/invites', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) return [];

      const perms = await calculatePermissions(request.user!.id, server.id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_SERVER)) {
        return forbidden(reply, 'Missing MANAGE_SERVER permission');
      }

      const invites = await db.sql`
        SELECT i.*, u.username as created_by_username, u.avatar_url as created_by_avatar
        FROM invites i
        LEFT JOIN users u ON u.id = i.creator_id
        WHERE i.server_id = ${server.id}
        ORDER BY i.created_at DESC
      `;

      return invites.map((inv: any) => ({
        code: inv.code,
        created_by: inv.creator_id ? {
          id: inv.creator_id,
          username: inv.created_by_username,
          avatar_url: inv.created_by_avatar,
        } : null,
        created_at: inv.created_at,
        expires_at: inv.expires_at,
        max_uses: inv.max_uses,
        uses: inv.uses,
      }));
    },
  });

  // Create invite
  fastify.post('/invites', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) return notFound(reply, 'Server');

      const perms = await calculatePermissions(request.user!.id, server.id);
      if (!hasPermission(perms.server, ServerPermissions.CREATE_INVITES)) {
        return forbidden(reply, 'Missing CREATE_INVITES permission');
      }

      const body = createInviteSchema.parse(request.body || {});
      const code = await generateInviteCode();

      const expiresAt = body.expires_at ? new Date(body.expires_at) : null;

      const [invite] = await db.sql`
        INSERT INTO invites (code, server_id, creator_id, max_uses, expires_at)
        VALUES (${code}, ${server.id}, ${request.user!.id}, ${body.max_uses || null}, ${expiresAt})
        RETURNING *
      `;

      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id)
        VALUES (${server.id}, ${request.user!.id}, 'invite_create', 'invite', ${code})
      `;

      return {
        ...invite,
        url: `${process.env.CORS_ORIGIN || 'http://localhost:5173'}/invite/${code}`,
      };
    },
  });

  // Delete invite
  fastify.delete('/invites/:code', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) return notFound(reply, 'Server');
      const { code } = request.params as { code: string };

      const perms = await calculatePermissions(request.user!.id, server.id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_SERVER)) {
        return forbidden(reply, 'Missing MANAGE_SERVER permission');
      }

      const invite = await db.invites.findByCode(code);
      if (!invite || invite.server_id !== server.id) {
        return notFound(reply, 'Invite');
      }

      await db.sql`DELETE FROM invites WHERE code = ${code}`;

      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id)
        VALUES (${server.id}, ${request.user!.id}, 'invite_delete', 'invite', ${code})
      `;

      return { message: 'Invite deleted' };
    },
  });

  // Join via invite (alias for /servers/join/:code)
  fastify.post('/invites/:code/join', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { code } = request.params as { code: string };

      const invite = await db.invites.findByCode(code);
      if (!invite) return notFound(reply, 'Invite');

      if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
        return sendError(reply, 410, 'Invite has expired', 'Gone');
      }

      if (invite.max_uses && invite.uses >= invite.max_uses) {
        return sendError(reply, 410, 'Invite has reached maximum uses', 'Gone');
      }

      const existing = await db.members.findByUserAndServer(request.user!.id, invite.server_id);
      if (existing) {
        return conflict(reply, 'Already a member of this server');
      }

      // Import and use handleMemberJoin
      const { handleMemberJoin } = await import('../services/server.js');
      await handleMemberJoin(request.user!.id, invite.server_id);
      await db.invites.incrementUses(code);

      const server = await db.servers.findById(invite.server_id);
      return { message: 'Joined server successfully', server };
    },
  });

  // ============================================================
  // BANS - Standalone endpoints
  // ============================================================

  // List bans
  fastify.get('/bans', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) return [];

      const perms = await calculatePermissions(request.user!.id, server.id);
      if (!hasPermission(perms.server, ServerPermissions.BAN_MEMBERS)) {
        return forbidden(reply, 'Missing BAN_MEMBERS permission');
      }

      const bans = await db.sql`
        SELECT b.*, 
               u.username, u.avatar_url,
               m.username as banned_by_username
        FROM bans b
        JOIN users u ON u.id = b.user_id
        LEFT JOIN users m ON m.id = b.moderator_id
        WHERE b.server_id = ${server.id}
        ORDER BY b.created_at DESC
      `;

      return bans.map((ban: any) => ({
        user: { id: ban.user_id, username: ban.username, avatar_url: ban.avatar_url },
        reason: ban.reason,
        banned_by: ban.moderator_id ? { id: ban.moderator_id, username: ban.banned_by_username } : null,
        banned_at: ban.created_at,
      }));
    },
  });

  // Unban user
  fastify.delete('/bans/:userId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) return notFound(reply, 'Server');
      const { userId } = request.params as { userId: string };

      const perms = await calculatePermissions(request.user!.id, server.id);
      if (!hasPermission(perms.server, ServerPermissions.BAN_MEMBERS)) {
        return forbidden(reply, 'Missing BAN_MEMBERS permission');
      }

      const [ban] = await db.sql`
        SELECT * FROM bans WHERE server_id = ${server.id} AND user_id = ${userId}
      `;
      if (!ban) return notFound(reply, 'Ban');

      await db.sql`DELETE FROM bans WHERE server_id = ${server.id} AND user_id = ${userId}`;

      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id)
        VALUES (${server.id}, ${request.user!.id}, 'member_unban', 'member', ${userId})
      `;

      return { message: 'User unbanned' };
    },
  });

  // ============================================================
  // AUDIT LOG - Standalone endpoint
  // ============================================================

  fastify.get('/audit-log', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) return { entries: [] };

      const perms = await calculatePermissions(request.user!.id, server.id);
      if (!hasPermission(perms.server, ServerPermissions.VIEW_AUDIT_LOG)) {
        return forbidden(reply, 'Missing VIEW_AUDIT_LOG permission');
      }

      const { limit = '50', before, user_id, action_type } = request.query as {
        limit?: string;
        before?: string;
        user_id?: string;
        action_type?: string;
      };

      const limitNum = Math.min(parseInt(limit, 10) || 50, 100);

      let query = db.sql`
        SELECT al.*, u.username as actor_username
        FROM audit_log al
        LEFT JOIN users u ON u.id = al.user_id
        WHERE al.server_id = ${server.id}
      `;

      // Build conditions (simplified - full implementation would use query builder)
      const entries = await db.sql`
        SELECT al.*, u.username as actor_username
        FROM audit_log al
        LEFT JOIN users u ON u.id = al.user_id
        WHERE al.server_id = ${server.id}
        ORDER BY al.created_at DESC
        LIMIT ${limitNum}
      `;

      return {
        entries: entries.map((e: any) => ({
          id: e.id,
          action_type: e.action,
          user: e.user_id ? { id: e.user_id, username: e.actor_username } : null,
          target: { type: e.target_type, id: e.target_id },
          changes: e.changes,
          reason: e.reason,
          created_at: e.created_at,
        })),
      };
    },
  });

  // ============================================================
  // CHANNELS - Standalone endpoint
  // ============================================================

  // List all channels in the server
  fastify.get('/channels', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) {
        return [];
      }

      const channels = await db.channels.findByServerId(server.id);
      return channels;
    },
  });
};
