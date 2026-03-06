import { useState, useEffect, useCallback, useRef } from 'react';
import type { SlashCommand } from '@sgchat/shared';

export interface CommandAutocompleteProps {
  query: string;
  commands: SlashCommand[];
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
}

export function CommandAutocomplete({
  query,
  commands,
  onSelect,
  onClose,
}: CommandAutocompleteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter commands by query (the text after `/`)
  const filtered = commands.filter((cmd) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return cmd.name.toLowerCase().startsWith(q) || cmd.description.toLowerCase().includes(q);
  });

  // Cap at 10 results
  const visible = filtered.slice(0, 10);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && selectedIndex >= 0) {
      const items = listRef.current.querySelectorAll('[data-command-item]');
      items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Keyboard navigation — handled by parent calling handleKeyDown
  const handleKeyDown = useCallback(
    (e: KeyboardEvent | React.KeyboardEvent) => {
      if (visible.length === 0) return false;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % visible.length);
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + visible.length) % visible.length);
        return true;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        if (visible[selectedIndex]) {
          onSelect(visible[selectedIndex]);
        }
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return true;
      }
      return false;
    },
    [visible, selectedIndex, onSelect, onClose],
  );

  // Expose handleKeyDown so parent can call it
  useEffect(() => {
    (CommandAutocomplete as any)._handleKeyDown = handleKeyDown;
    return () => {
      (CommandAutocomplete as any)._handleKeyDown = null;
    };
  }, [handleKeyDown]);

  if (visible.length === 0) return null;

  return (
    <div
      className="absolute bottom-full left-0 right-0 mb-1 bg-bg-floating border border-border rounded-lg shadow-xl max-h-64 overflow-y-auto z-50"
      ref={listRef}
    >
      <div className="px-3 py-1.5 text-xs font-semibold text-text-muted uppercase tracking-wide border-b border-border">
        Slash Commands
      </div>
      {visible.map((cmd, i) => (
        <div
          key={cmd.name}
          data-command-item
          className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors ${
            i === selectedIndex
              ? 'bg-brand-primary/20 text-text-primary'
              : 'text-text-secondary hover:bg-bg-modifier-hover'
          }`}
          onClick={() => onSelect(cmd)}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
            <svg
              className="w-4 h-4 text-brand-primary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 5l7 7-7 7"
              />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-text-primary">/{cmd.name}</span>
            <span className="text-xs text-text-muted ml-2">{cmd.description}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
