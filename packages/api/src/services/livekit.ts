import { AccessToken } from 'livekit-server-sdk';

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://localhost:7880';

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
 * Get LiveKit server URL
 */
export function getLiveKitUrl(): string {
  return LIVEKIT_URL;
}
