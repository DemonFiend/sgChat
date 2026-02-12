/**
 * A0: Event Bus — Redis Pub/Sub + Streams for real-time event delivery
 *
 * Responsibilities:
 *  1. Per-resource monotonic sequence counters  (Redis INCR)
 *  2. Durable event log per resource            (Redis Streams — XADD)
 *  3. Pub/Sub fan-out for connected gateways    (Redis Pub/Sub)
 *  4. Resync: replay missed events from stream  (XRANGE)
 *
 * Topic scheme:
 *   channel:{id}  — channel events (messages, typing, etc.)
 *   dm:{id}       — DM events
 *   user:{id}     — per-user events (notifications, friend requests, presence)
 *   server:{id}   — server-wide broadcasts (member join/leave, role updates)
 */

import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import type { EventEnvelope, EventType } from '@sgchat/shared';

// ── Redis clients ──────────────────────────────────────────────
// We need separate connections for pub and sub (ioredis requirement).
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let pubClient: Redis;
let subClient: Redis;

// Listeners registered by the gateway (Socket.IO / SSE)
type EnvelopeListener = (envelope: EventEnvelope) => void;
const listeners = new Set<EnvelopeListener>();

// ── Stream / sequence config ───────────────────────────────────
/** Max events kept per resource stream (trimmed with MAXLEN ~) */
const STREAM_MAX_LEN = 1000;
/** Prefix for sequence counters */
const SEQ_PREFIX = 'seq:';
/** Prefix for event streams */
const STREAM_PREFIX = 'stream:';
/** Pub/Sub channel for fan-out */
const PUBSUB_CHANNEL = 'sgchat:events';

// ── Initialise ─────────────────────────────────────────────────

export async function initEventBus() {
  pubClient = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      return Math.min(times * 50, 2000);
    },
    lazyConnect: true,
  });

  subClient = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      return Math.min(times * 50, 2000);
    },
    lazyConnect: true,
  });

  await pubClient.connect();
  await subClient.connect();

  // Subscribe to the fan-out channel and forward to local listeners
  await subClient.subscribe(PUBSUB_CHANNEL);
  subClient.on('message', (_channel: string, message: string) => {
    try {
      const envelope: EventEnvelope = JSON.parse(message);
      for (const fn of listeners) {
        fn(envelope);
      }
    } catch {
      // Malformed message — skip
    }
  });

  console.log('✅ Event bus initialised (Pub/Sub + Streams)');
}

// ── Publish ────────────────────────────────────────────────────

export interface PublishOptions {
  type: EventType;
  actorId: string | null;
  resourceId: string;
  payload: unknown;
  traceId?: string;
}

/**
 * Publish an event through the bus.
 *
 * 1. Atomically increments the per-resource sequence counter.
 * 2. Builds the event envelope.
 * 3. Appends to the durable Redis Stream (capped at STREAM_MAX_LEN).
 * 4. Fan-out via Redis Pub/Sub so all gateway processes receive it.
 *
 * Returns the constructed envelope (useful for SSE / in-process delivery).
 */
export async function publishEvent(opts: PublishOptions): Promise<EventEnvelope> {
  const { type, actorId, resourceId, payload, traceId } = opts;

  // 1. Sequence
  const sequence = await pubClient.incr(`${SEQ_PREFIX}${resourceId}`);

  // 2. Build envelope
  const envelope: EventEnvelope = {
    id: randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    actor_id: actorId,
    resource_id: resourceId,
    sequence,
    payload,
    trace_id: traceId,
  };

  const json = JSON.stringify(envelope);

  // 3. Durable stream (XADD with approximate trimming)
  await pubClient.xadd(
    `${STREAM_PREFIX}${resourceId}`,
    'MAXLEN',
    '~',
    String(STREAM_MAX_LEN),
    '*', // auto-id
    'envelope',
    json,
  );

  // 4. Pub/Sub fan-out
  await pubClient.publish(PUBSUB_CHANNEL, json);

  return envelope;
}

// ── Resync ─────────────────────────────────────────────────────

export interface ResyncOptions {
  resourceId: string;
  /** Client's last-seen sequence number */
  afterSequence: number;
  limit?: number;
}

/**
 * Replay events from the durable stream that the client missed.
 *
 * We scan the stream for the resource and filter by `sequence > afterSequence`.
 * Redis Streams don't natively index by custom fields, so we read up to
 * `limit * 2` entries and filter in-app (the stream is capped at STREAM_MAX_LEN
 * so this is bounded).
 */
export async function resyncEvents(opts: ResyncOptions): Promise<{
  events: EventEnvelope[];
  hasMore: boolean;
}> {
  const { resourceId, afterSequence, limit = 50 } = opts;
  const streamKey = `${STREAM_PREFIX}${resourceId}`;

  // Read from the beginning of the stream — we'll filter by sequence
  const raw = await pubClient.xrange(streamKey, '-', '+', 'COUNT', String(limit * 2));

  const events: EventEnvelope[] = [];
  for (const [, fields] of raw) {
    // fields is ['envelope', '<json>']
    const json = fields[1];
    if (!json) continue;
    try {
      const env: EventEnvelope = JSON.parse(json);
      if (env.sequence > afterSequence) {
        events.push(env);
        if (events.length >= limit) break;
      }
    } catch {
      // skip malformed
    }
  }

  return {
    events,
    hasMore: events.length >= limit,
  };
}

// ── Get current sequence ───────────────────────────────────────

/**
 * Returns the current sequence number for a resource (0 if none yet).
 */
export async function getSequence(resourceId: string): Promise<number> {
  const val = await pubClient.get(`${SEQ_PREFIX}${resourceId}`);
  return val ? parseInt(val, 10) : 0;
}

/**
 * Batch-fetch current sequences for multiple resources.
 * Useful for the READY payload.
 */
export async function getSequences(resourceIds: string[]): Promise<Record<string, number>> {
  if (resourceIds.length === 0) return {};

  const keys = resourceIds.map((id) => `${SEQ_PREFIX}${id}`);
  const values = await pubClient.mget(...keys);

  const result: Record<string, number> = {};
  for (let i = 0; i < resourceIds.length; i++) {
    result[resourceIds[i]] = values[i] ? parseInt(values[i]!, 10) : 0;
  }
  return result;
}

// ── Listener management ────────────────────────────────────────

/**
 * Register a listener that receives ALL events from Pub/Sub.
 * The gateway (Socket.IO / SSE) filters by room membership.
 */
export function onEvent(fn: EnvelopeListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ── Shutdown ───────────────────────────────────────────────────

export async function shutdownEventBus() {
  listeners.clear();
  await subClient.unsubscribe(PUBSUB_CHANNEL);
  await subClient.quit();
  await pubClient.quit();
}
