import { useState, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { useEmojiManifestStore } from '@/stores/emojiManifest';
import type { CustomEmoji, EmojiPack } from '@sgchat/shared';

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
  onSelect: (emoji: string, customEmojiId?: string) => void;
  anchorRef?: HTMLElement | null;
  position?: { x: number; y: number };
  serverId?: string;
}

const GRID_COLS = 8;

export function ReactionPicker({ isOpen, onClose, onSelect, anchorRef, position, serverId }: ReactionPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const gridRef = useRef<HTMLDivElement>(null);

  // Custom emoji packs from the manifest store (hooks must be called unconditionally)
  const manifest = useEmojiManifestStore((s) => serverId ? s.manifests.get(serverId) : undefined);
  const packs = manifest?.packs || [];
  const customEmojis = manifest?.emojis || [];

  // Whether the active tab is a custom pack
  const isCustomPackTab = activeCategory >= EMOJI_CATEGORIES.length;
  const activePackIndex = isCustomPackTab ? activeCategory - EMOJI_CATEGORIES.length : -1;
  const activePack = activePackIndex >= 0 ? packs[activePackIndex] : null;

  // Emojis for the currently selected custom pack
  const activePackEmojis = useMemo(() => {
    if (!activePack) return [];
    return customEmojis.filter((e) => e.pack_id === activePack.id);
  }, [activePack, customEmojis]);

  const filteredEmojis = useMemo(() => {
    if (!searchQuery) return null;
    return EMOJI_CATEGORIES.flatMap(cat => cat.emojis);
  }, [searchQuery]);

  // Custom emojis matching the search query (by shortcode)
  const filteredCustomEmojis = useMemo(() => {
    if (!searchQuery) return [];
    const q = searchQuery.toLowerCase();
    return customEmojis.filter((e) => e.shortcode.toLowerCase().includes(q));
  }, [searchQuery, customEmojis]);

  const currentEmojis = filteredEmojis || (isCustomPackTab ? [] : EMOJI_CATEGORIES[activeCategory]?.emojis || []);

  const handleEmojiClick = (emoji: string, customEmojiId?: string) => {
    onSelect(emoji, customEmojiId);
    onClose();
  };

  // Items currently displayed in the grid (combined unicode + custom for keyboard nav)
  const displayedCustomEmojis = searchQuery
    ? filteredCustomEmojis
    : isCustomPackTab
      ? activePackEmojis
      : [];
  const totalGridItems = currentEmojis.length + displayedCustomEmojis.length;

  const handleGridKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (totalGridItems === 0) return;

    let next = focusedIndex;

    switch (e.key) {
      case 'ArrowRight': next = Math.min(focusedIndex + 1, totalGridItems - 1); break;
      case 'ArrowLeft': next = Math.max(focusedIndex - 1, 0); break;
      case 'ArrowDown': next = Math.min(focusedIndex + GRID_COLS, totalGridItems - 1); break;
      case 'ArrowUp': next = Math.max(focusedIndex - GRID_COLS, 0); break;
      case 'Enter':
      case ' ':
        if (focusedIndex >= 0 && focusedIndex < totalGridItems) {
          e.preventDefault();
          if (focusedIndex < currentEmojis.length) {
            handleEmojiClick(currentEmojis[focusedIndex]);
          } else {
            const customIdx = focusedIndex - currentEmojis.length;
            const ce = displayedCustomEmojis[customIdx];
            if (ce) handleEmojiClick(`:${ce.shortcode}:`, ce.id);
          }
        }
        return;
      default: return;
    }

    e.preventDefault();
    setFocusedIndex(next);

    // Focus the button at the new index
    const buttons = gridRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
    buttons?.[next]?.focus();
  }, [focusedIndex, currentEmojis, displayedCustomEmojis, totalGridItems]);

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
            name="search-emojis"
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
              onClick={() => { setActiveCategory(index); setFocusedIndex(-1); }}
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
          {packs.map((pack, index) => (
            <button
              key={`pack-${pack.id}`}
              onClick={() => { setActiveCategory(EMOJI_CATEGORIES.length + index); setFocusedIndex(-1); }}
              className={clsx(
                "px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors",
                activeCategory === EMOJI_CATEGORIES.length + index
                  ? "text-brand-primary border-b-2 border-brand-primary"
                  : "text-text-muted hover:text-text-primary"
              )}
              title={pack.description || pack.name}
            >
              {pack.name}
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
            {/* Unicode emojis (from categories or search) */}
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
            {/* Custom emojis (from active pack or search) */}
            {displayedCustomEmojis.map((ce, i) => {
              const gridIndex = currentEmojis.length + i;
              return (
                <button
                  key={`custom-${ce.id}`}
                  role="option"
                  aria-selected={focusedIndex === gridIndex}
                  tabIndex={focusedIndex === gridIndex ? 0 : -1}
                  onClick={() => handleEmojiClick(`:${ce.shortcode}:`, ce.id)}
                  onFocus={() => setFocusedIndex(gridIndex)}
                  title={`:${ce.shortcode}:`}
                  className={clsx(
                    "w-8 h-8 flex items-center justify-center rounded hover:bg-bg-modifier-hover transition-colors",
                    focusedIndex === gridIndex && "bg-bg-modifier-hover ring-2 ring-brand-primary"
                  )}
                >
                  <img
                    src={ce.url || ce.asset_key}
                    alt={`:${ce.shortcode}:`}
                    className="w-6 h-6 object-contain"
                    loading="lazy"
                  />
                </button>
              );
            })}
          </div>
          {/* Empty state for custom pack tabs with no emojis */}
          {isCustomPackTab && activePackEmojis.length === 0 && !searchQuery && (
            <div className="flex items-center justify-center h-32 text-text-muted text-sm">
              No emojis in this pack
            </div>
          )}
          {/* Empty search state */}
          {searchQuery && currentEmojis.length === 0 && displayedCustomEmojis.length === 0 && (
            <div className="flex items-center justify-center h-32 text-text-muted text-sm">
              No emojis found
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
