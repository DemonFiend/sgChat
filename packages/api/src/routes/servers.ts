import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { createServer, handleMemberJoin, handleMemberLeave, createRoleFromTemplate, generateInviteCode } from '../services/server.js';
import { calculatePermissions } from '../services/permissions.js';
import { ServerPermissions, hasPermission, createServerSchema, createChannelSchema, createRoleSchema, createInviteSchema, RoleTemplates } from '@sgchat/shared';
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
  server_permissions: z.number().optional(),
  text_permissions: z.number().optional(),
  voice_permissions: z.number().optional(),
});

const kickMemberSchema = z.object({
  reason: z.string().max(512).optional(),
});

const banMemberSchema = z.object({
  reason: z.string().max(512).optional(),
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
      fastify.io?.to(`server:${id}`).emit('channel:create', {
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

  // Create role
  fastify.post('/:id/roles', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = createRoleSchema.parse(request.body);
      
      const perms = await calculatePermissions(request.user!.id, id);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_ROLES)) {
        return forbidden(reply, 'Missing MANAGE_ROLES permission');
      }

      const role = await db.roles.create({
        server_id: id,
        name: body.name,
        color: body.color || undefined,
        server_permissions: body.server_permissions,
        text_permissions: body.text_permissions,
        voice_permissions: body.voice_permissions,
      });

      return role;
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
      fastify.io?.to(`server:${id}`).emit('server:update', updatedServer);

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
      fastify.io?.to(`server:${id}`).emit('server:delete', { id });

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
      fastify.io?.to(`server:${id}`).emit('role:update', updatedRole);

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

      fastify.io?.to(`server:${id}`).emit('role:delete', { id: roleId });

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
      fastify.io?.to(`server:${id}`).emit('member:role:add', { 
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
      fastify.io?.to(`server:${id}`).emit('member:role:remove', { 
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
      fastify.io?.to(`user:${userId}`).emit('server:kicked', { 
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
      fastify.io?.to(`user:${userId}`).emit('server:banned', { 
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
      fastify.io?.to(`server:${id}`).emit('server:update', updatedServer);

      return { message: 'Ownership transferred', new_owner_id: userId };
    },
  });
};
