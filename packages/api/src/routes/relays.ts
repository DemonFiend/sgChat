/**
 * Relay Server Routes
 *
 * Admin endpoints: CRUD + pairing token generation
 * Public endpoints: List trusted relays
 * Internal endpoints: Pairing, heartbeat, voice-authorize, voice-event
 */
import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { calculatePermissions } from '../services/permissions.js';
import { ServerPermissions, VoicePermissions, hasPermission } from '@sgchat/shared';
import type { RelayCreateRequest, RelayUpdateRequest, RelayPairRequest } from '@sgchat/shared';
import { forbidden, notFound, badRequest, sendError } from '../utils/errors.js';
import { redis } from '../lib/redis.js';
import { z } from 'zod';
import {
  generateECDHKeyPair,
  deriveSharedSecret,
  generatePairingToken,
  hashPairingToken,
  verifyHmacSignature,
  encryptWithKey,
  decryptWithKey,
  generateTrustCertificate,
} from '../lib/relayCrypto.js';
import { getMasterEncryptionKey, generateLiveKitTokenForRelay } from '../services/livekit.js';

// ── Validation schemas ──────────────────────────────────────

const createRelaySchema = z.object({
  name: z.string().min(1).max(100),
  region: z.string().min(1).max(50),
  max_participants: z.number().int().min(1).max(10000).optional(),
  allow_master_fallback: z.boolean().optional(),
});

const updateRelaySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  region: z.string().min(1).max(50).optional(),
  max_participants: z.number().int().min(1).max(10000).optional(),
  allow_master_fallback: z.boolean().optional(),
});

const pairSchema = z.object({
  pairing_token: z.string(),
  relay_public_key: z.string(),
  livekit_url: z.string().url(),
  livekit_api_key: z.string().min(1),
  livekit_api_secret: z.string().min(1),
  health_url: z.string().url(),
});

const heartbeatSchema = z.object({
  relay_id: z.string().uuid(),
  current_participants: z.number().int().min(0),
  active_rooms: z.array(z.string()),
  health: z.object({
    status: z.enum(['healthy', 'degraded', 'unreachable']),
    cpu_usage_percent: z.number(),
    memory_usage_percent: z.number(),
    uptime_seconds: z.number(),
  }),
});

const voiceEventSchema = z.object({
  type: z.string(),
  user_id: z.string().uuid(),
  channel_id: z.string().uuid(),
  data: z.record(z.unknown()).optional(),
});

// ── Helper: check admin permission ──────────────────────────

async function requireAdmin(
  userId: string,
  reply: any,
): Promise<boolean> {
  // Get the default server
  const [server] = await db.sql`SELECT id, owner_id FROM servers ORDER BY created_at ASC LIMIT 1`;
  if (!server) {
    forbidden(reply, 'No server found');
    return false;
  }

  if (server.owner_id === userId) return true;

  const perms = await calculatePermissions(userId, server.id);
  if (hasPermission(perms.server, ServerPermissions.ADMINISTRATOR)) return true;

  forbidden(reply);
  return false;
}

// ── Helper: authenticate relay by HMAC signature ────────────

async function authenticateRelay(
  request: any,
  reply: any,
): Promise<{ relayId: string; sharedSecret: string } | null> {
  const relayId = request.headers['x-relay-id'] as string;
  const timestamp = request.headers['x-relay-timestamp'] as string;
  const signature = request.headers['x-relay-signature'] as string;

  if (!relayId || !timestamp || !signature) {
    sendError(reply, 401, 'Missing relay authentication headers');
    return null;
  }

  // Check timestamp freshness (5 minute window)
  const now = Date.now();
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(now - ts) > 5 * 60 * 1000) {
    sendError(reply, 401, 'Relay timestamp expired or invalid');
    return null;
  }

  const relay = await db.relays.findById(relayId);
  if (!relay || relay.status !== 'trusted') {
    sendError(reply, 401, 'Relay not found or not trusted');
    return null;
  }

  if (!relay.shared_secret_encrypted) {
    sendError(reply, 401, 'Relay has no shared secret');
    return null;
  }

  // Decrypt shared secret
  const sharedSecret = await decryptWithKey(
    relay.shared_secret_encrypted,
    getMasterEncryptionKey(),
  );

  // Reconstruct and verify signature
  const method = request.method;
  const path = request.url.split('?')[0];
  const body = request.body ? JSON.stringify(request.body) : '';
  const signatureInput = `${method}:${path}:${timestamp}:${body}`;

  if (!verifyHmacSignature(signatureInput, signature, sharedSecret)) {
    sendError(reply, 401, 'Invalid relay signature');
    return null;
  }

  return { relayId, sharedSecret };
}

// ── Routes ──────────────────────────────────────────────────

export const relayRoutes: FastifyPluginAsync = async (fastify) => {
  // ════════════════════════════════════════════════════════════
  // PUBLIC: List trusted relays
  // ════════════════════════════════════════════════════════════

  fastify.get('/relays', { preHandler: [authenticate] }, async (_request, _reply) => {
    const relays = await db.relays.findTrusted();
    return relays.map((r: any) => ({
      id: r.id,
      name: r.name,
      region: r.region,
      status: r.status,
      health_url: r.health_url,
      livekit_url: r.livekit_url,
      max_participants: r.max_participants,
      current_participants: r.current_participants,
      last_health_status: r.last_health_status,
    }));
  });

  // ════════════════════════════════════════════════════════════
  // PUBLIC: Client ping report
  // ════════════════════════════════════════════════════════════

  fastify.post('/relays/ping-report', { preHandler: [authenticate] }, async (request, _reply) => {
    const schema = z.object({
      pings: z.array(z.object({
        relayId: z.string().uuid(),
        latencyMs: z.number().int().min(0).max(30000),
      })),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return { ok: true }; // Silently ignore bad data

    const userId = request.user.id;
    const pipeline = redis.client.pipeline();
    for (const ping of parsed.data.pings) {
      pipeline.setex(`relay:ping:${userId}:${ping.relayId}`, 600, String(ping.latencyMs));
    }
    await pipeline.exec();

    return { ok: true };
  });

  // ════════════════════════════════════════════════════════════
  // ADMIN: Relay CRUD + pairing
  // ════════════════════════════════════════════════════════════

  // Create relay + generate pairing token
  fastify.post('/admin/relays', { preHandler: [authenticate] }, async (request, reply) => {
    if (!(await requireAdmin(request.user.id, reply))) return;

    const parsed = createRelaySchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.message);

    const data = parsed.data as RelayCreateRequest;

    // Generate ECDH key pair for this relay pairing
    const { publicKey: masterPublicKey, privateKeyJwk: masterPrivateKey } =
      await generateECDHKeyPair();

    // Create relay record
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    // Derive master URL from the request origin (the browser knows the correct public URL)
    const origin = request.headers.origin || request.headers.referer;
    const MASTER_URL = origin
      ? new URL(origin).origin
      : process.env.PUBLIC_URL ||
        process.env.API_URL ||
        `${request.protocol}://${request.hostname}`;
    const encryptionKey = getMasterEncryptionKey();
    const encryptedPrivateKey = await encryptWithKey(masterPrivateKey, encryptionKey);

    // Atomic create + token hash update in a single transaction
    const result = await db.transaction(async (tx: any) => {
      const [created] = await tx`
        INSERT INTO relay_servers (
          name, region, status, pairing_token_hash, pairing_expires_at,
          master_public_key, max_participants, allow_master_fallback
        )
        VALUES (
          ${data.name}, ${data.region}, 'pending', 'pending',
          ${expiresAt}, ${masterPublicKey},
          ${data.max_participants ?? 200}, ${data.allow_master_fallback ?? true}
        )
        RETURNING *
      `;

      const { token: pairingToken, hash } = generatePairingToken({
        relay_id: created.id,
        name: data.name,
        region: data.region,
        master_url: MASTER_URL,
        master_public_key: masterPublicKey,
        expires_at: expiresAt.toISOString(),
      });

      const [updated] = await tx`
        UPDATE relay_servers SET
          pairing_token_hash = ${hash},
          shared_secret_encrypted = ${encryptedPrivateKey},
          updated_at = NOW()
        WHERE id = ${created.id}
        RETURNING *
      `;

      return { relay: updated, pairingToken };
    });

    return reply.status(201).send({
      relay: { ...result.relay, pairing_token_hash: undefined },
      pairing_token: result.pairingToken,
    });
  });

  // List all relays (admin view)
  fastify.get('/admin/relays', { preHandler: [authenticate] }, async (request, reply) => {
    if (!(await requireAdmin(request.user.id, reply))) return;
    return db.relays.findAll();
  });

  // Get relay details
  fastify.get('/admin/relays/:id', { preHandler: [authenticate] }, async (request, reply) => {
    if (!(await requireAdmin(request.user.id, reply))) return;
    const { id } = request.params as { id: string };
    const relay = await db.relays.findById(id);
    if (!relay) return notFound(reply, 'Relay');
    return relay;
  });

  // Update relay config
  fastify.patch('/admin/relays/:id', { preHandler: [authenticate] }, async (request, reply) => {
    if (!(await requireAdmin(request.user.id, reply))) return;
    const { id } = request.params as { id: string };

    const parsed = updateRelaySchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.message);

    const relay = await db.relays.findById(id);
    if (!relay) return notFound(reply, 'Relay');

    const data = parsed.data as RelayUpdateRequest;
    const updated = await db.relays.update(id, data);
    return updated;
  });

  // Regenerate pairing token
  fastify.post(
    '/admin/relays/:id/regenerate',
    { preHandler: [authenticate] },
    async (request, reply) => {
      if (!(await requireAdmin(request.user.id, reply))) return;
      const { id } = request.params as { id: string };

      const relay = await db.relays.findById(id);
      if (!relay) return notFound(reply, 'Relay');
      if (relay.status === 'trusted') {
        return badRequest(reply, 'Cannot regenerate token for a trusted relay. Revoke trust first.');
      }

      const { publicKey: masterPublicKey, privateKeyJwk: masterPrivateKey } =
        await generateECDHKeyPair();

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const origin = request.headers.origin || request.headers.referer;
      const MASTER_URL = origin
        ? new URL(origin).origin
        : process.env.PUBLIC_URL ||
          process.env.API_URL ||
          `${request.protocol}://${request.hostname}`;

      const { token, hash } = generatePairingToken({
        relay_id: id,
        name: relay.name,
        region: relay.region,
        master_url: MASTER_URL,
        master_public_key: masterPublicKey,
        expires_at: expiresAt.toISOString(),
      });

      const encryptionKey = getMasterEncryptionKey();
      const encryptedPrivateKey = await encryptWithKey(masterPrivateKey, encryptionKey);

      await db.relays.update(id, {
        pairing_token_hash: hash,
        pairing_expires_at: expiresAt,
        master_public_key: masterPublicKey,
        shared_secret_encrypted: encryptedPrivateKey,
        status: 'pending',
      });

      return { pairing_token: token };
    },
  );

  // Suspend relay
  fastify.post(
    '/admin/relays/:id/suspend',
    { preHandler: [authenticate] },
    async (request, reply) => {
      if (!(await requireAdmin(request.user.id, reply))) return;
      const { id } = request.params as { id: string };

      const relay = await db.relays.findById(id);
      if (!relay) return notFound(reply, 'Relay');

      await db.relays.update(id, { status: 'suspended' });
      return { success: true };
    },
  );

  // Drain relay (graceful — no new joins, transitions to offline when empty)
  fastify.post(
    '/admin/relays/:id/drain',
    { preHandler: [authenticate] },
    async (request, reply) => {
      if (!(await requireAdmin(request.user.id, reply))) return;
      const { id } = request.params as { id: string };

      const relay = await db.relays.findById(id);
      if (!relay) return notFound(reply, 'Relay');
      if (relay.status !== 'trusted') {
        return badRequest(reply, 'Only trusted relays can be drained');
      }

      await db.relays.update(id, { status: 'draining' });

      // Clear active_relay_id on channels anchored to this relay so new joins go elsewhere
      await db.sql`UPDATE channels SET active_relay_id = NULL WHERE active_relay_id = ${id}`;

      return { success: true, message: 'Relay is draining — no new voice joins will be routed to it' };
    },
  );

  // Delete relay
  fastify.delete('/admin/relays/:id', { preHandler: [authenticate] }, async (request, reply) => {
    if (!(await requireAdmin(request.user.id, reply))) return;
    const { id } = request.params as { id: string };

    const relay = await db.relays.findById(id);
    if (!relay) return notFound(reply, 'Relay');

    // Clear any channel references to this relay
    await db.sql`UPDATE channels SET preferred_relay_id = NULL WHERE preferred_relay_id = ${id}`;
    await db.sql`UPDATE channels SET active_relay_id = NULL WHERE active_relay_id = ${id}`;

    await db.relays.delete(id);
    return { success: true };
  });

  // ════════════════════════════════════════════════════════════
  // INTERNAL: Relay → Master endpoints
  // ════════════════════════════════════════════════════════════

  // Complete relay pairing
  fastify.post('/internal/relay/pair', async (request, reply) => {
    const parsed = pairSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.message);

    const data = parsed.data as RelayPairRequest;

    // Hash the provided token and find the relay
    const tokenHash = hashPairingToken(data.pairing_token);
    const relays = await db.sql`
      SELECT * FROM relay_servers
      WHERE pairing_token_hash = ${tokenHash}
        AND status = 'pending'
    `;

    if (relays.length === 0) {
      return sendError(reply, 401, 'Invalid or expired pairing token');
    }

    const relay = relays[0];

    // Check expiry
    if (relay.pairing_expires_at && new Date(relay.pairing_expires_at) < new Date()) {
      return sendError(reply, 401, 'Pairing token has expired');
    }

    // Decrypt Master's private key for this relay (stored temporarily during creation)
    if (!relay.shared_secret_encrypted) {
      return sendError(reply, 500, 'Relay record is missing encrypted key data — try regenerating the pairing token');
    }
    const encryptionKey = getMasterEncryptionKey();
    const masterPrivateKey = await decryptWithKey(relay.shared_secret_encrypted, encryptionKey);

    // Derive shared secret using ECDH
    const sharedSecret = await deriveSharedSecret(masterPrivateKey, data.relay_public_key);

    // Encrypt relay's LiveKit credentials for storage
    const encryptedApiKey = await encryptWithKey(data.livekit_api_key, encryptionKey);
    const encryptedApiSecret = await encryptWithKey(data.livekit_api_secret, encryptionKey);
    const encryptedSharedSecret = await encryptWithKey(sharedSecret, encryptionKey);

    // Generate trust certificate
    const certificate = generateTrustCertificate(
      {
        relay_id: relay.id,
        name: relay.name,
        region: relay.region,
        issued_at: new Date().toISOString(),
        relay_public_key: data.relay_public_key,
      },
      sharedSecret,
    );

    // Complete pairing
    await db.relays.completePairing(relay.id, {
      relay_public_key: data.relay_public_key,
      shared_secret_encrypted: encryptedSharedSecret,
      trust_certificate: certificate,
      health_url: data.health_url,
      livekit_url: data.livekit_url,
      livekit_api_key_encrypted: encryptedApiKey,
      livekit_api_secret_encrypted: encryptedApiSecret,
    });

    return {
      relay_id: relay.id,
      trust_certificate: certificate,
      shared_secret_confirmation: sharedSecret.slice(0, 8),
    };
  });

  // Relay heartbeat
  fastify.post('/internal/relay/heartbeat', async (request, reply) => {
    const auth = await authenticateRelay(request, reply);
    if (!auth) return;

    const parsed = heartbeatSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.message);

    const data = parsed.data;
    if (data.relay_id !== auth.relayId) {
      return sendError(reply, 403, 'Relay ID mismatch');
    }

    await db.relays.updateHeartbeat(auth.relayId, {
      current_participants: data.current_participants,
      last_health_status: data.health.status,
    });

    return { ok: true };
  });

  // Voice authorize (relay asks Master to check permissions and generate token)
  fastify.post('/internal/relay/voice-authorize', async (request, reply) => {
    const auth = await authenticateRelay(request, reply);
    if (!auth) return;

    const { user_id, channel_id } = request.body as { user_id: string; channel_id: string };
    if (!user_id || !channel_id) {
      return badRequest(reply, 'user_id and channel_id required');
    }

    // Check channel exists and has this relay assigned
    const [channel] = await db.sql`SELECT * FROM channels WHERE id = ${channel_id}`;
    if (!channel) return notFound(reply, 'Channel');

    if (channel.active_relay_id !== auth.relayId && channel.preferred_relay_id !== auth.relayId) {
      return sendError(reply, 403, 'Channel not assigned to this relay');
    }

    // Check user permissions
    const perms = await calculatePermissions(user_id, channel.server_id, channel_id);
    if (!hasPermission(perms.voice, VoicePermissions.CONNECT)) {
      return sendError(reply, 403, 'User cannot connect to this voice channel');
    }

    const canSpeak = hasPermission(perms.voice, VoicePermissions.SPEAK);
    const roomName = `voice_${channel_id}`;

    // Generate token using relay's LiveKit credentials
    const token = await generateLiveKitTokenForRelay(auth.relayId, {
      identity: user_id,
      room: roomName,
      canPublish: canSpeak,
    });

    const relay = await db.relays.findById(auth.relayId);
    return { token, url: relay?.livekit_url || '' };
  });

  // Voice cache — relay fetches permission snapshots for offline authorization
  fastify.get('/internal/relay/voice-cache', async (request, reply) => {
    const auth = await authenticateRelay(request, reply);
    if (!auth) return;

    // Get voice channels that use this relay (active or preferred)
    const channels = await db.sql`
      SELECT c.id, c.name, c.server_id, c.type, c.voice_relay_policy,
             c.preferred_relay_id, c.active_relay_id, c.bitrate, c.user_limit
      FROM channels c
      WHERE c.type IN ('voice', 'music', 'temp_voice')
        AND (c.active_relay_id = ${auth.relayId} OR c.preferred_relay_id = ${auth.relayId})
    `;

    if (channels.length === 0) {
      return { channels: [], permission_snapshots: [], users: [] };
    }

    const channelIds = channels.map((c: any) => c.id);
    const serverIds = [...new Set(channels.map((c: any) => c.server_id))];

    // Get members of the servers that have these channels (limit per server to prevent DoS)
    const MAX_MEMBERS_PER_SERVER = 500;
    const members = await db.sql`
      SELECT DISTINCT ON (m.user_id, m.server_id) m.user_id, m.server_id
      FROM members m
      WHERE m.server_id = ANY(${serverIds})
      ORDER BY m.user_id, m.server_id
      LIMIT ${serverIds.length * MAX_MEMBERS_PER_SERVER}
    `;

    const userIds = [...new Set(members.map((m: any) => m.user_id))];

    // Calculate permissions for each user×channel pair
    const permissionSnapshots: Array<{
      user_id: string;
      channel_id: string;
      can_connect: boolean;
      can_speak: boolean;
    }> = [];

    for (const channelId of channelIds) {
      const channel = channels.find((c: any) => c.id === channelId);
      if (!channel) continue;

      // Get members of this channel's server
      const serverMembers = members
        .filter((m: any) => m.server_id === channel.server_id)
        .map((m: any) => m.user_id);

      for (const userId of serverMembers) {
        try {
          const perms = await calculatePermissions(userId, channel.server_id, channelId);
          permissionSnapshots.push({
            user_id: userId,
            channel_id: channelId,
            can_connect: hasPermission(perms.voice, VoicePermissions.CONNECT),
            can_speak: hasPermission(perms.voice, VoicePermissions.SPEAK),
          });
        } catch {
          // Skip users with permission calculation errors
        }
      }
    }

    // Get user info for cached users
    const users = userIds.length > 0
      ? await db.sql`
          SELECT id, username, display_name, avatar_url
          FROM users WHERE id = ANY(${userIds})
        `
      : [];

    return { channels, permission_snapshots: permissionSnapshots, users };
  });

  // Voice event forwarding (relay → Master for broadcast)
  fastify.post('/internal/relay/voice-event', async (request, reply) => {
    const auth = await authenticateRelay(request, reply);
    if (!auth) return;

    const parsed = voiceEventSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.message);

    // TODO: Forward to event bus for broadcast
    // For now, acknowledge receipt
    return { ok: true };
  });
};
