import { useState, useEffect, useCallback, useRef } from 'react';
import { Avatar } from '@/components/ui/Avatar';

export interface AutocompleteItem {
  id: string;
  type: 'user' | 'channel' | 'role' | 'here' | 'everyone' | 'stime' | 'motd';
  label: string;
  sublabel?: string;
  insertText: string;
  wireFormat: string;
  color?: string;
  avatarUrl?: string | null;
}

export interface MentionAutocompleteProps {
  query: string;
  triggerType: '@' | '#' | null;
  items: AutocompleteItem[];
  onSelect: (item: AutocompleteItem) => void;
  onClose: () => void;
}

export function MentionAutocomplete({
  query,
  triggerType,
  items,
  onSelect,
  onClose,
}: MentionAutocompleteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter items by query
  const filtered = items.filter((item) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      item.label.toLowerCase().includes(q) ||
      (item.sublabel && item.sublabel.toLowerCase().includes(q))
    );
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
      const items = listRef.current.querySelectorAll('[data-autocomplete-item]');
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

  // Expose handleKeyDown so parent can call it
  // We use a ref pattern since this is a controlled component
  useEffect(() => {
    (MentionAutocomplete as any)._handleKeyDown = handleKeyDown;
    return () => {
      (MentionAutocomplete as any)._handleKeyDown = null;
    };
  }, [handleKeyDown]);

  if (!triggerType || visible.length === 0) return null;

  const getIcon = (item: AutocompleteItem) => {
    if (item.type === 'user') {
      return <Avatar src={item.avatarUrl} alt={item.label} size="xs" />;
    }
    if (item.type === 'channel') {
      return (
        <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
        </svg>
      );
    }
    if (item.type === 'role') {
      return (
        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: item.color || '#99aab5' }} />
      );
    }
    if (item.type === 'here' || item.type === 'everyone') {
      return (
        <svg className="w-4 h-4 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      );
    }
    if (item.type === 'stime') {
      return (
        <svg className="w-4 h-4 text-brand-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    }
    if (item.type === 'motd') {
      return (
        <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
        </svg>
      );
    }
    return null;
  };

  return (
    <div
      className="absolute bottom-full left-0 right-0 mb-1 bg-bg-floating border border-border rounded-lg shadow-xl max-h-64 overflow-y-auto z-50"
      ref={listRef}
    >
      {visible.map((item, i) => (
        <div
          key={`${item.type}-${item.id}`}
          data-autocomplete-item
          className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors ${
            i === selectedIndex ? 'bg-brand-primary/20 text-text-primary' : 'text-text-secondary hover:bg-bg-modifier-hover'
          }`}
          onClick={() => onSelect(item)}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
            {getIcon(item)}
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium truncate" style={item.color ? { color: item.color } : undefined}>
              {item.label}
            </span>
            {item.sublabel && (
              <span className="text-xs text-text-muted ml-1.5">{item.sublabel}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Build autocomplete items for @ trigger (users + specials).
 */
export function buildAtItems(
  members: { id: string; username: string; display_name: string | null; avatar_url: string | null; role_color?: string | null }[],
  roles: { id: string; name: string; color: string | null; is_mentionable?: boolean }[],
): AutocompleteItem[] {
  const items: AutocompleteItem[] = [];

  // Special entries first
  items.push({
    id: '_here',
    type: 'here',
    label: '@here',
    sublabel: 'Notify online members',
    insertText: '@here',
    wireFormat: '@here',
  });
  items.push({
    id: '_everyone',
    type: 'everyone',
    label: '@everyone',
    sublabel: 'Notify all members',
    insertText: '@everyone',
    wireFormat: '@everyone',
  });
  items.push({
    id: '_stime',
    type: 'stime',
    label: '@stime',
    sublabel: 'Insert server time tag',
    insertText: '@stime',
    wireFormat: '', // handled specially
  });
  items.push({
    id: '_motd',
    type: 'motd',
    label: '@motd',
    sublabel: 'Message of the Day',
    insertText: '<motd>',
    wireFormat: '<motd>',
  });

  // Roles
  for (const role of roles) {
    items.push({
      id: role.id,
      type: 'role',
      label: `@${role.name}`,
      insertText: `@${role.name}`,
      wireFormat: `<@&${role.id}>`,
      color: role.color || undefined,
    });
  }

  // Members
  for (const m of members) {
    items.push({
      id: m.id,
      type: 'user',
      label: m.display_name || m.username,
      sublabel: m.display_name ? `@${m.username}` : undefined,
      insertText: `@${m.display_name || m.username}`,
      wireFormat: `<@${m.id}>`,
      avatarUrl: m.avatar_url,
      color: m.role_color || undefined,
    });
  }

  return items;
}

/**
 * Build autocomplete items for # trigger (channels).
 */
export function buildChannelItems(
  channels: { id: string; name: string; type: string }[],
): AutocompleteItem[] {
  return channels
    .filter((c) => c.type === 'text')
    .map((c) => ({
      id: c.id,
      type: 'channel' as const,
      label: `#${c.name}`,
      insertText: `#${c.name}`,
      wireFormat: `<#${c.id}>`,
    }));
}

/**
 * Detect mention trigger from text and cursor position.
 * Returns the trigger info or null if no trigger is active.
 */
export function detectTrigger(
  text: string,
  cursorPos: number,
): { triggerType: '@' | '#'; triggerStart: number; query: string } | null {
  // Scan backwards from cursor to find @ or #
  let i = cursorPos - 1;
  while (i >= 0) {
    const char = text[i];

    // Stop at whitespace or newline
    if (char === ' ' || char === '\n' || char === '\r' || char === '\t') {
      return null;
    }

    if (char === '@' || char === '#') {
      // Must be at start of text or preceded by whitespace
      if (i === 0 || /\s/.test(text[i - 1])) {
        const query = text.slice(i + 1, cursorPos);
        return {
          triggerType: char as '@' | '#',
          triggerStart: i,
          query,
        };
      }
      return null;
    }

    i--;
  }

  return null;
}
