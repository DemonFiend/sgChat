import { AccessToken } from 'livekit-server-sdk';

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://localhost:7880';
// LIVEKIT_PUBLIC_URL is the browser-accessible URL (may differ from internal Docker URL)
const LIVEKIT_PUBLIC_URL = process.env.LIVEKIT_PUBLIC_URL || LIVEKIT_URL;

export interface LiveKitTokenOptions {
  identity: string;
  room: string;
  canPublish?: boolean;
  canPublishVideo?: boolean;
  canPublishScreen?: boolean;
  canSubscribe?: boolean;
}

/**
 * Generate a LiveKit access token for voice/video channels
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
