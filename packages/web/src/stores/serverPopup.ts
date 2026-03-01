import { create } from 'zustand';
import { api } from '@/api';
import type { ServerPopupData } from '@sgchat/shared';

interface ServerPopupState {
  isVisible: boolean;
  currentServerId: string | null;
  serverData: ServerPopupData | null;
  isLoading: boolean;
  error: string | null;
}

interface ServerPopupActions {
  showPopup: (serverId: string) => Promise<void>;
  hidePopup: () => void;
  dismissPopup: () => void;
  reopenPopup: () => Promise<void>;
  setServerData: (data: ServerPopupData) => void;
  retry: () => Promise<void>;
  reset: () => void;
}

const LAST_SHOWN_KEY_PREFIX = 'serverPopup_lastShown_';
const DISMISSED_KEY_PREFIX = 'serverPopup_dismissed_';
const SHOW_INTERVAL_MS = 24 * 60 * 60 * 1000;

function shouldShowPopup(serverId: string): boolean {
  try {
    const lastShownStr = localStorage.getItem(`${LAST_SHOWN_KEY_PREFIX}${serverId}`);
    if (!lastShownStr) {
      const legacyDismissed = localStorage.getItem(`${DISMISSED_KEY_PREFIX}${serverId}`);
      if (legacyDismissed === 'true') {
        const migratedTimestamp = Date.now() - (25 * 60 * 60 * 1000);
        localStorage.setItem(`${LAST_SHOWN_KEY_PREFIX}${serverId}`, migratedTimestamp.toString());
        localStorage.removeItem(`${DISMISSED_KEY_PREFIX}${serverId}`);
        return true;
      }
      return true;
    }
    const lastShownTimestamp = parseInt(lastShownStr, 10);
    return Date.now() - lastShownTimestamp >= SHOW_INTERVAL_MS;
  } catch {
    return true;
  }
}

function markAsShown(serverId: string): void {
  try {
    localStorage.setItem(`${LAST_SHOWN_KEY_PREFIX}${serverId}`, Date.now().toString());
  } catch { /* fail silently */ }
}

function clearLastShown(serverId: string): void {
  try {
    localStorage.removeItem(`${LAST_SHOWN_KEY_PREFIX}${serverId}`);
    localStorage.removeItem(`${DISMISSED_KEY_PREFIX}${serverId}`);
  } catch { /* fail silently */ }
}

export const useServerPopupStore = create<ServerPopupState & ServerPopupActions>((set, get) => ({
  isVisible: false,
  currentServerId: null,
  serverData: null,
  isLoading: false,
  error: null,

  showPopup: async (serverId) => {
    set({ currentServerId: serverId });

    if (!shouldShowPopup(serverId)) return;

    set({ isLoading: true, error: null });

    try {
      const popupData = await api.get<ServerPopupData>('/server/popup-config/data');
      markAsShown(serverId);
      set({
        isVisible: true,
        currentServerId: serverId,
        serverData: popupData,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load server data',
      });
    }
  },

  hidePopup: () => set({ isVisible: false }),

  dismissPopup: () => set({ isVisible: false }),

  reopenPopup: async () => {
    const { currentServerId, serverData } = get();
    if (!currentServerId) return;

    clearLastShown(currentServerId);

    if (serverData) {
      markAsShown(currentServerId);
      set({ isVisible: true });
    } else {
      await get().showPopup(currentServerId);
    }
  },

  setServerData: (data) => set({ serverData: data }),

  retry: async () => {
    const { currentServerId } = get();
    if (currentServerId) await get().showPopup(currentServerId);
  },

  reset: () => set({
    isVisible: false,
    currentServerId: null,
    serverData: null,
    isLoading: false,
    error: null,
  }),
}));

// Convenience alias for non-hook contexts
export const serverPopupStore = {
  getState: () => useServerPopupStore.getState(),
  showPopup: (serverId: string) => useServerPopupStore.getState().showPopup(serverId),
  hidePopup: () => useServerPopupStore.getState().hidePopup(),
  dismissPopup: () => useServerPopupStore.getState().dismissPopup(),
  reopenPopup: () => useServerPopupStore.getState().reopenPopup(),
  setServerData: (data: ServerPopupData) => useServerPopupStore.getState().setServerData(data),
  retry: () => useServerPopupStore.getState().retry(),
  reset: () => useServerPopupStore.getState().reset(),
};
