import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { clsx } from 'clsx';
import { fadeIn, scaleIn, springTransition, easeTransition } from '@/lib/motion';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ isOpen, onClose, title, children, className }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Focus trap + escape key
  useEffect(() => {
    if (!isOpen) return;

    // Save the previously focused element
    previousFocusRef.current = document.activeElement as HTMLElement;

    // Focus the first focusable element in the dialog
    requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const firstFocusable = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      firstFocusable?.focus();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      // Focus trap: cycle focus within the modal
      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;

        const focusableEls = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
        if (focusableEls.length === 0) return;

        const first = focusableEls[0];
        const last = focusableEls[focusableEls.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Restore focus to the previous element
      previousFocusRef.current?.focus();
    };
  }, [isOpen, onClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={handleBackdropClick}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? 'modal-title' : undefined}
          variants={fadeIn}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={easeTransition}
        >
          <motion.div
            ref={dialogRef}
            className={clsx(
              'relative bg-bg-primary rounded-lg shadow-high max-w-md w-full mx-4',
              className
            )}
            variants={scaleIn}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={springTransition}
          >
            {title && (
              <div className="px-4 py-3 border-b border-divider">
                <h2 id="modal-title" className="text-lg font-semibold text-text-primary">
                  {title}
                </h2>
              </div>
            )}

            <div className="p-4">{children}</div>

            <button
              onClick={onClose}
              className="absolute top-3 right-3 p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-modifier-hover transition-colors"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
