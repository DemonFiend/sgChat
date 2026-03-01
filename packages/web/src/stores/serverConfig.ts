import { create } from 'zustand';
import { api } from '@/api';
import type { ServerPopupConfig, UpdatePopupConfigInput } from '@sgchat/shared';

interface ChannelInfo {
  id: string;
  name: string;
  type: string;
}

interface ServerConfigState {
  config: ServerPopupConfig | null;
  channels: ChannelInfo[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  isDirty: boolean;
  lastSaved: Date | null;
}

interface ServerConfigActions {
  fetchConfig: (serverId: string) => Promise<void>;
  updateConfig: (serverId: string, updates: UpdatePopupConfigInput) => Promise<boolean>;
  setConfig: (config: ServerPopupConfig) => void;
  updateField: <K extends keyof ServerPopupConfig>(field: K, value: ServerPopupConfig[K]) => void;
  reset: () => void;
  clear: () => void;
  clearError: () => void;
}

// LocalStorage helper for draft persistence
const DRAFT_KEY_PREFIX = 'serverPopupConfig_draft_';

function saveDraft(serverId: string, config: ServerPopupConfig): void {
  try {
    const draft = { config, timestamp: Date.now() };
    localStorage.setItem(`${DRAFT_KEY_PREFIX}${serverId}`, JSON.stringify(draft));
  } catch (e) {
    console.warn('[ServerConfig] Failed to save draft to localStorage', e);
  }
}

function clearDraft(serverId: string): void {
  try {
    localStorage.removeItem(`${DRAFT_KEY_PREFIX}${serverId}`);
  } catch {
    // Fail silently
  }
}

export const useServerConfigStore = create<ServerConfigState & ServerConfigActions>((set, get) => ({
  config: null,
  channels: [],
  isLoading: false,
  isSaving: false,
  error: null,
  isDirty: false,
  lastSaved: null,

  fetchConfig: async (_serverId) => {
    set({ isLoading: true, error: null });
    try {
      const [config, channelsData] = await Promise.all([
        api.get<ServerPopupConfig>('/server/popup-config'),
        api.get<{ channels: ChannelInfo[] }>('/channels'),
      ]);
      set({
        config,
        channels: channelsData.channels || [],
        isLoading: false,
        isDirty: false,
      });
    } catch (error: any) {
      console.error('[ServerConfig] Failed to fetch config:', error);
      set({
        error: error.message || 'Failed to load configuration',
        isLoading: false,
      });
    }
  },

  updateConfig: async (serverId, updates) => {
    set({ isSaving: true, error: null });
    try {
      const updatedConfig = await api.put<ServerPopupConfig>('/server/popup-config', updates);
      set({
        config: updatedConfig,
        isSaving: false,
        isDirty: false,
        lastSaved: new Date(),
      });
      clearDraft(serverId);
      return true;
    } catch (error: any) {
      console.error('[ServerConfig] Failed to update config:', error);
      set({
        error: error.message || 'Failed to save configuration',
        isSaving: false,
      });
      return false;
    }
  },

  setConfig: (config) => {
    set({ config, isDirty: true });
    if (config.serverId) {
      saveDraft(config.serverId, config);
    }
  },

  updateField: (field, value) => {
    const current = get().config;
    if (!current) return;
    const updated = { ...current, [field]: value };
    get().setConfig(updated);
  },

  reset: () => set({ isDirty: false, error: null }),
  clear: () => set({
    config: null,
    channels: [],
    isLoading: false,
    isSaving: false,
    error: null,
    isDirty: false,
    lastSaved: null,
  }),
  clearError: () => set({ error: null }),
}));

// Convenience alias for non-hook contexts
export const serverConfigStore = {
  getState: () => useServerConfigStore.getState(),
  fetchConfig: (serverId: string) => useServerConfigStore.getState().fetchConfig(serverId),
  updateConfig: (serverId: string, updates: UpdatePopupConfigInput) => useServerConfigStore.getState().updateConfig(serverId, updates),
  setConfig: (config: ServerPopupConfig) => useServerConfigStore.getState().setConfig(config),
  updateField: <K extends keyof ServerPopupConfig>(field: K, value: ServerPopupConfig[K]) => useServerConfigStore.getState().updateField(field, value),
  reset: () => useServerConfigStore.getState().reset(),
  clear: () => useServerConfigStore.getState().clear(),
  clearError: () => useServerConfigStore.getState().clearError(),
};
