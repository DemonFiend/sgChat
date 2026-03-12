import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

export interface AdminMenuProps {
  isOpen: boolean;
  onClose: () => void;
  position: { x: number; y: number };
  onOpenStorageDashboard: () => void;
}

export function AdminMenu({
  isOpen,
  onClose,
  position,
  onOpenStorageDashboard,
}: AdminMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.1 }}
          className="fixed z-[9999] min-w-[180px] py-1.5 rounded-lg bg-bg-tertiary border border-divider shadow-xl"
          style={{
            left: position.x,
            top: position.y,
          }}
        >
          <button
            onClick={() => {
              onOpenStorageDashboard();
              onClose();
            }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition-colors text-text-primary hover:bg-bg-modifier-hover"
          >
            <span className="flex-shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
              </svg>
            </span>
            <span className="flex-1">Storage Dashboard</span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
