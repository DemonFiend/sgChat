import { AccessToken } from 'livekit-server-sdk';
import { db } from '../lib/db.js';
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
 */
export async function getRelayLiveKitUrl(relayId: string): Promise<string> {
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
