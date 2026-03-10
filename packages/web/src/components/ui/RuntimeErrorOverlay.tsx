import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useDevModeStore } from '@/stores/devMode';
import { easeTransition } from '@/lib/motion';

interface CaughtError {
  id: number;
  message: string;
  stack: string | null;
  timestamp: number;
}

let nextId = 0;
const MAX_ERRORS = 5;

export function RuntimeErrorOverlay() {
  const devMode = useDevModeStore((s) => s.enabled);
  const [errors, setErrors] = useState<CaughtError[]>([]);

  const addError = useCallback((message: string, stack: string | null) => {
    setErrors((prev) => {
      const next = [
        ...prev,
        { id: nextId++, message, stack, timestamp: Date.now() },
      ];
      // Keep only the most recent errors
      if (next.length > MAX_ERRORS) return next.slice(-MAX_ERRORS);
      return next;
    });
  }, []);

  const dismiss = useCallback((id: number) => {
    setErrors((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setErrors([]);
  }, []);

  useEffect(() => {
    if (!devMode) return;

    const handleError = (event: ErrorEvent) => {
      addError(
        event.message || 'Unknown error',
        event.error?.stack || null,
      );
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message = reason?.message || String(reason) || 'Unhandled promise rejection';
      const stack = reason?.stack || null;
      addError(message, stack);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, [devMode, addError]);

  // Don't render anything if dev mode is off or no errors
  if (!devMode || errors.length === 0) return null;

  return createPortal(
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none" style={{ maxWidth: '480px' }}>
      {errors.length > 1 && (
        <div className="pointer-events-auto flex justify-end mb-1">
          <button
            onClick={dismissAll}
            className="text-xs text-text-muted hover:text-text-primary bg-bg-tertiary/90 px-2 py-1 rounded transition-colors"
          >
            Dismiss all ({errors.length})
          </button>
        </div>
      )}
      <AnimatePresence mode="popLayout">
        {errors.map((err) => (
          <ErrorToast key={err.id} error={err} onDismiss={() => dismiss(err.id)} />
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

function ErrorToast({ error, onDismiss }: { error: CaughtError; onDismiss: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = error.stack
      ? `${error.message}\n\n${error.stack}`
      : error.message;

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      window.prompt('Copy error:', text);
    });
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      transition={easeTransition}
      className="pointer-events-auto bg-bg-secondary border-2 border-danger/50 rounded-lg shadow-lg overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-start gap-2 p-3">
        <div className="w-5 h-5 rounded-full bg-danger/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <svg className="w-3 h-3 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase text-danger">Runtime Error</span>
            <span className="text-xs text-text-muted">
              {new Date(error.timestamp).toLocaleTimeString()}
            </span>
          </div>
          <p className="text-sm text-text-primary mt-1 break-words">{error.message}</p>
        </div>

        {/* Close */}
        <button
          onClick={onDismiss}
          className="flex-shrink-0 text-text-muted hover:text-text-primary p-0.5"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Actions + Stack */}
      <div className="px-3 pb-3 flex items-center gap-2">
        <button
          onClick={handleCopy}
          className="text-xs px-2 py-1 rounded bg-bg-tertiary hover:bg-bg-modifier-hover text-text-primary transition-colors"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
        {error.stack && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs px-2 py-1 rounded bg-bg-tertiary hover:bg-bg-modifier-hover text-text-muted transition-colors flex items-center gap-1"
          >
            <svg
              className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
            </svg>
            Stack
          </button>
        )}
      </div>

      {expanded && error.stack && (
        <div className="px-3 pb-3">
          <pre className="p-2 bg-black/30 rounded text-xs text-text-muted overflow-auto max-h-48 whitespace-pre-wrap break-words">
            {error.stack}
          </pre>
        </div>
      )}
    </motion.div>
  );
}
