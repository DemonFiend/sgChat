import { create } from 'zustand';

const STORAGE_KEY = 'sgchat-dev-mode';

function getInitial(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

interface DevModeState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  toggle: () => void;
}

export const useDevModeStore = create<DevModeState>((set, get) => ({
  enabled: getInitial(),
  setEnabled: (enabled) => {
    localStorage.setItem(STORAGE_KEY, String(enabled));
    set({ enabled });
  },
  toggle: () => {
    const next = !get().enabled;
    localStorage.setItem(STORAGE_KEY, String(next));
    set({ enabled: next });
  },
}));
