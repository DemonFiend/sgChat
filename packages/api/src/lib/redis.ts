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

// Redis helper functions
export const redis = {
  client, // Expose client for direct access

  // Session management
  async setSession(userId: string, token: string, expiresIn: number = 604800) {
    await client.setex(`session:${userId}`, expiresIn, token);
  },

  async getSession(userId: string): Promise<string | null> {
    return client.get(`session:${userId}`);
  },

  async deleteSession(userId: string) {
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
};
