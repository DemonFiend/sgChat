import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { publishEvent } from '../lib/eventBus.js';
import { calculatePermissions } from '../services/permissions.js';
import { ServerPermissions, hasPermission } from '@sgchat/shared';
import { notFound, badRequest, forbidden } from '../utils/errors.js';
import {
  createServerEventSchema,
  updateServerEventSchema,
  rsvpSchema,
  eventListQuerySchema,
} from '@sgchat/shared';

function formatMonth(month: string) {
  const [year, m] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, m - 1, 1)).toISOString();
  const end = new Date(Date.UTC(year, m, 1)).toISOString();
  return { start, end };
}

function formatEvent(row: any) {
  return {
    ...row,
    rsvp_counts: {
      interested: row.rsvp_interested ?? 0,
      tentative: row.rsvp_tentative ?? 0,
      not_interested: row.rsvp_not_interested ?? 0,
    },
    my_rsvp: row.my_rsvp || null,
    visible_role_ids: row.visible_role_ids || [],
    rsvp_interested: undefined,
    rsvp_tentative: undefined,
    rsvp_not_interested: undefined,
  };
}

async function getUserRoleIds(userId: string, serverId: string): Promise<string[]> {
  const roles = await db.memberRoles.findByMember(userId, serverId);
  const everyoneRole = await db.roles.findEveryoneRole(serverId);
  const ids = roles.map((r: any) => r.id);
  if (everyoneRole) ids.push(everyoneRole.id);
  return ids;
}

export const eventRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /:serverId/events?month=YYYY-MM
  fastify.get('/:serverId/events', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId } = request.params as { serverId: string };
      const query = eventListQuerySchema.parse(request.query);

      const member = await db.members.findByUserAndServer(request.user!.id, serverId);
      if (!member) return forbidden(reply, 'Not a server member');

      const { start, end } = formatMonth(query.month);
      const userRoleIds = await getUserRoleIds(request.user!.id, serverId);

      const events = await db.serverEvents.findByServerAndMonth(
        serverId,
        start,
        end,
        request.user!.id,
        userRoleIds,
      );

      return { events: events.map(formatEvent) };
    },
  });

  // GET /:serverId/events/history?month=YYYY-MM
  fastify.get('/:serverId/events/history', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId } = request.params as { serverId: string };
      const query = eventListQuerySchema.parse(request.query);

      const member = await db.members.findByUserAndServer(request.user!.id, serverId);
      if (!member) return forbidden(reply, 'Not a server member');

      const { start, end } = formatMonth(query.month);
      const userRoleIds = await getUserRoleIds(request.user!.id, serverId);

      // History includes cancelled events, regular view does not
      const events = await db.serverEvents.findByServerAndMonth(
        serverId,
        start,
        end,
        request.user!.id,
        userRoleIds,
        true,
      );

      return { events: events.map(formatEvent) };
    },
  });

  // POST /:serverId/events
  fastify.post('/:serverId/events', {
    onRequest: [authenticate],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      const { serverId } = request.params as { serverId: string };
      const body = createServerEventSchema.parse(request.body);

      const member = await db.members.findByUserAndServer(request.user!.id, serverId);
      if (!member) return forbidden(reply, 'Not a server member');

      const server = await db.servers.findById(serverId);
      if (!server) return notFound(reply, 'Server');

      const perms = await calculatePermissions(request.user!.id, serverId);
      const canCreate =
        hasPermission(perms.server, ServerPermissions.CREATE_EVENTS) ||
        hasPermission(perms.server, ServerPermissions.MANAGE_EVENTS);
      if (!canCreate) return forbidden(reply, 'Missing CREATE_EVENTS permission');

      // Default end_time to start + 1 hour
      const startTime = body.start_time;
      const endTime =
        body.end_time || new Date(new Date(startTime).getTime() + 3600000).toISOString();

      if (new Date(endTime) <= new Date(startTime)) {
        return badRequest(reply, 'End time must be after start time');
      }

      // Resolve announcement channel
      const announcementChannelId = body.announcement_channel_id ?? null;
      if (announcementChannelId) {
        const channel = await db.channels.findById(announcementChannelId);
        if (!channel || channel.server_id !== serverId) {
          return badRequest(reply, 'Invalid announcement channel');
        }
      }

      const event = await db.serverEvents.create({
        server_id: serverId,
        created_by: request.user!.id,
        title: body.title,
        description: body.description ?? null,
        start_time: startTime,
        end_time: endTime,
        announce_at_start: body.announce_at_start ?? true,
        announcement_channel_id: announcementChannelId,
        visibility: body.visibility || 'public',
      });

      // Set role visibility for private events
      if (body.visibility === 'private' && body.role_ids && body.role_ids.length > 0) {
        await db.serverEvents.setVisibleRoles(event.id, body.role_ids);
      }

      const month = startTime.substring(0, 7);
      await publishEvent({
        type: 'serverEvents.invalidate' as any,
        actorId: request.user!.id,
        resourceId: `server:${serverId}`,
        payload: { serverId, month },
      });

      return reply.status(201).send(event);
    },
  });

  // PATCH /:serverId/events/:eventId
  fastify.patch('/:serverId/events/:eventId', {
    onRequest: [authenticate],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      const { serverId, eventId } = request.params as { serverId: string; eventId: string };
      const body = updateServerEventSchema.parse(request.body);

      const member = await db.members.findByUserAndServer(request.user!.id, serverId);
      if (!member) return forbidden(reply, 'Not a server member');

      const event = await db.serverEvents.findById(eventId);
      if (!event || event.server_id !== serverId || event.deleted_at) {
        return notFound(reply, 'Event');
      }

      const perms = await calculatePermissions(request.user!.id, serverId);
      const canManage = hasPermission(perms.server, ServerPermissions.MANAGE_EVENTS);
      const isCreator = event.created_by === request.user!.id;
      const creatorCanEdit =
        isCreator && hasPermission(perms.server, ServerPermissions.CREATE_EVENTS);

      if (!canManage && !creatorCanEdit) {
        return forbidden(reply, 'Missing MANAGE_EVENTS permission');
      }

      // Build update data
      const updateData: Record<string, any> = {};
      if (body.title !== undefined) updateData.title = body.title;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.start_time !== undefined) updateData.start_time = body.start_time;
      if (body.end_time !== undefined) updateData.end_time = body.end_time;
      if (body.announce_at_start !== undefined) updateData.announce_at_start = body.announce_at_start;
      if (body.visibility !== undefined) updateData.visibility = body.visibility;

      if (body.announcement_channel_id !== undefined) {
        if (body.announcement_channel_id) {
          const channel = await db.channels.findById(body.announcement_channel_id);
          if (!channel || channel.server_id !== serverId) {
            return badRequest(reply, 'Invalid announcement channel');
          }
        }
        updateData.announcement_channel_id = body.announcement_channel_id;
      }

      // Validate times
      const finalStart = updateData.start_time || event.start_time;
      const finalEnd = updateData.end_time || event.end_time;
      if (new Date(finalEnd) <= new Date(finalStart)) {
        return badRequest(reply, 'End time must be after start time');
      }

      const updated = await db.serverEvents.update(eventId, updateData);
      if (!updated) return notFound(reply, 'Event');

      // Update role visibility
      if (body.role_ids !== undefined) {
        await db.serverEvents.setVisibleRoles(eventId, body.role_ids);
      }

      const month = new Date(updated.start_time).toISOString().substring(0, 7);
      await publishEvent({
        type: 'serverEvents.invalidate' as any,
        actorId: request.user!.id,
        resourceId: `server:${serverId}`,
        payload: { serverId, month },
      });

      return reply.send(updated);
    },
  });

  // POST /:serverId/events/:eventId/cancel
  fastify.post('/:serverId/events/:eventId/cancel', {
    onRequest: [authenticate],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      const { serverId, eventId } = request.params as { serverId: string; eventId: string };

      const member = await db.members.findByUserAndServer(request.user!.id, serverId);
      if (!member) return forbidden(reply, 'Not a server member');

      const event = await db.serverEvents.findById(eventId);
      if (!event || event.server_id !== serverId || event.deleted_at) {
        return notFound(reply, 'Event');
      }

      const perms = await calculatePermissions(request.user!.id, serverId);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_EVENTS)) {
        return forbidden(reply, 'Missing MANAGE_EVENTS permission');
      }

      const cancelled = await db.serverEvents.cancel(eventId);
      if (!cancelled) return notFound(reply, 'Event');

      const month = new Date(cancelled.start_time).toISOString().substring(0, 7);
      await publishEvent({
        type: 'serverEvents.invalidate' as any,
        actorId: request.user!.id,
        resourceId: `server:${serverId}`,
        payload: { serverId, month },
      });

      return reply.send(cancelled);
    },
  });

  // DELETE /:serverId/events/:eventId (soft delete)
  fastify.delete('/:serverId/events/:eventId', {
    onRequest: [authenticate],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      const { serverId, eventId } = request.params as { serverId: string; eventId: string };

      const member = await db.members.findByUserAndServer(request.user!.id, serverId);
      if (!member) return forbidden(reply, 'Not a server member');

      const event = await db.serverEvents.findById(eventId);
      if (!event || event.server_id !== serverId || event.deleted_at) {
        return notFound(reply, 'Event');
      }

      const perms = await calculatePermissions(request.user!.id, serverId);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_EVENTS)) {
        return forbidden(reply, 'Missing MANAGE_EVENTS permission');
      }

      await db.serverEvents.softDelete(eventId);

      const month = new Date(event.start_time).toISOString().substring(0, 7);
      await publishEvent({
        type: 'serverEvents.invalidate' as any,
        actorId: request.user!.id,
        resourceId: `server:${serverId}`,
        payload: { serverId, month },
      });

      return reply.status(204).send();
    },
  });

  // PUT /:serverId/events/:eventId/rsvp
  fastify.put('/:serverId/events/:eventId/rsvp', {
    onRequest: [authenticate],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      const { serverId, eventId } = request.params as { serverId: string; eventId: string };
      const body = rsvpSchema.parse(request.body);

      const member = await db.members.findByUserAndServer(request.user!.id, serverId);
      if (!member) return forbidden(reply, 'Not a server member');

      const event = await db.serverEvents.findById(eventId);
      if (!event || event.server_id !== serverId || event.deleted_at) {
        return notFound(reply, 'Event');
      }

      const perms = await calculatePermissions(request.user!.id, serverId);

      // Check RSVP permission
      if (
        !hasPermission(perms.server, ServerPermissions.RSVP_EVENTS) &&
        !hasPermission(perms.server, ServerPermissions.MANAGE_EVENTS)
      ) {
        return forbidden(reply, 'Missing RSVP_EVENTS permission');
      }

      // Visibility check for private events
      if (event.visibility === 'private' && event.created_by !== request.user!.id) {
        const userRoleIds = await getUserRoleIds(request.user!.id, serverId);
        const eventRoleIds = await db.serverEvents.getVisibleRoleIds(eventId);
        const hasAccess = eventRoleIds.some((rid: string) => userRoleIds.includes(rid));
        if (!hasAccess) {
          if (!hasPermission(perms.server, ServerPermissions.MANAGE_EVENTS)) {
            return notFound(reply, 'Event');
          }
        }
      }

      await db.serverEvents.upsertRSVP(eventId, request.user!.id, body.status);
      const counts = await db.serverEvents.getRSVPCounts(eventId);

      return {
        my_status: body.status,
        counts: {
          interested: counts.interested,
          tentative: counts.tentative,
          not_interested: counts.not_interested,
        },
      };
    },
  });
};
