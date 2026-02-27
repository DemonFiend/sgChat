import { createSignal } from 'solid-js';

export interface ToastNotification {
  id: string;
  type: 'dm' | 'mention' | 'system';
  title: string;
  message: string;
  avatarUrl?: string | null;
  onClick?: () => void;
  duration?: number;
}

const [toasts, setToasts] = createSignal<ToastNotification[]>([]);

let idCounter = 0;

function addToast(notification: Omit<ToastNotification, 'id'>) {
  const id = `toast-${++idCounter}-${Date.now()}`;
  const duration = notification.duration ?? 5000;

  const toast: ToastNotification = { ...notification, id };
  setToasts(prev => [...prev, toast]);

  // Auto-remove after duration
  if (duration > 0) {
    setTimeout(() => {
      removeToast(id);
    }, duration);
  }
}

function removeToast(id: string) {
  setToasts(prev => prev.filter(t => t.id !== id));
}

export const toastStore = {
  toasts,
  addToast,
  removeToast,
};
