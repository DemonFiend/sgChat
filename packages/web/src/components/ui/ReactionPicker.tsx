import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { useEmojiManifestStore } from '@/stores/emojiManifest';
import type { CustomEmoji } from '@sgchat/shared';

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

interface SidebarItem {
  id: string;
  label: string;
  type: 'default-group' | 'custom-pack' | 'unicode';
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
  const [activeSection, setActiveSection] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const manifest = useEmojiManifestStore((s) =>
    serverId ? s.manifests.get(serverId) : undefined,
  );
  const packs = manifest?.packs || [];
  const customEmojis = manifest?.emojis || [];
  const hasCustomPacks = packs.length > 0;

  const defaultPacks = useMemo(() => packs.filter((p) => p.source === 'default'), [packs]);
  const customPacksList = useMemo(() => packs.filter((p) => p.source === 'custom'), [packs]);

  const defaultPackIds = useMemo(
    () => new Set(defaultPacks.map((p) => p.id)),
    [defaultPacks],
  );
  const defaultPackEmojis = useMemo(
    () => customEmojis.filter((e) => defaultPackIds.has(e.pack_id)),
    [customEmojis, defaultPackIds],
  );

  const sidebarItems = useMemo<SidebarItem[]>(() => {
    if (hasCustomPacks) {
      const items: SidebarItem[] = [];
      if (defaultPacks.length > 0) {
        items.push({ id: 'default', label: 'Default', type: 'default-group' });
      }
      for (const pack of customPacksList) {
        items.push({ id: pack.id, label: pack.name, type: 'custom-pack' });
      }
      return items;
    }
    return EMOJI_CATEGORIES.map((cat) => ({
      id: cat.name,
      label: cat.name,
      type: 'unicode' as const,
    }));
  }, [hasCustomPacks, defaultPacks, customPacksList]);

  // Reset state when picker opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Set activeSection to first sidebar item when items change or picker opens
  useEffect(() => {
    if (isOpen && sidebarItems.length > 0 && !sidebarItems.find((i) => i.id === activeSection)) {
      setActiveSection(sidebarItems[0].id);
    }
  }, [isOpen, sidebarItems]);

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
      if (activeSection === 'default') {
        return { type: 'custom', custom: defaultPackEmojis, unicode: [], header: 'Default Emojis' };
      }
      const pack = customPacksList.find((p) => p.id === activeSection);
      return {
        type: 'custom',
        custom: customEmojis.filter((e) => e.pack_id === activeSection),
        unicode: [],
        header: pack?.name || '',
      };
    }

    const cat = EMOJI_CATEGORIES.find((c) => c.name === activeSection);
    return { type: 'unicode', custom: [], unicode: cat?.emojis || [], header: cat?.name || '' };
  }, [searchQuery, activeSection, hasCustomPacks, customEmojis, defaultPackEmojis, customPacksList]);

  const handleEmojiClick = (emoji: string, customEmojiId?: string) => {
    onSelect(emoji, customEmojiId);
    onClose();
  };

  const getPositionStyle = (): React.CSSProperties => {
    if (anchorRef) {
      const rect = anchorRef.getBoundingClientRect();
      const pickerWidth = 400;
      const pickerHeight = 420;

      // Position above the anchor, right-aligned
      let right = Math.max(8, window.innerWidth - rect.right);
      // Ensure picker doesn't go off left edge
      if (window.innerWidth - right - pickerWidth < 8) {
        right = window.innerWidth - pickerWidth - 8;
      }

      let bottom = window.innerHeight - rect.top + 8;
      // If picker would go off top edge, position below instead
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
        className="w-[400px] h-[420px] bg-bg-secondary rounded-lg shadow-xl border border-border-subtle flex flex-col overflow-hidden"
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
          <div className="w-20 flex-shrink-0 border-r border-border-subtle overflow-y-auto scrollbar-thin">
            {sidebarItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setActiveSection(item.id);
                  setSearchQuery('');
                }}
                className={clsx(
                  'w-full px-2 py-2 text-xs text-left truncate transition-colors',
                  activeSection === item.id
                    ? 'bg-bg-modifier-selected text-text-primary font-semibold'
                    : 'text-text-muted hover:bg-bg-modifier-hover hover:text-text-primary',
                )}
                title={item.label}
              >
                {item.label}
              </button>
            ))}
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
