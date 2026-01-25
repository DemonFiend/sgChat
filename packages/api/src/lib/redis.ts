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

  // Presence tracking
  async setPresence(userId: string, online: boolean) {
    if (online) {
      await client.sadd('online_users', userId);
      await client.setex(`presence:${userId}`, 300, 'online'); // 5 min TTL
    } else {
      await client.srem('online_users', userId);
      await client.del(`presence:${userId}`);
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
    await client.srem('online_users', userId);
    await client.del(`presence:${userId}`);
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
};
