import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { useEmojiManifestStore } from '@/stores/emojiManifest';
import type { CustomEmoji, EmojiPack } from '@sgchat/shared';

const EMOJI_CATEGORIES = [
  {
    name: 'Smileys',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😊', '😇', '🥰', '😍', '🤩',
      '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😝', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨',
      '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😮‍💨', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷',
    ],
  },
  {
    name: 'Gestures',
    emojis: [
      '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈',
      '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐',
      '🤲', '🤝', '🙏',
    ],
  },
  {
    name: 'Hearts',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓',
      '💗', '💖', '💘', '💝', '💟',
    ],
  },
  {
    name: 'Objects',
    emojis: [
      '🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '🥈', '🥉', '⭐', '🌟', '💫', '✨', '🔥', '💥',
      '💢', '💯', '💤', '💨', '💦', '🎵', '🎶', '🔔', '🔕', '📢', '📣',
    ],
  },
  {
    name: 'Animals',
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸',
      '🐵', '🙈', '🙉', '🙊', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗',
      '🐴', '🦄',
    ],
  },
];

interface ReactionPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (emoji: string, customEmojiId?: string) => void;
  anchorRef?: HTMLElement | null;
  position?: { x: number; y: number };
  serverId?: string;
}

interface SidebarCategory {
  id: string;
  label: string;
  items: { id: string; label: string }[];
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={clsx('w-3 h-3 flex-shrink-0 transition-transform', expanded && 'rotate-90')}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function getCategoryFromPack(pack: EmojiPack): string {
  if (pack.source === 'default' && pack.default_pack_key) {
    return pack.default_pack_key.split('/')[0];
  }
  return 'Custom';
}

export function ReactionPicker({
  isOpen,
  onClose,
  onSelect,
  anchorRef,
  position,
  serverId,
}: ReactionPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activePackId, setActivePackId] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  const manifest = useEmojiManifestStore((s) =>
    serverId ? s.manifests.get(serverId) : undefined,
  );
  const packs = manifest?.packs || [];
  const customEmojis = manifest?.emojis || [];
  const hasCustomPacks = packs.length > 0;

  // Build hierarchical categories from packs
  const categories = useMemo<SidebarCategory[]>(() => {
    if (!hasCustomPacks) return [];

    const catMap = new Map<string, SidebarCategory>();

    for (const pack of packs) {
      const catName = getCategoryFromPack(pack);
      if (!catMap.has(catName)) {
        catMap.set(catName, { id: catName, label: catName, items: [] });
      }
      catMap.get(catName)!.items.push({ id: pack.id, label: pack.name });
    }

    return Array.from(catMap.values());
  }, [packs, hasCustomPacks]);

  // Unicode fallback categories (when no custom packs)
  const unicodeMode = !hasCustomPacks;
  const [activeUnicodeCategory, setActiveUnicodeCategory] = useState(EMOJI_CATEGORIES[0]?.name || '');

  // Reset state when picker opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Initialize expanded categories and active pack when categories change
  useEffect(() => {
    if (isOpen && categories.length > 0) {
      setExpandedCategories(new Set(categories.map((c) => c.id)));
      // Select first pack if current selection is invalid
      const allPackIds = categories.flatMap((c) => c.items.map((i) => i.id));
      if (!allPackIds.includes(activePackId) && allPackIds.length > 0) {
        setActivePackId(allPackIds[0]);
      }
    }
  }, [isOpen, categories]);

  const toggleCategory = (catId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) {
        next.delete(catId);
      } else {
        next.add(catId);
      }
      return next;
    });
  };

  // Displayed emojis based on selection
  const displayedEmojis = useMemo<{
    type: 'custom' | 'unicode';
    custom: CustomEmoji[];
    unicode: string[];
    header: string;
  }>(() => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (hasCustomPacks) {
        return {
          type: 'custom',
          custom: customEmojis.filter((e) => e.shortcode.toLowerCase().includes(q)),
          unicode: [],
          header: 'Search Results',
        };
      }
      return {
        type: 'unicode',
        custom: [],
        unicode: EMOJI_CATEGORIES.flatMap((c) => c.emojis),
        header: 'All Emojis',
      };
    }

    if (hasCustomPacks) {
      const pack = packs.find((p) => p.id === activePackId);
      return {
        type: 'custom',
        custom: customEmojis.filter((e) => e.pack_id === activePackId),
        unicode: [],
        header: pack?.name || '',
      };
    }

    const cat = EMOJI_CATEGORIES.find((c) => c.name === activeUnicodeCategory);
    return { type: 'unicode', custom: [], unicode: cat?.emojis || [], header: cat?.name || '' };
  }, [searchQuery, activePackId, activeUnicodeCategory, hasCustomPacks, customEmojis, packs]);

  const handleEmojiClick = (emoji: string, customEmojiId?: string) => {
    onSelect(emoji, customEmojiId);
    onClose();
  };

  const getPositionStyle = (): React.CSSProperties => {
    if (anchorRef) {
      const rect = anchorRef.getBoundingClientRect();
      const pickerWidth = 420;
      const pickerHeight = 420;

      let right = Math.max(8, window.innerWidth - rect.right);
      if (window.innerWidth - right - pickerWidth < 8) {
        right = window.innerWidth - pickerWidth - 8;
      }

      let bottom = window.innerHeight - rect.top + 8;
      if (bottom + pickerHeight > window.innerHeight - 8) {
        bottom = window.innerHeight - rect.bottom - 8;
      }

      return { position: 'fixed', bottom, right, zIndex: 60 };
    }
    if (position) {
      return {
        position: 'fixed',
        bottom: Math.max(8, window.innerHeight - position.y),
        right: Math.max(8, window.innerWidth - position.x),
        zIndex: 60,
      };
    }
    return { position: 'fixed', bottom: 80, right: 20, zIndex: 60 };
  };

  if (!isOpen) return null;

  const totalItems = displayedEmojis.custom.length + displayedEmojis.unicode.length;

  return createPortal(
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        style={getPositionStyle()}
        onClick={(e) => e.stopPropagation()}
        className="w-[420px] h-[420px] bg-bg-secondary rounded-lg shadow-xl border border-border-subtle flex flex-col overflow-hidden"
      >
        {/* Search */}
        <div className="p-2 border-b border-border-subtle flex-shrink-0">
          <input
            ref={inputRef}
            type="text"
            name="search-emojis"
            placeholder="Search emojis..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-1.5 bg-bg-tertiary border border-border-subtle rounded text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-brand-primary"
          />
        </div>

        {/* Body: sidebar + grid */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <div className="w-28 flex-shrink-0 border-r border-border-subtle overflow-y-auto scrollbar-thin">
            {unicodeMode ? (
              // Unicode fallback: flat category list
              EMOJI_CATEGORIES.map((cat) => (
                <button
                  key={cat.name}
                  onClick={() => {
                    setActiveUnicodeCategory(cat.name);
                    setSearchQuery('');
                  }}
                  className={clsx(
                    'w-full px-2 py-2 text-xs text-left truncate transition-colors',
                    activeUnicodeCategory === cat.name
                      ? 'bg-bg-modifier-selected text-text-primary font-semibold'
                      : 'text-text-muted hover:bg-bg-modifier-hover hover:text-text-primary',
                  )}
                  title={cat.name}
                >
                  {cat.name}
                </button>
              ))
            ) : (
              // Custom packs: expandable categories
              categories.map((cat) => (
                <div key={cat.id}>
                  {/* Category header */}
                  <button
                    onClick={() => toggleCategory(cat.id)}
                    className="w-full px-2 py-1.5 text-[10px] font-bold uppercase text-text-muted hover:text-text-primary flex items-center gap-1 transition-colors"
                    title={cat.label}
                  >
                    <ChevronIcon expanded={expandedCategories.has(cat.id)} />
                    <span className="truncate">{cat.label}</span>
                  </button>

                  {/* Pack items */}
                  {expandedCategories.has(cat.id) &&
                    cat.items.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => {
                          setActivePackId(item.id);
                          setSearchQuery('');
                        }}
                        className={clsx(
                          'w-full pl-5 pr-2 py-1.5 text-xs text-left truncate transition-colors',
                          activePackId === item.id
                            ? 'bg-bg-modifier-selected text-text-primary font-semibold'
                            : 'text-text-muted hover:bg-bg-modifier-hover hover:text-text-primary',
                        )}
                        title={item.label}
                      >
                        {item.label}
                      </button>
                    ))}
                </div>
              ))
            )}
          </div>

          {/* Emoji grid area */}
          <div className="flex-1 overflow-y-auto p-2">
            {/* Header */}
            {!searchQuery && displayedEmojis.header && (
              <div className="text-xs font-semibold text-text-muted uppercase mb-2 px-1">
                {displayedEmojis.header}
              </div>
            )}
            {searchQuery && (
              <div className="text-xs font-semibold text-text-muted uppercase mb-2 px-1">
                {totalItems} result{totalItems !== 1 ? 's' : ''}
              </div>
            )}

            {/* Grid */}
            <div className="grid grid-cols-7 gap-1">
              {displayedEmojis.unicode.map((emoji, i) => (
                <button
                  key={`${emoji}-${i}`}
                  onClick={() => handleEmojiClick(emoji)}
                  className="w-8 h-8 flex items-center justify-center text-xl rounded hover:bg-bg-modifier-hover transition-colors"
                  title={emoji}
                >
                  {emoji}
                </button>
              ))}
              {displayedEmojis.custom.map((ce) => (
                <button
                  key={ce.id}
                  onClick={() => handleEmojiClick(`:${ce.shortcode}:`, ce.id)}
                  className="w-8 h-8 flex items-center justify-center rounded hover:bg-bg-modifier-hover transition-colors"
                  title={`:${ce.shortcode}:`}
                >
                  <img
                    src={ce.url || ce.asset_key}
                    alt={`:${ce.shortcode}:`}
                    className="w-6 h-6 object-contain"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>

            {/* Empty state */}
            {totalItems === 0 && (
              <div className="flex items-center justify-center h-32 text-text-muted text-sm">
                {searchQuery ? 'No emojis found' : 'No emojis in this pack'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
