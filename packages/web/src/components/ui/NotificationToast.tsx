import { For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { toastStore, type ToastNotification } from '@/stores/toastNotifications';
import { Avatar } from './Avatar';

export function NotificationToast() {
  const handleClick = (toast: ToastNotification) => {
    if (toast.onClick) {
      toast.onClick();
    }
    toastStore.removeToast(toast.id);
  };

  return (
    <Portal>
      <div class="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none" style={{ "max-width": "380px" }}>
        <For each={toastStore.toasts()}>
          {(toast) => (
            <div
              class="pointer-events-auto flex items-start gap-3 bg-bg-secondary border border-border-primary rounded-lg shadow-lg p-3 cursor-pointer hover:bg-bg-tertiary transition-colors animate-slide-in-right"
              onClick={() => handleClick(toast)}
            >
              {/* Avatar */}
              <Show when={toast.avatarUrl} fallback={
                <div class="w-10 h-10 rounded-full bg-bg-tertiary flex items-center justify-center flex-shrink-0">
                  <Show when={toast.type === 'dm'}>
                    <svg class="w-5 h-5 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </Show>
                  <Show when={toast.type === 'mention'}>
                    <svg class="w-5 h-5 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                    </svg>
                  </Show>
                  <Show when={toast.type === 'system'}>
                    <svg class="w-5 h-5 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </Show>
                </div>
              }>
                <Avatar
                  src={toast.avatarUrl!}
                  alt={toast.title}
                  size="lg"
                />
              </Show>

              {/* Content */}
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm font-semibold text-text-primary truncate">{toast.title}</span>
                  <Show when={toast.type === 'dm'}>
                    <span class="text-xs text-text-muted flex-shrink-0">DM</span>
                  </Show>
                </div>
                <p class="text-sm text-text-secondary truncate mt-0.5">{toast.message}</p>
              </div>

              {/* Close button */}
              <button
                class="flex-shrink-0 text-text-muted hover:text-text-primary p-0.5 -mt-0.5 -mr-0.5"
                onClick={(e) => {
                  e.stopPropagation();
                  toastStore.removeToast(toast.id);
                }}
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
        </For>
      </div>

      {/* Inline keyframe animation */}
      <style>{`
        @keyframes slide-in-right {
          from {
            opacity: 0;
            transform: translateX(100%);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        .animate-slide-in-right {
          animation: slide-in-right 0.3s ease-out;
        }
      `}</style>
    </Portal>
  );
}
