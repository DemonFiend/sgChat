import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useToastStore, toastStore, type ToastNotification } from '@/stores/toastNotifications';
import { Avatar } from './Avatar';
import { slideInRight, easeTransition } from '@/lib/motion';

export function NotificationToast() {
  const toasts = useToastStore((s) => s.toasts);

  const handleClick = (toast: ToastNotification) => {
    if (toast.onClick) {
      toast.onClick();
    }
    toastStore.removeToast(toast.id);
  };

  return createPortal(
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none" style={{ maxWidth: '380px' }}>
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            variants={slideInRight}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={easeTransition}
            className={`pointer-events-auto flex items-start gap-3 bg-bg-secondary rounded-lg shadow-lg p-3 cursor-pointer hover:bg-bg-tertiary transition-colors ${
              toast.type === 'warning'
                ? 'border-2 border-yellow-500/50'
                : 'border border-border-primary'
            }`}
            role="alert"
            onClick={() => handleClick(toast)}
          >
            {/* Avatar */}
            {toast.avatarUrl ? (
              <Avatar
                src={toast.avatarUrl}
                alt={toast.title}
                size="lg"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-bg-tertiary flex items-center justify-center flex-shrink-0">
                {toast.type === 'dm' && (
                  <svg className="w-5 h-5 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                )}
                {toast.type === 'mention' && (
                  <svg className="w-5 h-5 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                  </svg>
                )}
                {toast.type === 'system' && (
                  <svg className="w-5 h-5 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                {toast.type === 'warning' && (
                  <svg className="w-5 h-5 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                )}
              </div>
            )}

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-text-primary truncate">{toast.title}</span>
                {toast.type === 'dm' && (
                  <span className="text-xs text-text-muted flex-shrink-0">DM</span>
                )}
                {toast.type === 'warning' && (
                  <span className="text-xs text-yellow-500 font-semibold flex-shrink-0">WARNING</span>
                )}
              </div>
              <p className="text-sm text-text-secondary truncate mt-0.5">{toast.message}</p>
            </div>

            {/* Close button */}
            <button
              className="flex-shrink-0 text-text-muted hover:text-text-primary p-0.5 -mt-0.5 -mr-0.5"
              onClick={(e) => {
                e.stopPropagation();
                toastStore.removeToast(toast.id);
              }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body
  );
}
