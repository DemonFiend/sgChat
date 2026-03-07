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
      className={clsx('w-3 h-3 flex-shrink-0 transition-transform', expanded && 'rotate-180')}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
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
  const [activeCategoryId, setActiveCategoryId] = useState('');
  const [expandedPacks, setExpandedPacks] = useState<Set<string>>(new Set());
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

  // Packs in the active category
  const activeCategoryPacks = useMemo(() => {
    const cat = categories.find((c) => c.id === activeCategoryId);
    if (!cat) return [];
    return cat.items;
  }, [categories, activeCategoryId]);

  // Reset state when picker opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Initialize active category and expand all packs when categories change
  useEffect(() => {
    if (isOpen && categories.length > 0) {
      if (!categories.some((c) => c.id === activeCategoryId)) {
        setActiveCategoryId(categories[0].id);
      }
      // Expand all packs by default
      const allPackIds = categories.flatMap((c) => c.items.map((i) => i.id));
      setExpandedPacks(new Set(allPackIds));
    }
  }, [isOpen, categories]);

  const togglePack = (packId: string) => {
    setExpandedPacks((prev) => {
      const next = new Set(prev);
      if (next.has(packId)) {
        next.delete(packId);
      } else {
        next.add(packId);
      }
      return next;
    });
  };

  // Search results for custom mode
  const searchResults = useMemo(() => {
    if (!searchQuery || !hasCustomPacks) return [];
    const q = searchQuery.toLowerCase();
    return customEmojis.filter((e) => e.shortcode.toLowerCase().includes(q));
  }, [searchQuery, hasCustomPacks, customEmojis]);

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

        {/* Body: sidebar + content */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar — category names only */}
          <div className="w-28 flex-shrink-0 border-r border-border-subtle overflow-y-auto scrollbar-thin">
            {unicodeMode ? (
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
              categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => {
                    setActiveCategoryId(cat.id);
                    setSearchQuery('');
                  }}
                  className={clsx(
                    'w-full px-2 py-2 text-xs text-left truncate transition-colors',
                    activeCategoryId === cat.id
                      ? 'bg-bg-modifier-selected text-text-primary font-semibold'
                      : 'text-text-muted hover:bg-bg-modifier-hover hover:text-text-primary',
                  )}
                  title={cat.label}
                >
                  {cat.label}
                </button>
              ))
            )}
          </div>

          {/* Right panel — packs as collapsible sections */}
          <div className="flex-1 overflow-y-auto p-2">
            {/* Search mode */}
            {searchQuery ? (
              <>
                {hasCustomPacks ? (
                  <>
                    <div className="text-xs font-semibold text-text-muted uppercase mb-2 px-1">
                      {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {searchResults.map((ce) => (
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
                    {searchResults.length === 0 && (
                      <div className="flex items-center justify-center h-32 text-text-muted text-sm">
                        No emojis found
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="text-xs font-semibold text-text-muted uppercase mb-2 px-1">
                      All Emojis
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {EMOJI_CATEGORIES.flatMap((c) => c.emojis).map((emoji, i) => (
                        <button
                          key={`${emoji}-${i}`}
                          onClick={() => handleEmojiClick(emoji)}
                          className="w-8 h-8 flex items-center justify-center text-xl rounded hover:bg-bg-modifier-hover transition-colors"
                          title={emoji}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : unicodeMode ? (
              /* Unicode mode — flat grid for active category */
              <>
                <div className="text-xs font-semibold text-text-muted uppercase mb-2 px-1">
                  {activeUnicodeCategory}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {(EMOJI_CATEGORIES.find((c) => c.name === activeUnicodeCategory)?.emojis || []).map(
                    (emoji, i) => (
                      <button
                        key={`${emoji}-${i}`}
                        onClick={() => handleEmojiClick(emoji)}
                        className="w-8 h-8 flex items-center justify-center text-xl rounded hover:bg-bg-modifier-hover transition-colors"
                        title={emoji}
                      >
                        {emoji}
                      </button>
                    ),
                  )}
                </div>
              </>
            ) : (
              /* Custom mode — collapsible pack sections */
              <>
                {activeCategoryPacks.length === 0 && (
                  <div className="flex items-center justify-center h-32 text-text-muted text-sm">
                    No packs in this category
                  </div>
                )}
                {activeCategoryPacks.map((pack) => {
                  const isExpanded = expandedPacks.has(pack.id);
                  const packEmojis = customEmojis.filter((e) => e.pack_id === pack.id);
                  return (
                    <div key={pack.id} className="mb-1">
                      {/* Pack header — click to expand/collapse */}
                      <button
                        onClick={() => togglePack(pack.id)}
                        className="w-full flex items-center justify-between px-1 py-1.5 text-xs font-semibold text-text-muted hover:text-text-primary transition-colors rounded hover:bg-bg-modifier-hover"
                      >
                        <span className="truncate">{pack.label}</span>
                        <ChevronIcon expanded={isExpanded} />
                      </button>

                      {/* Emoji grid — shown when expanded */}
                      {isExpanded && (
                        <div className="grid grid-cols-7 gap-1 pb-1">
                          {packEmojis.map((ce) => (
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
                          {packEmojis.length === 0 && (
                            <div className="col-span-7 text-center py-4 text-text-muted text-xs">
                              No emojis in this pack
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
