import { useEffect, useRef, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  warning?: boolean;
  disabled?: boolean;
  separator?: boolean;
  customRender?: () => ReactNode;
}

interface UserContextMenuProps {
  isOpen: boolean;
  onClose: () => void;
  position: { x: number; y: number };
  items: ContextMenuItem[];
}

export function UserContextMenu({ isOpen, onClose, position, items }: UserContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const raf = requestAnimationFrame(() => {
      document.addEventListener('mousedown', handleClickOutside);
    });

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
      cancelAnimationFrame(raf);
    };
  }, [isOpen, onClose]);

  const adjustedPosition = useMemo(() => {
    const menuWidth = 220;
    const menuHeight = items.length * 36;
    const x = Math.min(position.x, window.innerWidth - menuWidth - 8);
    const y = Math.min(position.y, window.innerHeight - menuHeight - 8);
    return { x: Math.max(8, x), y: Math.max(8, y) };
  }, [position, items.length]);

  if (!isOpen) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[100] min-w-[200px] py-1.5 bg-bg-tertiary rounded-md shadow-lg border border-divider"
      style={{
        left: `${adjustedPosition.x}px`,
        top: `${adjustedPosition.y}px`,
      }}
    >
      {items.map((item, index) => (
        <div key={index}>
          {item.separator && (
            <div className="my-1 mx-2 border-t border-divider" />
          )}
          {item.customRender ? (
            <div className="px-3 py-1.5">{item.customRender()}</div>
          ) : (
            <button
              className={`flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left transition-colors ${
                item.disabled
                  ? 'text-text-muted cursor-not-allowed opacity-50'
                  : item.danger
                    ? 'text-danger hover:bg-danger/10'
                    : item.warning
                      ? 'text-yellow-500 hover:bg-yellow-500/10'
                      : 'text-text-secondary hover:bg-bg-modifier-hover hover:text-text-primary'
              }`}
              onClick={() => {
                if (!item.disabled) {
                  item.onClick();
                  onClose();
                }
              }}
              disabled={item.disabled}
            >
              {item.icon && (
                <span className="w-4 h-4 flex-shrink-0">{item.icon}</span>
              )}
              {item.label}
            </button>
          )}
        </div>
      ))}
    </div>,
    document.body
  );
}
