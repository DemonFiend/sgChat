/**
 * Voice Permission Cache
 *
 * Periodically fetches permission snapshots from Master and stores them
 * in-memory. When Master is unreachable, uses cached data for voice
 * authorization and generates LiveKit tokens locally.
 */

import { AccessToken } from 'livekit-server-sdk';
import { MasterClient } from './masterClient.js';
import type { RelayConfig } from '../config.js';
import type { EnvConfig } from '../config.js';

interface CachedChannel {
  id: string;
  name: string;
  server_id: string;
  type: string;
  voice_relay_policy: string;
  bitrate: number;
  user_limit: number;
}

interface CachedPermission {
  user_id: string;
  channel_id: string;
  can_connect: boolean;
  can_speak: boolean;
}

interface CachedUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface VoiceCacheData {
  channels: CachedChannel[];
  permission_snapshots: CachedPermission[];
  users: CachedUser[];
  fetched_at: number;
}

const CACHE_FETCH_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export class VoiceCacheService {
  private masterClient: MasterClient;
  private envConfig: EnvConfig;
  private cache: VoiceCacheData | null = null;
  private fetchTimer: ReturnType<typeof setInterval> | null = null;
  private masterReachable: boolean = true;

  constructor(masterClient: MasterClient, relayConfig: RelayConfig, envConfig: EnvConfig) {
    this.masterClient = masterClient;
    this.envConfig = envConfig;
    // relayConfig stored implicitly via masterClient
  }

  /**
   * Start periodic cache refresh.
   */
  start() {
    if (this.fetchTimer) return;
    console.log('📦 Voice cache service started (refresh every 2 min)');
    this.fetchCache();
    this.fetchTimer = setInterval(() => this.fetchCache(), CACHE_FETCH_INTERVAL_MS);
  }

  /**
   * Stop cache refresh.
   */
  stop() {
    if (this.fetchTimer) {
      clearInterval(this.fetchTimer);
      this.fetchTimer = null;
    }
    this.cache = null;
  }

  /**
   * Fetch permission snapshot from Master.
   */
  private async fetchCache() {
    try {
      const data = await this.masterClient.fetchVoiceCache();
      if (data) {
        this.cache = { ...data, fetched_at: Date.now() };
        this.masterReachable = true;
      } else {
        this.masterReachable = false;
      }
    } catch {
      this.masterReachable = false;
    }
  }

  /**
   * Check if the cache is still valid (within TTL).
   */
  isCacheValid(): boolean {
    if (!this.cache) return false;
    return Date.now() - this.cache.fetched_at < CACHE_TTL_MS;
  }

  /**
   * Check if Master is currently reachable.
   */
  isMasterReachable(): boolean {
    return this.masterReachable;
  }

  /**
   * Authorize a voice join using cached permissions.
   * Returns a locally-generated LiveKit token or null if unauthorized.
   */
  async authorizeFromCache(
    userId: string,
    channelId: string,
  ): Promise<{ token: string; url: string; cache_authorized: true } | null> {
    if (!this.isCacheValid()) return null;

    const perm = this.cache!.permission_snapshots.find(
      (p) => p.user_id === userId && p.channel_id === channelId,
    );

    if (!perm || !perm.can_connect) return null;

    const user = this.cache!.users.find((u) => u.id === userId);
    const roomName = `voice_${channelId}`;

    // Generate a local LiveKit token using relay's own credentials
    const token = await this.generateLocalToken({
      identity: userId,
      name: user?.display_name || user?.username || userId,
      room: roomName,
      canPublish: perm.can_speak,
    });

    return {
      token,
      url: this.envConfig.LIVEKIT_PUBLIC_URL,
      cache_authorized: true,
    };
  }

  /**
   * Generate a LiveKit token using the relay's own LiveKit credentials.
   */
  private async generateLocalToken(opts: {
    identity: string;
    name: string;
    room: string;
    canPublish: boolean;
  }): Promise<string> {
    const at = new AccessToken(
      this.envConfig.LIVEKIT_API_KEY,
      this.envConfig.LIVEKIT_API_SECRET,
      {
        identity: opts.identity,
        name: opts.name,
        ttl: '1h',
      },
    );

    at.addGrant({
      room: opts.room,
      roomJoin: true,
      canPublish: opts.canPublish,
      canPublishData: true,
      canSubscribe: true,
    });

    return await at.toJwt();
  }

  /**
   * Get cached channels (for relay status/health info).
   */
  getCachedChannels(): CachedChannel[] {
    return this.cache?.channels || [];
  }
}
