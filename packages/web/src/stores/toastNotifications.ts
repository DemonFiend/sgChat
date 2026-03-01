import { create } from 'zustand';
import { getElectronAPI } from '@/lib/electron';

export interface ToastNotification {
  id: string;
  type: 'dm' | 'mention' | 'system' | 'warning';
  title: string;
  message: string;
  avatarUrl?: string | null;
  onClick?: () => void;
  duration?: number;
}

interface ToastState {
  toasts: ToastNotification[];
  addToast: (notification: Omit<ToastNotification, 'id'>) => void;
  removeToast: (id: string) => void;
}

let idCounter = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (notification) => {
    const id = `toast-${++idCounter}-${Date.now()}`;
    const duration = notification.duration ?? 5000;
    const toast: ToastNotification = { ...notification, id };

    set((s) => ({ toasts: [...s.toasts, toast] }));

    // Fire native notification + flash frame in Electron for DMs and mentions
    const electronAPI = getElectronAPI();
    if (electronAPI && (notification.type === 'dm' || notification.type === 'mention')) {
      electronAPI.showNotification(notification.title, notification.message);
      electronAPI.flashFrame(true);
    }

    if (duration > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, duration);
    }
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

// Convenience alias for non-hook contexts
export const toastStore = {
  getState: () => useToastStore.getState(),
  toasts: () => useToastStore.getState().toasts,
  addToast: (notification: Omit<ToastNotification, 'id'>) => useToastStore.getState().addToast(notification),
  removeToast: (id: string) => useToastStore.getState().removeToast(id),
};
