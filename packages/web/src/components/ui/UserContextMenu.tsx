import { For, Show, onCleanup, onMount, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';

export interface ContextMenuItem {
  label: string;
  icon?: JSX.Element;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

interface UserContextMenuProps {
  isOpen: boolean;
  onClose: () => void;
  position: { x: number; y: number };
  items: ContextMenuItem[];
}

export function UserContextMenu(props: UserContextMenuProps) {
  let menuRef: HTMLDivElement | undefined;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onClose();
  };

  const handleClickOutside = (e: MouseEvent) => {
    if (menuRef && !menuRef.contains(e.target as Node)) {
      props.onClose();
    }
  };

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown);
    // Delay to avoid the context menu click triggering close immediately
    requestAnimationFrame(() => {
      document.addEventListener('mousedown', handleClickOutside);
    });
  });

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('mousedown', handleClickOutside);
  });

  // Adjust position to keep menu in viewport
  const adjustedPosition = () => {
    const menuWidth = 200;
    const menuHeight = props.items.length * 36;
    const x = Math.min(props.position.x, window.innerWidth - menuWidth - 8);
    const y = Math.min(props.position.y, window.innerHeight - menuHeight - 8);
    return { x: Math.max(8, x), y: Math.max(8, y) };
  };

  return (
    <Show when={props.isOpen}>
      <Portal>
        <div
          ref={menuRef}
          class="fixed z-[100] min-w-[180px] py-1.5 bg-bg-tertiary rounded-md shadow-lg border border-divider"
          style={{
            left: `${adjustedPosition().x}px`,
            top: `${adjustedPosition().y}px`,
          }}
        >
          <For each={props.items}>
            {(item) => (
              <>
                <Show when={item.separator}>
                  <div class="my-1 mx-2 border-t border-divider" />
                </Show>
                <button
                  class={`flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left transition-colors ${
                    item.disabled
                      ? 'text-text-muted cursor-not-allowed opacity-50'
                      : item.danger
                        ? 'text-danger hover:bg-danger/10'
                        : 'text-text-secondary hover:bg-bg-modifier-hover hover:text-text-primary'
                  }`}
                  onClick={() => {
                    if (!item.disabled) {
                      item.onClick();
                      props.onClose();
                    }
                  }}
                  disabled={item.disabled}
                >
                  <Show when={item.icon}>
                    <span class="w-4 h-4 flex-shrink-0">{item.icon}</span>
                  </Show>
                  {item.label}
                </button>
              </>
            )}
          </For>
        </div>
      </Portal>
    </Show>
  );
}
