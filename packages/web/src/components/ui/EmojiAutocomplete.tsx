import { useState, useEffect, useCallback, useRef } from 'react';
import type { CustomEmoji } from '@sgchat/shared';

export interface EmojiAutocompleteProps {
  query: string;
  emojis: CustomEmoji[];
  onSelect: (emoji: CustomEmoji) => void;
  onClose: () => void;
}

export function EmojiAutocomplete({
  query,
  emojis,
  onSelect,
  onClose,
}: EmojiAutocompleteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = emojis.filter((e) => {
    if (!query) return true;
    return e.shortcode.toLowerCase().includes(query.toLowerCase());
  });

  const visible = filtered.slice(0, 10);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (listRef.current && selectedIndex >= 0) {
      const items = listRef.current.querySelectorAll('[data-autocomplete-item]');
      items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

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
      if (e.key === 'Enter' || e.key === 'Tab') {
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

  useEffect(() => {
    (EmojiAutocomplete as any)._handleKeyDown = handleKeyDown;
    return () => {
      (EmojiAutocomplete as any)._handleKeyDown = null;
    };
  }, [handleKeyDown]);

  if (visible.length === 0) return null;

  return (
    <div
      className="absolute bottom-full left-0 right-0 mb-1 bg-bg-floating border border-border rounded-lg shadow-xl max-h-64 overflow-y-auto z-50"
      ref={listRef}
    >
      {visible.map((emoji, i) => (
        <div
          key={emoji.id}
          data-autocomplete-item
          className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors ${
            i === selectedIndex
              ? 'bg-brand-primary/20 text-text-primary'
              : 'text-text-secondary hover:bg-bg-modifier-hover'
          }`}
          onClick={() => onSelect(emoji)}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <img
            src={emoji.url || emoji.asset_key}
            alt={emoji.shortcode}
            className="w-5 h-5 object-contain flex-shrink-0"
            loading="lazy"
          />
          <span className="text-sm font-medium truncate">:{emoji.shortcode}:</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Detect emoji trigger from text and cursor position.
 * Triggers when user types `:` followed by at least 2 characters.
 */
export function detectEmojiTrigger(
  text: string,
  cursorPos: number,
): { triggerStart: number; query: string } | null {
  let i = cursorPos - 1;
  while (i >= 0) {
    const char = text[i];

    // Stop at whitespace or newline
    if (char === ' ' || char === '\n' || char === '\r' || char === '\t') {
      return null;
    }

    if (char === ':') {
      // Check this isn't the closing colon of a completed :shortcode:
      // A completed shortcode would have another : before this one in the same word
      const beforeColon = text.slice(0, i);
      const lastColonBefore = beforeColon.lastIndexOf(':');
      if (lastColonBefore >= 0) {
        const between = text.slice(lastColonBefore + 1, i);
        // If there's no whitespace between the two colons, this is a closing colon
        if (!/\s/.test(between) && between.length >= 2) {
          return null;
        }
      }

      const query = text.slice(i + 1, cursorPos);
      // Require at least 2 chars to trigger
      if (query.length < 2) return null;

      return { triggerStart: i, query };
    }

    i--;
  }

  return null;
}
