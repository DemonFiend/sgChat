/**
 * A0: Gateway REST routes
 *
 *  GET  /events/stream   — SSE fallback (WebSocket → SSE → short-poll hierarchy)
 *  GET  /events/resync   — Gap recovery for missed events
 *  GET  /events/sequence  — Current sequence for a resource
 */

import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { onEvent, resyncEvents, getSequence, getSequences } from '../lib/eventBus.js';
import type { EventEnvelope } from '@sgchat/shared';

export const gatewayRoutes: FastifyPluginAsync = async (fastify) => {

  // ────────────────────────────────────────────────────────────
  // SSE Fallback — GET /events/stream
  // ────────────────────────────────────────────────────────────
  fastify.get('/events/stream', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const userId = request.user.id;

    // Build the set of resource IDs this user should receive events for
    const subscriptions = await buildSubscriptions(userId);
    const subSet = new Set(subscriptions);

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Send initial comment to establish connection
    reply.raw.write(':ok\n\n');

    // Heartbeat every 30 seconds to keep connection alive
    const heartbeatTimer = setInterval(() => {
      try {
        reply.raw.write(':heartbeat\n\n');
      } catch {
        // Connection closed
        cleanup();
      }
    }, 30_000);

    // Subscribe to events from the event bus
    const unsubscribe = onEvent((envelope: EventEnvelope) => {
      // Filter: only forward events targeting resources this user subscribes to
      if (!subSet.has(envelope.resource_id) && envelope.resource_id !== `user:${userId}`) {
        return;
      }

      try {
        const data = JSON.stringify(envelope);
        reply.raw.write(`id: ${envelope.id}\n`);
        reply.raw.write(`event: ${envelope.type}\n`);
        reply.raw.write(`data: ${data}\n\n`);
      } catch {
        // Connection closed
        cleanup();
      }
    });

    function cleanup() {
      clearInterval(heartbeatTimer);
      unsubscribe();
    }

    // Clean up when client disconnects
    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);

    // Don't let Fastify auto-close the response
    return reply.hijack();
  });

  // ────────────────────────────────────────────────────────────
  // Resync — GET /events/resync
  // ────────────────────────────────────────────────────────────
  fastify.get<{
    Querystring: {
      resource_id: string;
      last_sequence: string;
      limit?: string;
    };
  }>('/events/resync', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { resource_id, last_sequence, limit } = request.query;

    if (!resource_id || last_sequence === undefined) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'resource_id and last_sequence are required',
      });
    }

    const afterSequence = parseInt(last_sequence, 10);
    if (isNaN(afterSequence) || afterSequence < 0) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'last_sequence must be a non-negative integer',
      });
    }

    // TODO: A13 — verify the user has permission to read this resource

    const result = await resyncEvents({
      resourceId: resource_id,
      afterSequence,
      limit: limit ? Math.min(parseInt(limit, 10) || 50, 200) : 50,
    });

    return reply.send({
      resource_id,
      events: result.events,
      has_more: result.hasMore,
    });
  });

  // ────────────────────────────────────────────────────────────
  // Sequence — GET /events/sequence
  // ────────────────────────────────────────────────────────────
  fastify.get<{
    Querystring: {
      resource_id?: string;
      resource_ids?: string;
    };
  }>('/events/sequence', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { resource_id, resource_ids } = request.query;

    if (resource_ids) {
      // Batch mode: comma-separated IDs
      const ids = resource_ids.split(',').map((s) => s.trim()).filter(Boolean);
      const sequences = await getSequences(ids);
      return reply.send({ sequences });
    }

    if (resource_id) {
      const sequence = await getSequence(resource_id);
      return reply.send({ resource_id, sequence });
    }

    return reply.status(400).send({
      statusCode: 400,
      error: 'Bad Request',
      message: 'resource_id or resource_ids is required',
    });
  });
};

// ── Helpers ────────────────────────────────────────────────────

/**
 * Build the list of resource IDs a user should subscribe to.
 * Mirrors the room-join logic in the Socket.IO gateway.
 */
async function buildSubscriptions(userId: string): Promise<string[]> {
  const subs: string[] = [`user:${userId}`];

  // Server rooms + channel rooms
  const servers = await db.servers.findByUserId(userId);
  for (const server of servers) {
    subs.push(`server:${server.id}`);
    const channels = await db.channels.findByServerId(server.id);
    for (const channel of channels) {
      subs.push(`channel:${channel.id}`);
    }
  }

  // DM rooms
  const dmChannels = await db.dmChannels.findByUserId(userId);
  for (const dm of dmChannels) {
    subs.push(`dm:${dm.id}`);
  }

  return subs;
}
