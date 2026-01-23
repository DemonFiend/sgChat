import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { createServer, handleMemberJoin, handleMemberLeave, createRoleFromTemplate, generateInviteCode } from '../services/server.js';
import { calculatePermissions } from '../services/permissions.js';
import { ServerPermissions, hasPermission, createServerSchema, createChannelSchema, createRoleSchema, createInviteSchema, RoleTemplates } from '@voxcord/shared';

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
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'You are not a member of this server',
        });
      }

      const server = await db.servers.findById(id);
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
        return reply.status(403).send({ error: 'Not a member' });
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
        return reply.status(403).send({ error: 'Missing MANAGE_CHANNELS permission' });
      }

      const channel = await db.channels.create({
        server_id: id,
        ...body,
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
        return reply.status(403).send({ error: 'Not a member' });
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
        return reply.status(403).send({ error: 'Not a member' });
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
        return reply.status(403).send({ error: 'Missing MANAGE_ROLES permission' });
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
        return reply.status(403).send({ error: 'Missing MANAGE_ROLES permission' });
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
        return reply.status(403).send({ error: 'Missing MANAGE_SERVER permission' });
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
        return reply.status(403).send({ error: 'Missing CREATE_INVITES permission' });
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
        return reply.status(404).send({ error: 'Invite not found' });
      }

      if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
        return reply.status(410).send({ error: 'Invite expired' });
      }

      if (invite.max_uses && invite.uses >= invite.max_uses) {
        return reply.status(410).send({ error: 'Invite has reached maximum uses' });
      }

      const existing = await db.members.findByUserAndServer(request.user!.id, invite.server_id);
      if (existing) {
        return reply.status(409).send({ error: 'Already a member of this server' });
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
      
      if (server.owner_id === request.user!.id) {
        return reply.status(400).send({
          error: 'Server owner cannot leave. Transfer ownership or delete the server.',
        });
      }

      await handleMemberLeave(request.user!.id, id);
      return { message: 'Left server' };
    },
  });
};
