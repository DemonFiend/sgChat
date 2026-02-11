import { JSX, Show, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import { clsx } from 'clsx';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: JSX.Element;
  class?: string;
}

export function Modal(props: ModalProps) {
  let dialogRef: HTMLDivElement | undefined;

  // Handle escape key
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && props.isOpen) {
      props.onClose();
    }
  };

  // Handle click outside
  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      props.onClose();
    }
  };

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <Show when={props.isOpen}>
      <Portal>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={handleBackdropClick}
          role="dialog"
          aria-modal="true"
          aria-labelledby={props.title ? 'modal-title' : undefined}
        >
          <div
            ref={dialogRef}
            class={clsx(
              'relative bg-bg-primary rounded-lg shadow-high max-w-md w-full mx-4',
              'animate-in zoom-in-95 duration-200',
              props.class
            )}
          >
            <Show when={props.title}>
              <div class="px-4 py-3 border-b border-divider">
                <h2 id="modal-title" class="text-lg font-semibold text-text-primary">
                  {props.title}
                </h2>
              </div>
            </Show>

            <div class="p-4">{props.children}</div>

            <button
              onClick={props.onClose}
              class="absolute top-3 right-3 p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-modifier-hover transition-colors"
              aria-label="Close"
            >
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
