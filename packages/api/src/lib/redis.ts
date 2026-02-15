import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const client = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

export async function initRedis() {
  client.on('error', (err) => {
    console.error('❌ Redis error:', err);
  });

  client.on('connect', () => {
    console.log('✅ Redis connected');
  });

  try {
    await client.ping();
  } catch (error) {
    console.error('❌ Redis connection failed:', error);
    throw error;
  }
}

// Session data structure for cookie-based auth
interface SessionData {
  token: string;
  userId: string;
}

// Redis helper functions
export const redis = {
  client, // Expose client for direct access

  // Session management with token indexing for cookie-based refresh
  async setSession(userId: string, token: string, expiresIn: number = 604800) {
    const sessionData: SessionData = { token, userId };
    // Store session by userId
    await client.setex(`session:${userId}`, expiresIn, JSON.stringify(sessionData));
    // Index by token for lookup without userId (cookie-based refresh)
    await client.setex(`session_token:${token}`, expiresIn, userId);
  },

  async getSession(userId: string): Promise<SessionData | null> {
    const data = await client.get(`session:${userId}`);
    if (!data) return null;
    try {
      return JSON.parse(data) as SessionData;
    } catch {
      return null;
    }
  },

  // Look up session by token (for cookie-based refresh without Bearer header)
  async getSessionByToken(token: string): Promise<{ userId: string } | null> {
    const userId = await client.get(`session_token:${token}`);
    if (!userId) return null;
    // Verify the session still exists and token matches
    const session = await this.getSession(userId);
    if (!session || session.token !== token) return null;
    return { userId };
  },

  async deleteSession(userId: string) {
    // Get the token first to delete the index
    const session = await this.getSession(userId);
    if (session?.token) {
      await client.del(`session_token:${session.token}`);
    }
    await client.del(`session:${userId}`);
  },

  // ── Multi-session presence tracking ──────────────────────────
  // Tracks individual socket sessions per user to properly handle
  // multiple tabs/devices. User only goes offline when ALL sessions disconnect.

  /**
   * Add a socket session for a user (call on connect).
   * Returns true if this is the user's first session (they just came online).
   */
  async addSession(userId: string, sessionId: string): Promise<boolean> {
    const wasOnline = await client.sismember('online_users', userId);
    await client.sadd(`user_sessions:${userId}`, sessionId);
    await client.sadd('online_users', userId);
    await client.setex(`presence:${userId}`, 300, 'online'); // 5 min TTL
    return wasOnline === 0;
  },

  /**
   * Remove a socket session for a user (call on disconnect).
   * Returns true if this was the user's last session (they are now offline).
   */
  async removeSession(userId: string, sessionId: string): Promise<boolean> {
    await client.srem(`user_sessions:${userId}`, sessionId);
    const remaining = await client.scard(`user_sessions:${userId}`);
    if (remaining === 0) {
      await client.srem('online_users', userId);
      await client.del(`presence:${userId}`);
      await client.del(`user_sessions:${userId}`);
      return true;
    }
    return false;
  },

  /**
   * Get all active session IDs for a user.
   */
  async getUserSessions(userId: string): Promise<string[]> {
    return client.smembers(`user_sessions:${userId}`);
  },

  /**
   * Get the count of active sessions for a user.
   */
  async getSessionCount(userId: string): Promise<number> {
    return client.scard(`user_sessions:${userId}`);
  },

  // Legacy presence functions (kept for backwards compatibility)
  async setPresence(userId: string, online: boolean) {
    if (online) {
      await client.sadd('online_users', userId);
      await client.setex(`presence:${userId}`, 300, 'online'); // 5 min TTL
    } else {
      // Only remove if no active sessions
      const sessionCount = await this.getSessionCount(userId);
      if (sessionCount === 0) {
        await client.srem('online_users', userId);
        await client.del(`presence:${userId}`);
      }
    }
  },

  async getPresence(userId: string): Promise<boolean> {
    return (await client.sismember('online_users', userId)) === 1;
  },

  async setUserOnline(userId: string) {
    await client.sadd('online_users', userId);
    await client.setex(`presence:${userId}`, 300, 'online'); // 5 min TTL
  },

  async setUserOffline(userId: string) {
    // Only remove if no active sessions
    const sessionCount = await this.getSessionCount(userId);
    if (sessionCount === 0) {
      await client.srem('online_users', userId);
      await client.del(`presence:${userId}`);
    }
  },

  async isUserOnline(userId: string): Promise<boolean> {
    return (await client.sismember('online_users', userId)) === 1;
  },

  async getOnlineUsers(): Promise<string[]> {
    return client.smembers('online_users');
  },

  // Voice channel participant tracking
  async joinVoiceChannel(userId: string, channelId: string) {
    // Remove from any other voice channel first
    const currentChannel = await client.get(`voice:user:${userId}`);
    if (currentChannel) {
      await client.srem(`voice:channel:${currentChannel}`, userId);
    }
    // Add to new channel
    await client.sadd(`voice:channel:${channelId}`, userId);
    await client.set(`voice:user:${userId}`, channelId);
    await client.hset(`voice:state:${channelId}:${userId}`, {
      joined_at: new Date().toISOString(),
      is_muted: 'false',
      is_deafened: 'false',
    });
  },

  async leaveVoiceChannel(userId: string) {
    const channelId = await client.get(`voice:user:${userId}`);
    if (channelId) {
      await client.srem(`voice:channel:${channelId}`, userId);
      await client.del(`voice:state:${channelId}:${userId}`);
    }
    await client.del(`voice:user:${userId}`);
    return channelId; // Return the channel they left for socket events
  },

  async getVoiceChannelParticipants(channelId: string): Promise<string[]> {
    return client.smembers(`voice:channel:${channelId}`);
  },

  async getUserVoiceChannel(userId: string): Promise<string | null> {
    return client.get(`voice:user:${userId}`);
  },

  async getVoiceState(channelId: string, userId: string): Promise<{
    joined_at: string;
    is_muted: boolean;
    is_deafened: boolean;
  } | null> {
    const state = await client.hgetall(`voice:state:${channelId}:${userId}`);
    if (!state || Object.keys(state).length === 0) return null;
    return {
      joined_at: state.joined_at,
      is_muted: state.is_muted === 'true',
      is_deafened: state.is_deafened === 'true',
    };
  },

  async updateVoiceState(channelId: string, userId: string, updates: { is_muted?: boolean; is_deafened?: boolean }) {
    const data: Record<string, string> = {};
    if (updates.is_muted !== undefined) data.is_muted = updates.is_muted.toString();
    if (updates.is_deafened !== undefined) data.is_deafened = updates.is_deafened.toString();
    if (Object.keys(data).length > 0) {
      await client.hset(`voice:state:${channelId}:${userId}`, data);
    }
  },

  // ── Gateway session management (A0: resume support) ──────────
  // Stores session metadata so clients can resume after brief disconnects
  // without re-fetching all rooms and data from scratch.
  // Now supports multiple sessions per user (multi-tab/device).

  /** TTL for gateway sessions — 5 minutes after disconnect */
  GATEWAY_SESSION_TTL: 300,

  /**
   * Store a gateway session when a client connects.
   * The session holds the user ID and their subscribed resource IDs.
   * Supports multiple sessions per user.
   */
  async setGatewaySession(sessionId: string, userId: string, subscriptions: string[]) {
    const data = JSON.stringify({ userId, subscriptions, connectedAt: Date.now() });
    await client.setex(`gw:session:${sessionId}`, this.GATEWAY_SESSION_TTL, data);
    // Track all active sessions for this user (Set instead of single value)
    await client.sadd(`gw:user_sessions:${userId}`, sessionId);
    await client.expire(`gw:user_sessions:${userId}`, this.GATEWAY_SESSION_TTL);
  },

  /**
   * Retrieve a stored gateway session (returns null if expired or not found).
   */
  async getGatewaySession(sessionId: string): Promise<{
    userId: string;
    subscriptions: string[];
    connectedAt: number;
  } | null> {
    const raw = await client.get(`gw:session:${sessionId}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  /**
   * Get all gateway session IDs for a user.
   */
  async getUserGatewaySessions(userId: string): Promise<string[]> {
    return client.smembers(`gw:user_sessions:${userId}`);
  },

  /**
   * Refresh the TTL of a gateway session (called on heartbeat / activity).
   */
  async refreshGatewaySession(sessionId: string) {
    await client.expire(`gw:session:${sessionId}`, this.GATEWAY_SESSION_TTL);
    // Also refresh the user sessions set TTL
    const session = await this.getGatewaySession(sessionId);
    if (session) {
      await client.expire(`gw:user_sessions:${session.userId}`, this.GATEWAY_SESSION_TTL);
    }
  },

  /**
   * Delete a gateway session (called on clean logout / long disconnect).
   */
  async deleteGatewaySession(sessionId: string) {
    const session = await this.getGatewaySession(sessionId);
    if (session) {
      // Remove this session from the user's session set
      await client.srem(`gw:user_sessions:${session.userId}`, sessionId);
      // Clean up the set if empty
      const remaining = await client.scard(`gw:user_sessions:${session.userId}`);
      if (remaining === 0) {
        await client.del(`gw:user_sessions:${session.userId}`);
      }
    }
    await client.del(`gw:session:${sessionId}`);
  },
};
