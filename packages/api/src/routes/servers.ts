import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { createServer, handleMemberJoin, handleMemberLeave, createRoleFromTemplate, generateInviteCode } from '../services/server.js';
import {
  calculatePermissions,
  canManageMember,
  canManageRole,
  timeoutMember,
  removeTimeout,
  getUserRoles,
} from '../services/permissions.js';
import {
  ServerPermissions,
  hasPermission,
  createServerSchema,
  createChannelSchema,
  createRoleSchema,
  createInviteSchema,
  RoleTemplates,
  toNamedPermissions,
  permissionToString,
} from '@sgchat/shared';
import { notFound, forbidden, conflict, badRequest, sendError } from '../utils/errors.js';
import { z } from 'zod';

const updateServerSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  icon_url: z.string().url().nullable().optional(),
  announce_joins: z.boolean().optional(),
  announce_leaves: z.boolean().optional(),
  announce_online: z.boolean().optional(),
  afk_timeout: z.number().min(60).max(3600).optional(),
  afk_channel_id: z.string().uuid().nullable().optional(),
  welcome_channel_id: z.string().uuid().nullable().optional(),
});

const updateRoleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  position: z.number().min(0).optional(),
  // Accept either number or string for bigint compatibility
  server_permissions: z.union([z.number(), z.string()]).optional(),
  text_permissions: z.union([z.number(), z.string()]).optional(),
  voice_permissions: z.union([z.number(), z.string()]).optional(),
  is_hoisted: z.boolean().optional(),
  is_mentionable: z.boolean().optional(),
  description: z.string().max(256).nullable().optional(),
  icon_url: z.string().url().nullable().optional(),
  unicode_emoji: z.string().max(32).nullable().optional(),
});

const kickMemberSchema = z.object({
  reason: z.string().max(512).optional(),
});

const banMemberSchema = z.object({
  reason: z.string().max(512).optional(),
});

const timeoutMemberSchema = z.object({
  duration: z.number().min(1).max(2419200), // 1 second to 28 days
  reason: z.string().max(512).optional(),
});

const bulkRoleAssignSchema = z.object({
  role_ids: z.array(z.string().uuid()),
});

export const serverRoutes: FastifyPluginAsync = async (fastify) => {
  // Get user's servers
  fastify.get('/', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const servers = await db.servers.findByUserId(request.user!.id);
      return servers;
    },
  });

  // Create server
  fastify.post('/', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 5, timeWindow: '1 hour' },
    },
    handler: async (request, reply) => {
      const body = createServerSchema.parse(request.body);
      const server = await createServer(request.user!.id, body.name, body.icon_url);
      return server;
    },
  });

  // Get server by ID
  fastify.get('/:id', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      
      const member = await db.members.findByUserAndServer(request.user!.id, id);
      if (!member) {
        return forbidden(reply, 'You are not a member of this server');
      }

      const server = await db.servers.findById(id);
      if (!server) {
        return notFound(reply, 'Server');
      }
      return server;
    },
  });

  // Get server channels
  fastify.get('/:id/channels', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      
      const member = await db.members.findByUserAndServer(request.user!.id, id);
      if (!member) {
        return forbidden(reply, 'You are not a member of this server');
      }

      const channels = await db.channels.findByServerId(id);
      return channels;
    },
  });

  // Create channel
  fastify.post('/:id/channels', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = createChannelSchema.parse(request.body);
      
      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_CHANNELS)) {
        return forbidden(reply, 'Missing MANAGE_CHANNELS permission');
      }

      const channel = await db.channels.create({
        server_id: id,
        ...body,
      });

      // Emit channel:create socket event to all server members
      fastify.io?.to(`server:${id}`).emit('channel.create', {
        channel: {
          id: channel.id,
          name: channel.name,
          type: channel.type,
          category_id: channel.category_id || null,
          position: channel.position,
          topic: channel.topic || null,
          unread_count: 0,
          has_mentions: false,
        },
      });

      return channel;
    },
  });

  // Get server members
  fastify.get('/:id/members', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      
      const member = await db.members.findByUserAndServer(request.user!.id, id);
      if (!member) {
        return forbidden(reply, 'You are not a member of this server');
      }

      const members = await db.members.findByServerId(id);
      return members;
    },
  });

  // Get server roles
  fastify.get('/:id/roles', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      
      const member = await db.members.findByUserAndServer(request.user!.id, id);
      if (!member) {
        return forbidden(reply, 'You are not a member of this server');
      }

      const roles = await db.roles.findByServerId(id);
      return roles;
    },
  });

  // Create role from template
  fastify.post('/:id/roles/from-template', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const { template } = request.body as { template: keyof typeof RoleTemplates };
      
      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_ROLES)) {
        return forbidden(reply, 'Missing MANAGE_ROLES permission');
      }

      const role = await createRoleFromTemplate(id, template);
      return role;
    },
  });

  // Get server invites
  fastify.get('/:id/invites', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      
      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_SERVER)) {
        return forbidden(reply, 'Missing MANAGE_SERVER permission');
      }

      const invites = await db.invites.findByServerId(id);
      return invites;
    },
  });

  // Create invite
  fastify.post('/:id/invites', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = createInviteSchema.parse(request.body);
      
      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.CREATE_INVITES)) {
        return forbidden(reply, 'Missing CREATE_INVITES permission');
      }

      const code = await generateInviteCode();
      const invite = await db.invites.create({
        code,
        server_id: id,
        creator_id: request.user!.id,
        max_uses: body.max_uses || undefined,
        expires_at: body.expires_at ? new Date(body.expires_at) : undefined,
      });

      return invite;
    },
  });

  // Join server via invite
  fastify.post('/join/:code', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { code } = request.params as { code: string };
      
      const invite = await db.invites.findByCode(code);
      if (!invite) {
        return notFound(reply, 'Invite');
      }

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

      await handleMemberJoin(request.user!.id, invite.server_id);
      await db.invites.incrementUses(code);

      const server = await db.servers.findById(invite.server_id);
      return { server };
    },
  });

  // Leave server
  fastify.post('/:id/leave', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const server = await db.servers.findById(id);
      
      if (!server) {
        return notFound(reply, 'Server');
      }
      
      if (server.owner_id === request.user!.id) {
        return badRequest(reply, 'Server owner cannot leave. Transfer ownership or delete the server.');
      }

      await handleMemberLeave(request.user!.id, id);
      return { message: 'Left server' };
    },
  });

  // ============================================================
  // SERVER SETTINGS (Phase 3)
  // ============================================================

  // Update server settings
  fastify.patch('/:id', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = updateServerSchema.parse(request.body);

      const server = await db.servers.findById(id);
      if (!server) {
        return notFound(reply, 'Server');
      }

      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_SERVER)) {
        return forbidden(reply, 'Missing MANAGE_SERVER permission');
      }

      // Build updates object
      const updates: Record<string, any> = {};
      if (body.name !== undefined) updates.name = body.name;
      if ('icon_url' in body) updates.icon_url = body.icon_url;
      if (body.announce_joins !== undefined) updates.announce_joins = body.announce_joins;
      if (body.announce_leaves !== undefined) updates.announce_leaves = body.announce_leaves;
      if (body.announce_online !== undefined) updates.announce_online = body.announce_online;
      if (body.afk_timeout !== undefined) updates.afk_timeout = body.afk_timeout;
      if ('afk_channel_id' in body) updates.afk_channel_id = body.afk_channel_id;
      if ('welcome_channel_id' in body) updates.welcome_channel_id = body.welcome_channel_id;

      if (Object.keys(updates).length === 0) {
        return badRequest(reply, 'No updates provided');
      }

      // Log the change
      const oldValues: Record<string, any> = {};
      for (const key of Object.keys(updates)) {
        oldValues[key] = (server as any)[key];
      }

      await db.sql`
        UPDATE servers
        SET ${db.sql(updates)}
        WHERE id = ${id}
      `;

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (${id}, ${request.user!.id}, 'server_update', 'server', ${id}, ${JSON.stringify({ old: oldValues, new: updates })})
      `;

      // Broadcast update
      const updatedServer = await db.servers.findById(id);
      fastify.io?.to(`server:${id}`).emit('server.update', updatedServer);

      return updatedServer;
    },
  });

  // Delete server
  fastify.delete('/:id', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };

      const server = await db.servers.findById(id);
      if (!server) {
        return notFound(reply, 'Server');
      }

      // Only owner can delete
      if (server.owner_id !== request.user!.id) {
        return forbidden(reply, 'Only the server owner can delete the server');
      }

      await db.sql`DELETE FROM servers WHERE id = ${id}`;

      // Broadcast deletion
      fastify.io?.to(`server:${id}`).emit('server.delete', { id });

      return { message: 'Server deleted' };
    },
  });

  // Update role
  fastify.patch('/:id/roles/:roleId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, roleId } = request.params as { id: string; roleId: string };
      const body = updateRoleSchema.parse(request.body);

      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_ROLES)) {
        return forbidden(reply, 'Missing MANAGE_ROLES permission');
      }

      const [role] = await db.sql`SELECT * FROM roles WHERE id = ${roleId} AND server_id = ${id}`;
      if (!role) {
        return notFound(reply, 'Role');
      }

      // @everyone role restrictions
      if (role.name === '@everyone') {
        if (body.name !== undefined && body.name !== '@everyone') {
          return badRequest(reply, 'Cannot rename @everyone role');
        }
        if (body.position !== undefined) {
          return badRequest(reply, 'Cannot change position of @everyone role');
        }
      }

      const updates: Record<string, any> = {};
      if (body.name !== undefined) updates.name = body.name;
      if ('color' in body) updates.color = body.color;
      if (body.position !== undefined) updates.position = body.position;
      if (body.server_permissions !== undefined) updates.server_permissions = String(body.server_permissions);
      if (body.text_permissions !== undefined) updates.text_permissions = String(body.text_permissions);
      if (body.voice_permissions !== undefined) updates.voice_permissions = String(body.voice_permissions);

      if (Object.keys(updates).length === 0) {
        return badRequest(reply, 'No updates provided');
      }

      // Log old values for audit
      const oldValues: Record<string, any> = {};
      for (const key of Object.keys(updates)) {
        oldValues[key] = role[key];
      }

      await db.sql`
        UPDATE roles
        SET ${db.sql(updates)}
        WHERE id = ${roleId}
      `;

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (${id}, ${request.user!.id}, 'role_update', 'role', ${roleId}, ${JSON.stringify({ old: oldValues, new: updates })})
      `;

      const [updatedRole] = await db.sql`SELECT * FROM roles WHERE id = ${roleId}`;
      fastify.io?.to(`server:${id}`).emit('role.update', updatedRole);

      return updatedRole;
    },
  });

  // Delete role
  fastify.delete('/:id/roles/:roleId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, roleId } = request.params as { id: string; roleId: string };

      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_ROLES)) {
        return forbidden(reply, 'Missing MANAGE_ROLES permission');
      }

      const [role] = await db.sql`SELECT * FROM roles WHERE id = ${roleId} AND server_id = ${id}`;
      if (!role) {
        return notFound(reply, 'Role');
      }

      if (role.name === '@everyone') {
        return badRequest(reply, 'Cannot delete @everyone role');
      }

      await db.sql`DELETE FROM roles WHERE id = ${roleId}`;

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (${id}, ${request.user!.id}, 'role_delete', 'role', ${roleId}, ${JSON.stringify({ deleted: role })})
      `;

      fastify.io?.to(`server:${id}`).emit('role.delete', { id: roleId });

      return { message: 'Role deleted' };
    },
  });

  // Assign role to member
  fastify.post('/:id/members/:userId/roles/:roleId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, userId, roleId } = request.params as { id: string; userId: string; roleId: string };

      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_ROLES)) {
        return forbidden(reply, 'Missing MANAGE_ROLES permission');
      }

      // Check member exists
      const member = await db.members.findByUserAndServer(userId, id);
      if (!member) {
        return notFound(reply, 'Member');
      }

      // Check role exists
      const [role] = await db.sql`SELECT * FROM roles WHERE id = ${roleId} AND server_id = ${id}`;
      if (!role) {
        return notFound(reply, 'Role');
      }

      // Check not already assigned
      const [existing] = await db.sql`
        SELECT * FROM member_roles 
        WHERE member_user_id = ${userId} 
          AND member_server_id = ${id} 
          AND role_id = ${roleId}
      `;
      if (existing) {
        return conflict(reply, 'Member already has this role');
      }

      await db.sql`
        INSERT INTO member_roles (member_user_id, member_server_id, role_id)
        VALUES (${userId}, ${id}, ${roleId})
      `;

      // Broadcast role assignment
      fastify.io?.to(`server:${id}`).emit('member.role.add', { 
        user_id: userId, 
        server_id: id, 
        role_id: roleId,
        role_name: role.name 
      });

      return { message: 'Role assigned' };
    },
  });

  // Remove role from member
  fastify.delete('/:id/members/:userId/roles/:roleId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, userId, roleId } = request.params as { id: string; userId: string; roleId: string };

      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_ROLES)) {
        return forbidden(reply, 'Missing MANAGE_ROLES permission');
      }

      // Check role is assigned
      const [existing] = await db.sql`
        SELECT * FROM member_roles 
        WHERE member_user_id = ${userId} 
          AND member_server_id = ${id} 
          AND role_id = ${roleId}
      `;
      if (!existing) {
        return notFound(reply, 'Member does not have this role');
      }

      await db.sql`
        DELETE FROM member_roles 
        WHERE member_user_id = ${userId} 
          AND member_server_id = ${id} 
          AND role_id = ${roleId}
      `;

      // Broadcast role removal
      fastify.io?.to(`server:${id}`).emit('member.role.remove', { 
        user_id: userId, 
        server_id: id, 
        role_id: roleId 
      });

      return { message: 'Role removed' };
    },
  });

  // ============================================================
  // MODERATION (Phase 5)
  // ============================================================

  // Kick member
  fastify.post('/:id/members/:userId/kick', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, userId } = request.params as { id: string; userId: string };
      const body = kickMemberSchema.parse(request.body || {});

      const server = await db.servers.findById(id);
      if (!server) {
        return notFound(reply, 'Server');
      }

      // Can't kick owner
      if (userId === server.owner_id) {
        return badRequest(reply, 'Cannot kick the server owner');
      }

      // Can't kick yourself
      if (userId === request.user!.id) {
        return badRequest(reply, 'Cannot kick yourself');
      }

      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.KICK_MEMBERS)) {
        return forbidden(reply, 'Missing KICK_MEMBERS permission');
      }

      const member = await db.members.findByUserAndServer(userId, id);
      if (!member) {
        return notFound(reply, 'Member');
      }

      await handleMemberLeave(userId, id);

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, reason)
        VALUES (${id}, ${request.user!.id}, 'member_kick', 'member', ${userId}, ${body.reason || null})
      `;

      // Notify kicked user
      fastify.io?.to(`user:${userId}`).emit('server.kicked', { 
        server_id: id, 
        server_name: server.name,
        reason: body.reason 
      });

      return { message: 'Member kicked' };
    },
  });

  // Ban member
  fastify.post('/:id/members/:userId/ban', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, userId } = request.params as { id: string; userId: string };
      const body = banMemberSchema.parse(request.body || {});

      const server = await db.servers.findById(id);
      if (!server) {
        return notFound(reply, 'Server');
      }

      // Can't ban owner
      if (userId === server.owner_id) {
        return badRequest(reply, 'Cannot ban the server owner');
      }

      // Can't ban yourself
      if (userId === request.user!.id) {
        return badRequest(reply, 'Cannot ban yourself');
      }

      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.BAN_MEMBERS)) {
        return forbidden(reply, 'Missing BAN_MEMBERS permission');
      }

      // Check if already banned
      const [existingBan] = await db.sql`
        SELECT * FROM bans WHERE server_id = ${id} AND user_id = ${userId}
      `;
      if (existingBan) {
        return conflict(reply, 'User is already banned');
      }

      // Remove from server if member
      const member = await db.members.findByUserAndServer(userId, id);
      if (member) {
        await handleMemberLeave(userId, id);
      }

      // Create ban
      await db.sql`
        INSERT INTO bans (server_id, user_id, moderator_id, reason)
        VALUES (${id}, ${userId}, ${request.user!.id}, ${body.reason || null})
      `;

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, reason)
        VALUES (${id}, ${request.user!.id}, 'member_ban', 'member', ${userId}, ${body.reason || null})
      `;

      // Notify banned user
      fastify.io?.to(`user:${userId}`).emit('server.banned', { 
        server_id: id, 
        server_name: server.name,
        reason: body.reason 
      });

      return { message: 'Member banned' };
    },
  });

  // Get bans list
  fastify.get('/:id/bans', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };

      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.BAN_MEMBERS)) {
        return forbidden(reply, 'Missing BAN_MEMBERS permission');
      }

      const bans = await db.sql`
        SELECT b.*, u.username, u.avatar_url, m.username as moderator_username
        FROM bans b
        JOIN users u ON u.id = b.user_id
        LEFT JOIN users m ON m.id = b.moderator_id
        WHERE b.server_id = ${id}
        ORDER BY b.created_at DESC
      `;

      return bans;
    },
  });

  // Unban member
  fastify.delete('/:id/bans/:userId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, userId } = request.params as { id: string; userId: string };

      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.BAN_MEMBERS)) {
        return forbidden(reply, 'Missing BAN_MEMBERS permission');
      }

      const [ban] = await db.sql`
        SELECT * FROM bans WHERE server_id = ${id} AND user_id = ${userId}
      `;
      if (!ban) {
        return notFound(reply, 'Ban');
      }

      await db.sql`DELETE FROM bans WHERE server_id = ${id} AND user_id = ${userId}`;

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id)
        VALUES (${id}, ${request.user!.id}, 'member_unban', 'member', ${userId})
      `;

      return { message: 'Member unbanned' };
    },
  });

  // Delete invite
  fastify.delete('/:id/invites/:code', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, code } = request.params as { id: string; code: string };

      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_SERVER)) {
        return forbidden(reply, 'Missing MANAGE_SERVER permission');
      }

      const invite = await db.invites.findByCode(code);
      if (!invite || invite.server_id !== id) {
        return notFound(reply, 'Invite');
      }

      await db.sql`DELETE FROM invites WHERE code = ${code}`;

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id)
        VALUES (${id}, ${request.user!.id}, 'invite_delete', 'invite', ${code})
      `;

      return { message: 'Invite deleted' };
    },
  });

  // Get audit log
  fastify.get('/:id/audit-log', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const { limit = '50', before } = request.query as { limit?: string; before?: string };

      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.VIEW_AUDIT_LOG)) {
        return forbidden(reply, 'Missing VIEW_AUDIT_LOG permission');
      }

      const limitNum = Math.min(parseInt(limit, 10) || 50, 100);

      let entries;
      if (before) {
        entries = await db.sql`
          SELECT al.*, u.username as actor_username
          FROM audit_log al
          LEFT JOIN users u ON u.id = al.user_id
          WHERE al.server_id = ${id}
            AND al.created_at < ${new Date(before)}
          ORDER BY al.created_at DESC
          LIMIT ${limitNum}
        `;
      } else {
        entries = await db.sql`
          SELECT al.*, u.username as actor_username
          FROM audit_log al
          LEFT JOIN users u ON u.id = al.user_id
          WHERE al.server_id = ${id}
          ORDER BY al.created_at DESC
          LIMIT ${limitNum}
        `;
      }

      return entries;
    },
  });

  // Transfer ownership
  fastify.post('/:id/transfer', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const { userId } = request.body as { userId: string };

      const server = await db.servers.findById(id);
      if (!server) {
        return notFound(reply, 'Server');
      }

      // Only owner can transfer
      if (server.owner_id !== request.user!.id) {
        return forbidden(reply, 'Only the server owner can transfer ownership');
      }

      // Check new owner is a member
      const member = await db.members.findByUserAndServer(userId, id);
      if (!member) {
        return badRequest(reply, 'New owner must be a member of the server');
      }

      await db.sql`UPDATE servers SET owner_id = ${userId} WHERE id = ${id}`;

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (${id}, ${request.user!.id}, 'server_update', 'server', ${id}, ${JSON.stringify({ old: { owner_id: request.user!.id }, new: { owner_id: userId } })})
      `;

      const updatedServer = await db.servers.findById(id);
      fastify.io?.to(`server:${id}`).emit('server.update', updatedServer);

      return { message: 'Ownership transferred', new_owner_id: userId };
    },
  });

  // ============================================================
  // TIMEOUT MANAGEMENT
  // ============================================================

  // Timeout a member
  fastify.post('/:id/members/:userId/timeout', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, userId } = request.params as { id: string; userId: string };
      const body = timeoutMemberSchema.parse(request.body);

      const server = await db.servers.findById(id);
      if (!server) {
        return notFound(reply, 'Server');
      }

      // Can't timeout owner
      if (userId === server.owner_id) {
        return badRequest(reply, 'Cannot timeout the server owner');
      }

      // Can't timeout yourself
      if (userId === request.user!.id) {
        return badRequest(reply, 'Cannot timeout yourself');
      }

      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.TIMEOUT_MEMBERS)) {
        return forbidden(reply, 'Missing TIMEOUT_MEMBERS permission');
      }

      // Check role hierarchy
      const canManage = await canManageMember(request.user!.id, userId, id);
      if (!canManage) {
        return forbidden(reply, 'Cannot timeout members with equal or higher roles');
      }

      const member = await db.members.findByUserAndServer(userId, id);
      if (!member) {
        return notFound(reply, 'Member');
      }

      await timeoutMember(userId, id, body.duration, body.reason);

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, reason, changes)
        VALUES (${id}, ${request.user!.id}, 'member_timeout', 'member', ${userId}, ${body.reason || null}, ${JSON.stringify({ duration: body.duration })})
      `;

      // Notify the timed out user
      fastify.io?.to(`user:${userId}`).emit('member.timeout', {
        server_id: id,
        server_name: server.name,
        duration: body.duration,
        reason: body.reason,
      });

      return { message: 'Member timed out', duration: body.duration };
    },
  });

  // Remove timeout from a member
  fastify.delete('/:id/members/:userId/timeout', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, userId } = request.params as { id: string; userId: string };

      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.TIMEOUT_MEMBERS)) {
        return forbidden(reply, 'Missing TIMEOUT_MEMBERS permission');
      }

      const member = await db.members.findByUserAndServer(userId, id);
      if (!member) {
        return notFound(reply, 'Member');
      }

      await removeTimeout(userId, id);

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id)
        VALUES (${id}, ${request.user!.id}, 'member_timeout_remove', 'member', ${userId})
      `;

      // Notify the user their timeout was removed
      fastify.io?.to(`user:${userId}`).emit('member.timeout.remove', {
        server_id: id,
      });

      return { message: 'Timeout removed' };
    },
  });

  // ============================================================
  // ENHANCED ROLE MANAGEMENT
  // ============================================================

  // Get a single role with full details
  fastify.get('/:id/roles/:roleId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, roleId } = request.params as { id: string; roleId: string };

      const member = await db.members.findByUserAndServer(request.user!.id, id);
      if (!member) {
        return forbidden(reply, 'You are not a member of this server');
      }

      const [role] = await db.sql`
        SELECT * FROM roles WHERE id = ${roleId} AND server_id = ${id}
      `;

      if (!role) {
        return notFound(reply, 'Role');
      }

      // Convert permissions to named object for easier client consumption
      const namedPermissions = toNamedPermissions(
        role.server_permissions || '0',
        role.text_permissions || '0',
        role.voice_permissions || '0'
      );

      return {
        ...role,
        permissions: namedPermissions,
      };
    },
  });

  // Create role with full options
  fastify.post('/:id/roles', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = createRoleSchema.parse(request.body);

      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_ROLES)) {
        return forbidden(reply, 'Missing MANAGE_ROLES permission');
      }

      // Get the next position
      const [maxPos] = await db.sql`
        SELECT COALESCE(MAX(position), 0) + 1 as next_position
        FROM roles
        WHERE server_id = ${id}
      `;

      const [role] = await db.sql`
        INSERT INTO roles (
          server_id, name, position, color,
          server_permissions, text_permissions, voice_permissions,
          is_hoisted, is_mentionable, description
        )
        VALUES (
          ${id},
          ${body.name},
          ${maxPos.next_position},
          ${body.color || null},
          ${String(body.server_permissions || 0)},
          ${String(body.text_permissions || 0)},
          ${String(body.voice_permissions || 0)},
          false,
          false,
          null
        )
        RETURNING *
      `;

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (${id}, ${request.user!.id}, 'role_create', 'role', ${role.id}, ${JSON.stringify({ created: role })})
      `;

      fastify.io?.to(`server:${id}`).emit('role.create', role);

      return role;
    },
  });

  // Bulk update role positions (reorder roles)
  fastify.patch('/:id/roles/reorder', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const { roles } = request.body as { roles: { id: string; position: number }[] };

      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_ROLES)) {
        return forbidden(reply, 'Missing MANAGE_ROLES permission');
      }

      // Verify all roles belong to this server and check hierarchy
      for (const roleUpdate of roles) {
        const [role] = await db.sql`SELECT * FROM roles WHERE id = ${roleUpdate.id} AND server_id = ${id}`;
        if (!role) {
          return badRequest(reply, `Role ${roleUpdate.id} not found in this server`);
        }

        // @everyone role must stay at position 0
        if (role.name === '@everyone' && roleUpdate.position !== 0) {
          return badRequest(reply, '@everyone role must stay at position 0');
        }

        // Check if user can manage this role
        const canManage = await canManageRole(request.user!.id, id, roleUpdate.id);
        if (!canManage) {
          return forbidden(reply, `Cannot reorder role "${role.name}" - it is at or above your highest role`);
        }
      }

      // Update positions
      for (const roleUpdate of roles) {
        await db.sql`
          UPDATE roles
          SET position = ${roleUpdate.position}
          WHERE id = ${roleUpdate.id}
        `;
      }

      const updatedRoles = await db.roles.findByServerId(id);
      fastify.io?.to(`server:${id}`).emit('roles.reorder', updatedRoles);

      return updatedRoles;
    },
  });

  // Get member's roles
  fastify.get('/:id/members/:userId/roles', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, userId } = request.params as { id: string; userId: string };

      const member = await db.members.findByUserAndServer(request.user!.id, id);
      if (!member) {
        return forbidden(reply, 'You are not a member of this server');
      }

      const roles = await getUserRoles(userId, id);
      return roles;
    },
  });

  // Bulk assign roles to member
  fastify.put('/:id/members/:userId/roles', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, userId } = request.params as { id: string; userId: string };
      const body = bulkRoleAssignSchema.parse(request.body);

      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_ROLES)) {
        return forbidden(reply, 'Missing MANAGE_ROLES permission');
      }

      // Check member exists
      const member = await db.members.findByUserAndServer(userId, id);
      if (!member) {
        return notFound(reply, 'Member');
      }

      // Verify all roles exist and check hierarchy
      for (const roleId of body.role_ids) {
        const [role] = await db.sql`SELECT * FROM roles WHERE id = ${roleId} AND server_id = ${id}`;
        if (!role) {
          return badRequest(reply, `Role ${roleId} not found`);
        }

        const canManage = await canManageRole(request.user!.id, id, roleId);
        if (!canManage) {
          return forbidden(reply, `Cannot assign role "${role.name}" - it is at or above your highest role`);
        }
      }

      // Remove all current roles
      await db.sql`
        DELETE FROM member_roles
        WHERE member_user_id = ${userId} AND member_server_id = ${id}
      `;

      // Assign new roles
      for (const roleId of body.role_ids) {
        await db.sql`
          INSERT INTO member_roles (member_user_id, member_server_id, role_id)
          VALUES (${userId}, ${id}, ${roleId})
        `;
      }

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (${id}, ${request.user!.id}, 'member_role_update', 'member', ${userId}, ${JSON.stringify({ role_ids: body.role_ids })})
      `;

      const updatedRoles = await getUserRoles(userId, id);

      // Broadcast role update
      fastify.io?.to(`server:${id}`).emit('member.roles.update', {
        user_id: userId,
        server_id: id,
        roles: updatedRoles,
      });

      return updatedRoles;
    },
  });

  // ============================================================
  // PERMISSION INFORMATION
  // ============================================================

  // Get current user's permissions in this server
  fastify.get('/:id/permissions', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const { channel_id } = request.query as { channel_id?: string };

      const member = await db.members.findByUserAndServer(request.user!.id, id);
      if (!member) {
        return forbidden(reply, 'You are not a member of this server');
      }

      const perms = await calculatePermissions(request.user!.id, id, channel_id);

      // Convert to named permissions for client
      const namedPermissions = toNamedPermissions(
        perms.server,
        perms.text,
        perms.voice
      );

      return {
        server: permissionToString(perms.server),
        text: permissionToString(perms.text),
        voice: permissionToString(perms.voice),
        is_owner: perms.isOwner,
        is_timed_out: perms.isTimedOut,
        permissions: namedPermissions,
      };
    },
  });

  // Get a specific member's permissions (requires MANAGE_ROLES)
  fastify.get('/:id/members/:userId/permissions', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, userId } = request.params as { id: string; userId: string };
      const { channel_id } = request.query as { channel_id?: string };

      const actorPerms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(actorPerms.server, ServerPermissions.MANAGE_ROLES)) {
        return forbidden(reply, 'Missing MANAGE_ROLES permission');
      }

      const member = await db.members.findByUserAndServer(userId, id);
      if (!member) {
        return notFound(reply, 'Member');
      }

      const perms = await calculatePermissions(userId, id, channel_id);
      const namedPermissions = toNamedPermissions(
        perms.server,
        perms.text,
        perms.voice
      );

      return {
        server: permissionToString(perms.server),
        text: permissionToString(perms.text),
        voice: permissionToString(perms.voice),
        is_owner: perms.isOwner,
        is_timed_out: perms.isTimedOut,
        permissions: namedPermissions,
      };
    },
  });

  // ============================================================
  // CATEGORY MANAGEMENT
  // ============================================================

  // Get server categories
  fastify.get('/:id/categories', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };

      const member = await db.members.findByUserAndServer(request.user!.id, id);
      if (!member) {
        return forbidden(reply, 'You are not a member of this server');
      }

      const categories = await db.sql`
        SELECT * FROM categories
        WHERE server_id = ${id}
        ORDER BY position ASC
      `;

      return categories;
    },
  });

  // Create category
  fastify.post('/:id/categories', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const { name } = request.body as { name: string };

      if (!name || name.length < 1 || name.length > 100) {
        return badRequest(reply, 'Category name must be 1-100 characters');
      }

      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_CATEGORIES)) {
        return forbidden(reply, 'Missing MANAGE_CATEGORIES permission');
      }

      // Get next position
      const [maxPos] = await db.sql`
        SELECT COALESCE(MAX(position), -1) + 1 as next_position
        FROM categories
        WHERE server_id = ${id}
      `;

      const [category] = await db.sql`
        INSERT INTO categories (server_id, name, position)
        VALUES (${id}, ${name}, ${maxPos.next_position})
        RETURNING *
      `;

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (${id}, ${request.user!.id}, 'category_create', 'channel', ${category.id}, ${JSON.stringify({ created: category })})
      `;

      fastify.io?.to(`server:${id}`).emit('category.create', category);

      return category;
    },
  });

  // Update category
  fastify.patch('/:id/categories/:categoryId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, categoryId } = request.params as { id: string; categoryId: string };
      const { name, position } = request.body as { name?: string; position?: number };

      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_CATEGORIES)) {
        return forbidden(reply, 'Missing MANAGE_CATEGORIES permission');
      }

      const [category] = await db.sql`
        SELECT * FROM categories WHERE id = ${categoryId} AND server_id = ${id}
      `;

      if (!category) {
        return notFound(reply, 'Category');
      }

      const updates: Record<string, any> = {};
      if (name !== undefined) updates.name = name;
      if (position !== undefined) updates.position = position;

      if (Object.keys(updates).length === 0) {
        return badRequest(reply, 'No updates provided');
      }

      await db.sql`
        UPDATE categories
        SET ${db.sql(updates)}
        WHERE id = ${categoryId}
      `;

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (${id}, ${request.user!.id}, 'category_update', 'channel', ${categoryId}, ${JSON.stringify({ updates })})
      `;

      const [updatedCategory] = await db.sql`SELECT * FROM categories WHERE id = ${categoryId}`;
      fastify.io?.to(`server:${id}`).emit('category.update', updatedCategory);

      return updatedCategory;
    },
  });

  // Delete category
  fastify.delete('/:id/categories/:categoryId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, categoryId } = request.params as { id: string; categoryId: string };

      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_CATEGORIES)) {
        return forbidden(reply, 'Missing MANAGE_CATEGORIES permission');
      }

      const [category] = await db.sql`
        SELECT * FROM categories WHERE id = ${categoryId} AND server_id = ${id}
      `;

      if (!category) {
        return notFound(reply, 'Category');
      }

      // Remove category_id from channels (don't delete channels)
      await db.sql`
        UPDATE channels
        SET category_id = NULL
        WHERE category_id = ${categoryId}
      `;

      await db.sql`DELETE FROM categories WHERE id = ${categoryId}`;

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (${id}, ${request.user!.id}, 'category_delete', 'channel', ${categoryId}, ${JSON.stringify({ deleted: category })})
      `;

      fastify.io?.to(`server:${id}`).emit('category.delete', { id: categoryId, server_id: id });

      return { message: 'Category deleted' };
    },
  });

  // ============================================================
  // CATEGORY PERMISSION OVERRIDES
  // ============================================================

  // Get category permission overrides
  fastify.get('/:id/categories/:categoryId/permissions', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, categoryId } = request.params as { id: string; categoryId: string };

      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_CATEGORIES)) {
        return forbidden(reply, 'Missing MANAGE_CATEGORIES permission');
      }

      const [category] = await db.sql`
        SELECT * FROM categories WHERE id = ${categoryId} AND server_id = ${id}
      `;

      if (!category) {
        return notFound(reply, 'Category');
      }

      const overrides = await db.sql`
        SELECT 
          cpo.id,
          cpo.category_id,
          cpo.role_id,
          cpo.user_id,
          cpo.text_allow,
          cpo.text_deny,
          cpo.voice_allow,
          cpo.voice_deny,
          r.name as role_name,
          r.color as role_color,
          u.username as user_username,
          u.avatar_url as user_avatar_url
        FROM category_permission_overrides cpo
        LEFT JOIN roles r ON cpo.role_id = r.id
        LEFT JOIN users u ON cpo.user_id = u.id
        WHERE cpo.category_id = ${categoryId}
        ORDER BY r.position DESC NULLS LAST, u.username ASC
      `;

      return {
        overrides: overrides.map((o: any) => ({
          id: o.id,
          category_id: o.category_id,
          type: o.role_id ? 'role' : 'user',
          target_id: o.role_id || o.user_id,
          target_name: o.role_name || o.user_username,
          target_color: o.role_color || null,
          target_avatar: o.user_avatar_url || null,
          text_allow: o.text_allow,
          text_deny: o.text_deny,
          voice_allow: o.voice_allow,
          voice_deny: o.voice_deny,
        })),
      };
    },
  });

  // Set role permission override for category
  fastify.put('/:id/categories/:categoryId/permissions/roles/:roleId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, categoryId, roleId } = request.params as { id: string; categoryId: string; roleId: string };
      const body = request.body as {
        text_allow?: string;
        text_deny?: string;
        voice_allow?: string;
        voice_deny?: string;
      };

      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_CATEGORIES)) {
        return forbidden(reply, 'Missing MANAGE_CATEGORIES permission');
      }

      // Verify category exists
      const [category] = await db.sql`
        SELECT * FROM categories WHERE id = ${categoryId} AND server_id = ${id}
      `;
      if (!category) {
        return notFound(reply, 'Category');
      }

      // Verify role exists
      const [role] = await db.sql`
        SELECT * FROM roles WHERE id = ${roleId} AND server_id = ${id}
      `;
      if (!role) {
        return notFound(reply, 'Role');
      }

      // Upsert the override
      const [override] = await db.sql`
        INSERT INTO category_permission_overrides (
          category_id, role_id, text_allow, text_deny, voice_allow, voice_deny
        )
        VALUES (
          ${categoryId},
          ${roleId},
          ${body.text_allow || '0'},
          ${body.text_deny || '0'},
          ${body.voice_allow || '0'},
          ${body.voice_deny || '0'}
        )
        ON CONFLICT (category_id, role_id)
        DO UPDATE SET
          text_allow = ${body.text_allow || '0'},
          text_deny = ${body.text_deny || '0'},
          voice_allow = ${body.voice_allow || '0'},
          voice_deny = ${body.voice_deny || '0'}
        RETURNING *
      `;

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (${id}, ${request.user!.id}, 'category_permission_update', 'channel', ${categoryId}, ${JSON.stringify({ role_id: roleId, ...body })})
      `;

      fastify.io?.to(`server:${id}`).emit('category.permissions.update', {
        category_id: categoryId,
        type: 'role',
        target_id: roleId,
      });

      return override;
    },
  });

  // Delete role permission override for category
  fastify.delete('/:id/categories/:categoryId/permissions/roles/:roleId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id, categoryId, roleId } = request.params as { id: string; categoryId: string; roleId: string };

      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_CATEGORIES)) {
        return forbidden(reply, 'Missing MANAGE_CATEGORIES permission');
      }

      await db.sql`
        DELETE FROM category_permission_overrides
        WHERE category_id = ${categoryId} AND role_id = ${roleId}
      `;

      fastify.io?.to(`server:${id}`).emit('category.permissions.delete', {
        category_id: categoryId,
        type: 'role',
        target_id: roleId,
      });

      return { message: 'Permission override removed' };
    },
  });
};
