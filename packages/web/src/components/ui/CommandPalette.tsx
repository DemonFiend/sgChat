import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { clsx } from 'clsx';
import { fadeIn, scaleIn, springTransition, easeTransition } from '@/lib/motion';
import { Avatar } from './Avatar';

// ── Types ─────────────────────────────────────────────────

export interface CommandPaletteChannel {
  id: string;
  name: string;
  type: 'text' | 'voice' | 'stage';
  category_id?: string | null;
}

export interface CommandPaletteMember {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  status?: 'online' | 'idle' | 'dnd' | 'offline';
  role_color?: string | null;
}

type ResultType = 'text-channel' | 'voice-channel' | 'user' | 'action';

interface PaletteResult {
  id: string;
  type: ResultType;
  label: string;
  sublabel?: string;
  data?: any;
}

interface QuickAction {
  id: string;
  label: string;
  sublabel: string;
  icon: 'settings' | 'mute' | 'deafen' | 'dm' | 'disconnect';
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  channels: CommandPaletteChannel[];
  members: CommandPaletteMember[];
  onNavigateChannel: (channelId: string) => void;
  onJoinVoice: (channelId: string, channelName: string) => void;
  onUserClick: (member: CommandPaletteMember, rect: DOMRect) => void;
  quickActions?: QuickAction[];
}

// ── Icons ─────────────────────────────────────────────────

function SearchIcon() {
  return (
    <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

function HashIcon() {
  return (
    <svg className="w-4 h-4 text-text-muted flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 9h16M4 15h16M10 3l-2 18M16 3l-2 18" />
    </svg>
  );
}

function VoiceIcon() {
  return (
    <svg className="w-4 h-4 text-text-muted flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072M12 12h.01M18.364 5.636a9 9 0 010 12.728M6 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h2l4-4v14l-4-4z" />
    </svg>
  );
}


function ActionIcon({ icon }: { icon: QuickAction['icon'] }) {
  const paths: Record<string, string> = {
    settings: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    mute: 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m-4-1h8M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z',
    deafen: 'M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728M9 12h.01M15 12h.01M9 16h6',
    dm: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
    disconnect: 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636m12.728 12.728A9 9 0 015.636 5.636',
  };
  return (
    <svg className="w-4 h-4 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={paths[icon] || paths.settings} />
    </svg>
  );
}

// ── Component ─────────────────────────────────────────────

export function CommandPalette({
  isOpen,
  onClose,
  channels,
  members,
  onNavigateChannel,
  onJoinVoice,
  onUserClick,
  quickActions = [],
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset on open/close
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Build results from channels, members, and actions
  const results = useMemo(() => {
    const q = query.toLowerCase().trim();
    const out: PaletteResult[] = [];

    // Text channels
    const textChannels = channels.filter((c) => c.type === 'text');
    const matchedText = q
      ? textChannels.filter((c) => c.name.toLowerCase().includes(q))
      : textChannels;
    for (const c of matchedText.slice(0, 8)) {
      out.push({
        id: `ch-${c.id}`,
        type: 'text-channel',
        label: c.name,
        sublabel: 'Text Channel',
        data: c,
      });
    }

    // Voice channels
    const voiceChannels = channels.filter((c) => c.type === 'voice' || c.type === 'stage');
    const matchedVoice = q
      ? voiceChannels.filter((c) => c.name.toLowerCase().includes(q))
      : voiceChannels;
    for (const c of matchedVoice.slice(0, 6)) {
      out.push({
        id: `vc-${c.id}`,
        type: 'voice-channel',
        label: c.name,
        sublabel: c.type === 'stage' ? 'Stage Channel — Join' : 'Voice Channel — Join',
        data: c,
      });
    }

    // Users
    const matchedMembers = q
      ? members.filter(
          (m) =>
            m.username.toLowerCase().includes(q) ||
            (m.display_name && m.display_name.toLowerCase().includes(q)),
        )
      : members;
    for (const m of matchedMembers.slice(0, 10)) {
      out.push({
        id: `usr-${m.id}`,
        type: 'user',
        label: m.display_name || m.username,
        sublabel: m.display_name ? `@${m.username}` : undefined,
        data: m,
      });
    }

    // Quick actions
    const matchedActions = q
      ? quickActions.filter(
          (a) =>
            a.label.toLowerCase().includes(q) ||
            a.sublabel.toLowerCase().includes(q),
        )
      : quickActions;
    for (const a of matchedActions) {
      out.push({
        id: `act-${a.id}`,
        type: 'action',
        label: a.label,
        sublabel: a.sublabel,
        data: a,
      });
    }

    return out;
  }, [query, channels, members, quickActions]);

  // Clamp selected index
  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, results.length - 1)));
  }, [results.length]);

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const executeResult = useCallback(
    (result: PaletteResult) => {
      switch (result.type) {
        case 'text-channel':
          onNavigateChannel(result.data.id);
          break;
        case 'voice-channel':
          onJoinVoice(result.data.id, result.data.name);
          break;
        case 'user': {
          // Create a synthetic rect near the center of the screen for the popover
          const rect = new DOMRect(
            window.innerWidth / 2 - 150,
            window.innerHeight / 2 - 100,
            300,
            40,
          );
          onUserClick(result.data, rect);
          break;
        }
        case 'action':
          result.data.action();
          break;
      }
      onClose();
    },
    [onClose, onNavigateChannel, onJoinVoice, onUserClick],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % Math.max(1, results.length));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + results.length) % Math.max(1, results.length));
          break;
        case 'Enter':
          e.preventDefault();
          if (results[selectedIndex]) executeResult(results[selectedIndex]);
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [results, selectedIndex, executeResult, onClose],
  );

  // Group results by type for section headers
  const groupedSections = useMemo(() => {
    const sections: { type: ResultType; label: string; items: (PaletteResult & { globalIdx: number })[] }[] = [];
    const typeOrder: ResultType[] = ['text-channel', 'voice-channel', 'user', 'action'];
    const typeLabels: Record<ResultType, string> = {
      'text-channel': 'Text Channels',
      'voice-channel': 'Voice Channels',
      'user': 'Members',
      'action': 'Quick Actions',
    };

    let globalIdx = 0;
    for (const type of typeOrder) {
      const items = results.filter((r) => r.type === type);
      if (items.length > 0) {
        sections.push({
          type,
          label: typeLabels[type],
          items: items.map((item) => ({ ...item, globalIdx: globalIdx++ })),
        });
      } else {
        // Still need to track global index
      }
    }
    // Fix: rebuild globalIdx correctly
    let idx = 0;
    for (const section of sections) {
      for (const item of section.items) {
        item.globalIdx = idx++;
      }
    }
    return sections;
  }, [results]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm"
          onClick={handleBackdropClick}
          variants={fadeIn}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={easeTransition}
        >
          <motion.div
            className="w-full max-w-[560px] mx-4 bg-bg-secondary rounded-xl shadow-high border border-border overflow-hidden flex flex-col max-h-[60vh]"
            variants={scaleIn}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={springTransition}
            onKeyDown={handleKeyDown}
          >
            {/* Search Input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <SearchIcon />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedIndex(0);
                }}
                placeholder="Search channels, users, or actions..."
                className="flex-1 bg-transparent text-text-primary placeholder:text-text-muted outline-none text-base"
                autoComplete="off"
                spellCheck={false}
              />
              <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium text-text-muted bg-bg-tertiary rounded border border-border">
                ESC
              </kbd>
            </div>

            {/* Results */}
            <div ref={listRef} className="overflow-y-auto overscroll-contain py-2 scrollbar-thin">
              {results.length === 0 ? (
                <div className="px-4 py-8 text-center text-text-muted text-sm">
                  {query ? 'No results found' : 'Start typing to search...'}
                </div>
              ) : (
                groupedSections.map((section) => (
                  <div key={section.type}>
                    {/* Section header */}
                    <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                      {section.label}
                    </div>
                    {section.items.map((result) => (
                      <button
                        key={result.id}
                        data-idx={result.globalIdx}
                        onClick={() => executeResult(result)}
                        onMouseEnter={() => setSelectedIndex(result.globalIdx)}
                        className={clsx(
                          'w-full flex items-center gap-3 px-4 py-2 text-left transition-colors',
                          result.globalIdx === selectedIndex
                            ? 'bg-bg-modifier-selected text-text-primary'
                            : 'text-text-secondary hover:bg-bg-modifier-hover',
                        )}
                      >
                        {/* Icon / Avatar */}
                        {result.type === 'text-channel' && <HashIcon />}
                        {result.type === 'voice-channel' && <VoiceIcon />}
                        {result.type === 'user' && (
                          <Avatar
                            src={result.data.avatar_url}
                            alt={result.data.display_name || result.data.username}
                            size="xs"
                            status={result.data.status}
                          />
                        )}
                        {result.type === 'action' && <ActionIcon icon={result.data.icon} />}

                        {/* Label */}
                        <div className="flex-1 min-w-0">
                          <div
                            className="text-sm font-medium truncate"
                            style={
                              result.type === 'user' && result.data.role_color
                                ? { color: result.data.role_color }
                                : undefined
                            }
                          >
                            {result.label}
                          </div>
                          {result.sublabel && (
                            <div className="text-xs text-text-muted truncate">{result.sublabel}</div>
                          )}
                        </div>

                        {/* Hint badges */}
                        {result.type === 'voice-channel' && (
                          <span className="text-[10px] font-medium text-success bg-success/10 px-2 py-0.5 rounded-full">
                            Join
                          </span>
                        )}
                        {result.type === 'text-channel' && result.globalIdx === selectedIndex && (
                          <span className="text-[10px] text-text-muted">
                            Enter ↵
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>

            {/* Footer hints */}
            <div className="flex items-center gap-4 px-4 py-2 border-t border-border text-[11px] text-text-muted">
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-bg-tertiary rounded border border-border text-[10px]">↑↓</kbd>
                Navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-bg-tertiary rounded border border-border text-[10px]">↵</kbd>
                Select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-bg-tertiary rounded border border-border text-[10px]">Esc</kbd>
                Close
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
