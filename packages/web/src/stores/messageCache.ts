import type { Message } from '@/components/layout';

interface ChannelCache {
  messages: Message[];
  hash: string;
  lastFetched: number;
}

const cache = new Map<string, ChannelCache>();

export const messageCache = {
  get: (channelId: string): ChannelCache | undefined => cache.get(channelId),

  set: (channelId: string, messages: Message[], hash: string): void => {
    cache.set(channelId, { messages, hash, lastFetched: Date.now() });
  },

  invalidate: (channelId: string): void => {
    cache.delete(channelId);
  },

  invalidateAll: (): void => {
    cache.clear();
  },

  appendMessage: (channelId: string, message: Message): void => {
    const cached = cache.get(channelId);
    if (cached) {
      cached.messages = [...cached.messages, message];
      cached.hash = ''; // Invalidate hash so next fetch checks server
    }
  },

  updateMessage: (channelId: string, messageId: string, updater: (msg: Message) => Message): void => {
    const cached = cache.get(channelId);
    if (cached) {
      cached.messages = cached.messages.map(msg => 
        msg.id === messageId ? updater(msg) : msg
      );
      cached.hash = ''; // Invalidate hash
    }
  },

  removeMessage: (channelId: string, messageId: string): void => {
    const cached = cache.get(channelId);
    if (cached) {
      cached.messages = cached.messages.filter(msg => msg.id !== messageId);
      cached.hash = ''; // Invalidate hash
    }
  },

  hasValidCache: (channelId: string, maxAgeMs: number = 5 * 60 * 1000): boolean => {
    const cached = cache.get(channelId);
    if (!cached || !cached.hash) return false;
    return Date.now() - cached.lastFetched < maxAgeMs;
  },

  getHash: (channelId: string): string | undefined => {
    return cache.get(channelId)?.hash;
  },
};
