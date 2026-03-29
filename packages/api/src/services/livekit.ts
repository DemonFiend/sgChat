import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { decryptWithKey } from '../lib/relayCrypto.js';

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://localhost:7880';
// LIVEKIT_PUBLIC_URL is the browser-accessible URL (may differ from internal Docker URL)
const LIVEKIT_PUBLIC_URL = process.env.LIVEKIT_PUBLIC_URL || LIVEKIT_URL;

// Master encryption key for relay credential storage (derived from JWT_SECRET)
const MASTER_ENCRYPTION_KEY = process.env.JWT_SECRET
  ? Buffer.from(process.env.JWT_SECRET).toString('hex').slice(0, 64).padEnd(64, '0')
  : '0'.repeat(64);

export interface LiveKitTokenOptions {
  identity: string;
  name?: string;
  room: string;
  canPublish?: boolean;
  canPublishVideo?: boolean;
  canPublishScreen?: boolean;
  canSubscribe?: boolean;
}

/**
 * Generate a LiveKit access token for voice/video channels (Master's own LiveKit)
 *
 * Permissions:
 * - canPublish: Can transmit audio (SPEAK permission)
 * - canPublishVideo: Can transmit camera video (VIDEO permission)
 * - canPublishScreen: Can share screen (STREAM permission)
 * - canSubscribe: Can receive audio/video from others (always true)
 */
export async function generateLiveKitToken(options: LiveKitTokenOptions): Promise<string> {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: options.identity,
    name: options.name,
  });

  at.addGrant({
    room: options.room,
    roomJoin: true,
    canPublish: options.canPublish ?? true,
    canPublishData: true,
    canSubscribe: options.canSubscribe ?? true,
  });

  return await at.toJwt();
}

/**
 * Generate a LiveKit access token for a relay's LiveKit instance.
 * Decrypts the relay's stored LiveKit credentials and generates a token.
 */
export async function generateLiveKitTokenForRelay(
  relayId: string,
  options: LiveKitTokenOptions,
): Promise<string> {
  const relay = await db.relays.findById(relayId);
  if (!relay || relay.status !== 'trusted') {
    throw new Error(`Relay ${relayId} not found or not trusted`);
  }

  if (!relay.livekit_api_key_encrypted || !relay.livekit_api_secret_encrypted) {
    throw new Error(`Relay ${relayId} has no LiveKit credentials`);
  }

  const apiKey = await decryptWithKey(relay.livekit_api_key_encrypted, MASTER_ENCRYPTION_KEY);
  const apiSecret = await decryptWithKey(relay.livekit_api_secret_encrypted, MASTER_ENCRYPTION_KEY);

  const at = new AccessToken(apiKey, apiSecret, {
    identity: options.identity,
    name: options.name,
  });

  at.addGrant({
    room: options.room,
    roomJoin: true,
    canPublish: options.canPublish ?? true,
    canPublishData: true,
    canSubscribe: options.canSubscribe ?? true,
  });

  return await at.toJwt();
}

/**
 * Get LiveKit server URL (public-facing for browser access)
 */
export function getLiveKitUrl(): string {
  return LIVEKIT_PUBLIC_URL;
}

/**
 * Get the LiveKit URL for a specific relay server.
 * Returns a proxied WSS URL through Master's SSL when APP_URL is set,
 * so browsers on HTTPS pages can connect without mixed-content errors.
 * Falls back to direct relay URL for non-HTTPS / LAN setups.
 */
export async function getRelayLiveKitUrl(relayId: string): Promise<string> {
  const publicUrl = process.env.APP_URL || '';
  if (publicUrl) {
    // Proxy through Master: https://chat.example.com → wss://chat.example.com/relay-ws/<id>
    const base = publicUrl.replace(/^http/, 'ws');
    return `${base}/relay-ws/${relayId}`;
  }
  // Fallback: direct URL (works for non-HTTPS setups / LAN)
  const relay = await db.relays.findById(relayId);
  if (!relay || !relay.livekit_url) {
    throw new Error(`Relay ${relayId} has no LiveKit URL`);
  }
  return relay.livekit_url;
}

/**
 * Get the Master encryption key (for encrypting relay credentials).
 */
export function getMasterEncryptionKey(): string {
  return MASTER_ENCRYPTION_KEY;
}

/**
 * Reconcile LiveKit room state with Redis after server restart.
 *
 * When the API server restarts, Redis voice state is wiped (clearAllPresence).
 * But LiveKit clients may still be connected to rooms. This function queries
 * LiveKit for active rooms/participants and rebuilds the Redis voice state.
 */
export async function reconcileLiveKitVoiceState(): Promise<void> {
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    console.log('⏭️  LiveKit not configured, skipping voice state reconciliation');
    return;
  }

  const httpUrl = LIVEKIT_URL.replace(/^ws(s?):\/\//, 'http$1://');

  try {
    const roomService = new RoomServiceClient(httpUrl, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    const rooms = await roomService.listRooms();

    let totalReconciled = 0;

    for (const room of rooms) {
      // Only process sgChat voice rooms (format: "voice:{channelId}")
      const match = room.name.match(/^voice:(.+)$/);
      if (!match) continue;

      const channelId = match[1];

      // Verify channel still exists in database
      const channel = await db.channels.findById(channelId);
      if (!channel) continue;

      // List participants in this LiveKit room
      const participants = await roomService.listParticipants(room.name);

      for (const participant of participants) {
        const userId = participant.identity;
        if (!userId) continue;

        // Verify user exists
        const user = await db.users.findById(userId);
        if (!user) continue;

        // Rebuild Redis voice state
        await redis.client.sadd(`voice:channel:${channelId}`, userId);
        await redis.client.set(`voice:user:${userId}`, channelId);
        await redis.client.hset(`voice:state:${channelId}:${userId}`, {
          joined_at: participant.joinedAt
            ? new Date(Number(participant.joinedAt) * 1000).toISOString()
            : new Date().toISOString(),
          is_muted: 'false',
          is_deafened: 'false',
        });
        await redis.client.set(`voice:activity:${userId}`, Date.now().toString());
        totalReconciled++;
      }
    }

    if (totalReconciled > 0) {
      console.log(`🔄 Reconciled ${totalReconciled} voice participants from LiveKit`);
    } else {
      console.log('🔄 No active LiveKit voice sessions to reconcile');
    }
  } catch (err) {
    // Don't crash startup — just log and continue
    console.warn('⚠️  LiveKit voice reconciliation failed (LiveKit may be starting up):', (err as Error).message);
  }
}
