import { create } from 'zustand';
import { api } from '@/api';
import type { EmojiPack, CustomEmoji, EmojiManifest } from '@sgchat/shared';

interface EmojiManifestState {
  manifests: Map<string, EmojiManifest>;
  etags: Map<string, string>;
  loading: boolean;
  error: string | null;
}

interface EmojiManifestActions {
  fetchManifest: (serverId: string) => Promise<void>;
  getEmoji: (serverId: string, shortcode: string) => CustomEmoji | undefined;
  getEmojiById: (emojiId: string) => CustomEmoji | undefined;
  getPackEmojis: (serverId: string, packId: string) => CustomEmoji[];
  getPacks: (serverId: string) => EmojiPack[];
  clearManifest: (serverId: string) => void;
  reset: () => void;
}

export const useEmojiManifestStore = create<EmojiManifestState & EmojiManifestActions>(
  (set, get) => ({
    manifests: new Map(),
    etags: new Map(),
    loading: false,
    error: null,

    fetchManifest: async (serverId: string) => {
      set({ loading: true, error: null });
      try {
        console.log('[EmojiManifest] Fetching manifest for server:', serverId);
        const data = await api.get<EmojiManifest>(
          `/servers/${serverId}/emojis/manifest`,
        );
        console.log('[EmojiManifest] Response:', data, 'packs:', data?.packs?.length, 'emojis:', data?.emojis?.length);
        if (!data) {
          console.warn('[EmojiManifest] Got null/undefined response, skipping store update');
          set({ loading: false });
          return;
        }
        set((state) => {
          const manifests = new Map(state.manifests);
          manifests.set(serverId, data);
          return { manifests, loading: false };
        });
      } catch (err: any) {
        // 304 Not Modified is fine - keep existing data
        if (err?.status === 304) {
          set({ loading: false });
          return;
        }
        set({ error: err?.message || 'Failed to fetch emoji manifest', loading: false });
      }
    },

    getEmoji: (serverId: string, shortcode: string) => {
      const manifest = get().manifests.get(serverId);
      if (!manifest) return undefined;
      return manifest.emojis.find((e) => e.shortcode === shortcode);
    },

    getEmojiById: (emojiId: string) => {
      for (const manifest of get().manifests.values()) {
        const emoji = manifest.emojis.find((e) => e.id === emojiId);
        if (emoji) return emoji;
      }
      return undefined;
    },

    getPackEmojis: (serverId: string, packId: string) => {
      const manifest = get().manifests.get(serverId);
      if (!manifest) return [];
      return manifest.emojis.filter((e) => e.pack_id === packId);
    },

    getPacks: (serverId: string) => {
      const manifest = get().manifests.get(serverId);
      if (!manifest) return [];
      return manifest.packs;
    },

    clearManifest: (serverId: string) => {
      set((state) => {
        const manifests = new Map(state.manifests);
        const etags = new Map(state.etags);
        manifests.delete(serverId);
        etags.delete(serverId);
        return { manifests, etags };
      });
    },

    reset: () => {
      set({ manifests: new Map(), etags: new Map(), loading: false, error: null });
    },
  }),
);

export const emojiManifestStore = useEmojiManifestStore;
