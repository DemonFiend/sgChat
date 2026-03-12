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
import { ServerPermissions, hasPermission } from '@sgchat/shared';
import type { RelayCreateRequest, RelayUpdateRequest, RelayPairRequest } from '@sgchat/shared';
import { forbidden, notFound, badRequest, sendError } from '../utils/errors.js';
import { z } from 'zod';
import {
  generateECDHKeyPair,
  deriveSharedSecret,
  generatePairingToken,
  hashPairingToken,
  verifyHmacSignature,
  encryptWithKey,
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
  const { decryptWithKey } = await import('../lib/relayCrypto.js');
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

    // Generate pairing token (needs relay_id, so we create a placeholder)
    const MASTER_URL = process.env.PUBLIC_URL || process.env.API_URL || 'http://localhost:3000';

    // Create relay in DB first to get ID
    const relay = await db.relays.create({
      name: data.name,
      region: data.region,
      pairing_token_hash: 'pending', // will update after generating token
      pairing_expires_at: expiresAt,
      master_public_key: masterPublicKey,
      max_participants: data.max_participants,
      allow_master_fallback: data.allow_master_fallback,
    });

    // Generate pairing token with relay ID
    const { token, hash } = generatePairingToken({
      relay_id: relay.id,
      name: data.name,
      region: data.region,
      master_url: MASTER_URL,
      master_public_key: masterPublicKey,
      expires_at: expiresAt.toISOString(),
    });

    // Update relay with actual token hash and store master private key (encrypted)
    const encryptionKey = getMasterEncryptionKey();
    const encryptedPrivateKey = await encryptWithKey(masterPrivateKey, encryptionKey);

    await db.relays.update(relay.id, {
      pairing_token_hash: hash,
      // Store master's private key temporarily for pairing completion
      // Using shared_secret_encrypted field temporarily (will be replaced during pairing)
      shared_secret_encrypted: encryptedPrivateKey,
    });

    return reply.status(201).send({
      relay: { ...relay, pairing_token_hash: undefined },
      pairing_token: token,
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
      const MASTER_URL = process.env.PUBLIC_URL || process.env.API_URL || 'http://localhost:3000';

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
    const encryptionKey = getMasterEncryptionKey();
    const { decryptWithKey: decrypt } = await import('../lib/relayCrypto.js');
    const masterPrivateKey = await decrypt(relay.shared_secret_encrypted, encryptionKey);

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
    const { VoicePermissions } = await import('@sgchat/shared');
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
