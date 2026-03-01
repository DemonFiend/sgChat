import { useState, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡', '🎉', '🔥', '👀', '💯'];

const EMOJI_CATEGORIES = [
  {
    name: 'Smileys',
    emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😝', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😮‍💨', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷']
  },
  {
    name: 'Gestures',
    emojis: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏']
  },
  {
    name: 'Hearts',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟']
  },
  {
    name: 'Objects',
    emojis: ['🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '🥈', '🥉', '⭐', '🌟', '💫', '✨', '🔥', '💥', '💢', '💯', '💤', '💨', '💦', '🎵', '🎶', '🔔', '🔕', '📢', '📣']
  },
  {
    name: 'Animals',
    emojis: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄']
  }
];

interface ReactionPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (emoji: string) => void;
  anchorRef?: HTMLElement | null;
  position?: { x: number; y: number };
}

const GRID_COLS = 8;

export function ReactionPicker({ isOpen, onClose, onSelect, anchorRef, position }: ReactionPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const gridRef = useRef<HTMLDivElement>(null);

  const filteredEmojis = useMemo(() => {
    if (!searchQuery) return null;
    return EMOJI_CATEGORIES.flatMap(cat => cat.emojis);
  }, [searchQuery]);

  const currentEmojis = filteredEmojis || EMOJI_CATEGORIES[activeCategory]?.emojis || [];

  const handleEmojiClick = (emoji: string) => {
    onSelect(emoji);
    onClose();
  };

  const handleGridKeyDown = useCallback((e: React.KeyboardEvent) => {
    const total = currentEmojis.length;
    if (total === 0) return;

    let next = focusedIndex;

    switch (e.key) {
      case 'ArrowRight': next = Math.min(focusedIndex + 1, total - 1); break;
      case 'ArrowLeft': next = Math.max(focusedIndex - 1, 0); break;
      case 'ArrowDown': next = Math.min(focusedIndex + GRID_COLS, total - 1); break;
      case 'ArrowUp': next = Math.max(focusedIndex - GRID_COLS, 0); break;
      case 'Enter':
      case ' ':
        if (focusedIndex >= 0 && focusedIndex < total) {
          e.preventDefault();
          handleEmojiClick(currentEmojis[focusedIndex]);
        }
        return;
      default: return;
    }

    e.preventDefault();
    setFocusedIndex(next);

    // Focus the button at the new index
    const buttons = gridRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
    buttons?.[next]?.focus();
  }, [focusedIndex, currentEmojis]);

  const getPosition = () => {
    if (position) {
      return { top: `${position.y}px`, left: `${position.x}px` };
    }
    if (anchorRef) {
      const rect = anchorRef.getBoundingClientRect();
      return {
        top: `${rect.top - 340}px`,
        left: `${Math.max(8, rect.left - 150)}px`
      };
    }
    return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="absolute bg-bg-secondary rounded-lg shadow-xl border border-border-subtle overflow-hidden w-80"
        style={getPosition()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search */}
        <div className="p-2 border-b border-border-subtle">
          <input
            type="text"
            placeholder="Search emojis..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-1.5 bg-bg-tertiary border border-border-subtle rounded text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-brand-primary"
          />
        </div>

        {/* Quick Access */}
        <div className="p-2 border-b border-border-subtle">
          <div className="text-xs font-semibold uppercase text-text-muted mb-1.5">Quick Reactions</div>
          <div className="flex flex-wrap gap-1">
            {QUICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleEmojiClick(emoji)}
                className="w-8 h-8 flex items-center justify-center text-xl rounded hover:bg-bg-modifier-hover transition-colors"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex border-b border-border-subtle overflow-x-auto scrollbar-none">
          {EMOJI_CATEGORIES.map((category, index) => (
            <button
              key={category.name}
              onClick={() => setActiveCategory(index)}
              className={clsx(
                "px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors",
                activeCategory === index
                  ? "text-brand-primary border-b-2 border-brand-primary"
                  : "text-text-muted hover:text-text-primary"
              )}
            >
              {category.name}
            </button>
          ))}
        </div>

        {/* Emoji Grid */}
        <div
          ref={gridRef}
          className="h-48 overflow-y-auto p-2"
          role="listbox"
          aria-label="Emojis"
          onKeyDown={handleGridKeyDown}
        >
          <div className="grid grid-cols-8 gap-1">
            {currentEmojis.map((emoji, i) => (
              <button
                key={`${emoji}-${i}`}
                role="option"
                aria-selected={focusedIndex === i}
                tabIndex={focusedIndex === i ? 0 : -1}
                onClick={() => handleEmojiClick(emoji)}
                onFocus={() => setFocusedIndex(i)}
                className={clsx(
                  "w-8 h-8 flex items-center justify-center text-xl rounded hover:bg-bg-modifier-hover transition-colors",
                  focusedIndex === i && "bg-bg-modifier-hover ring-2 ring-brand-primary"
                )}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
