import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams } from 'react-router';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import { UnreadIndicator } from '@/components/ui/UnreadIndicator';
import { useVoiceStore } from '@/stores/voice';
import { voiceService } from '@/lib/voiceService';
import { InlineParticipants } from '@/components/ui/VoiceParticipantsList';
import { toastStore } from '@/stores/toastNotifications';
import { api } from '@/api';

export type ChannelType = 'text' | 'voice' | 'music' | 'announcement' | 'temp_voice_generator' | 'temp_voice';

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  position: number;
  topic?: string;
  unread_count?: number;
  has_mentions?: boolean;
  category_id: string | null;
  is_afk_channel?: boolean;
  bitrate?: number;
  user_limit?: number;
}

export interface Category {
  id: string;
  name: string;
  position: number;
}

interface ChannelListProps {
  channels: Channel[];
  categories: Category[];
  serverId: string;
  onChannelSettingsClick?: (channel: Channel) => void;
  onCreateChannel?: () => void;
}

const VOICE_TYPES: ChannelType[] = ['voice', 'temp_voice', 'temp_voice_generator', 'music'];
const isVoiceType = (type: ChannelType) => VOICE_TYPES.includes(type);

const channelIcon = (type: ChannelType) => {
  switch (type) {
    case 'text':
      return (
        <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
        </svg>
      );
    case 'voice':
      return (
        <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
        </svg>
      );
    case 'music':
      return (
        <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
        </svg>
      );
    case 'announcement':
      return (
        <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
        </svg>
      );
    case 'temp_voice_generator':
      return (
        <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
      );
    case 'temp_voice':
      return (
        <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          <circle cx="18" cy="6" r="2" fill="currentColor" />
        </svg>
      );
    default:
      return (
        <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
        </svg>
      );
  }
};

const settingsIcon = (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const collapseArrow = (collapsed: boolean) => (
  <svg
    className={clsx('w-3 h-3 mr-1 transition-transform', collapsed && '-rotate-90')}
    fill="none" viewBox="0 0 24 24" stroke="currentColor"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
  </svg>
);

export function ChannelList({ channels, categories, serverId, onChannelSettingsClick, onCreateChannel }: ChannelListProps) {
  const { channelId } = useParams<{ channelId?: string }>();
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const toggleSection = (sectionId: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const textChannels = channels
    .filter((c) => c.type === 'text' || c.type === 'announcement')
    .sort((a, b) => a.position - b.position);
  const voiceChannels = channels
    .filter((c) => VOICE_TYPES.includes(c.type))
    .sort((a, b) => a.position - b.position);

  const useCategoryView = categories.length > 0;

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin" role="tree" aria-label="Channels">
      {useCategoryView ? (
        <>
          {categories
            .sort((a, b) => a.position - b.position)
            .map((category) => {
              const categoryChannels = channels
                .filter((c) => c.category_id === category.id)
                .sort((a, b) => a.position - b.position);
              if (categoryChannels.length === 0) return null;

              return (
                <div key={category.id} className="px-2 pt-3" role="group">
                  <div className="flex items-center mb-1 group/header">
                    <button
                      onClick={() => toggleSection(category.id)}
                      aria-expanded={!collapsedSections.has(category.id)}
                      className="flex items-center flex-1 px-1 text-xs font-semibold uppercase tracking-wide text-text-muted hover:text-text-secondary"
                    >
                      {collapseArrow(collapsedSections.has(category.id))}
                      {category.name}
                    </button>
                    {onCreateChannel && (
                      <button
                        onClick={onCreateChannel}
                        className="opacity-0 group-hover/header:opacity-100 p-0.5 rounded hover:bg-bg-modifier-hover text-text-muted hover:text-text-primary transition-all"
                        title="Create Channel"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                        </svg>
                      </button>
                    )}
                  </div>
                  {!collapsedSections.has(category.id) && categoryChannels.map((channel) => (
                    <ChannelItem
                      key={channel.id}
                      channel={channel}
                      isActive={channelId === channel.id}
                      serverId={serverId}
                      onSettingsClick={onChannelSettingsClick}
                    />
                  ))}
                </div>
              );
            })}

          {/* Uncategorized channels */}
          {(() => {
            const uncategorized = channels
              .filter((c) => c.category_id === null)
              .sort((a, b) => a.position - b.position);
            if (uncategorized.length === 0) return null;
            return (
              <div className="px-2 pt-3" role="group">
                <div className="flex items-center mb-1 group/header">
                  <button
                    onClick={() => toggleSection('uncategorized')}
                    aria-expanded={!collapsedSections.has('uncategorized')}
                    className="flex items-center flex-1 px-1 text-xs font-semibold uppercase tracking-wide text-text-muted hover:text-text-secondary"
                  >
                    {collapseArrow(collapsedSections.has('uncategorized'))}
                    Channels
                  </button>
                  {onCreateChannel && (
                    <button
                      onClick={onCreateChannel}
                      className="opacity-0 group-hover/header:opacity-100 p-0.5 rounded hover:bg-bg-modifier-hover text-text-muted hover:text-text-primary transition-all"
                      title="Create Channel"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  )}
                </div>
                {!collapsedSections.has('uncategorized') && uncategorized.map((channel) => (
                  <ChannelItem
                    key={channel.id}
                    channel={channel}
                    isActive={channelId === channel.id}
                    serverId={serverId}
                    onSettingsClick={onChannelSettingsClick}
                  />
                ))}
              </div>
            );
          })()}
        </>
      ) : (
        <>
          <div className="px-2 pt-3">
            <div className="flex items-center mb-1 group/header">
              <button
                onClick={() => toggleSection('text')}
                className="flex items-center flex-1 px-1 text-xs font-semibold uppercase tracking-wide text-text-muted hover:text-text-secondary"
              >
                {collapseArrow(collapsedSections.has('text'))}
                Text Channels
              </button>
              {onCreateChannel && (
                <button
                  onClick={onCreateChannel}
                  className="opacity-0 group-hover/header:opacity-100 p-0.5 rounded hover:bg-bg-modifier-hover text-text-muted hover:text-text-primary transition-all"
                  title="Create Channel"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              )}
            </div>
            {!collapsedSections.has('text') && textChannels.map((channel) => (
              <ChannelItem key={channel.id} channel={channel} isActive={channelId === channel.id} serverId={serverId} onSettingsClick={onChannelSettingsClick} />
            ))}
          </div>

          <div className="px-2 pt-3">
            <div className="flex items-center mb-1 group/header">
              <button
                onClick={() => toggleSection('voice')}
                className="flex items-center flex-1 px-1 text-xs font-semibold uppercase tracking-wide text-text-muted hover:text-text-secondary"
              >
                {collapseArrow(collapsedSections.has('voice'))}
                Voice Channels
              </button>
              {onCreateChannel && (
                <button
                  onClick={onCreateChannel}
                  className="opacity-0 group-hover/header:opacity-100 p-0.5 rounded hover:bg-bg-modifier-hover text-text-muted hover:text-text-primary transition-all"
                  title="Create Channel"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              )}
            </div>
            {!collapsedSections.has('voice') && voiceChannels.map((channel) => (
              <ChannelItem key={channel.id} channel={channel} isActive={channelId === channel.id} serverId={serverId} onSettingsClick={onChannelSettingsClick} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Channel Context Menu (voice channels — Copy ID only) ──

function ChannelContextMenu({
  position,
  channelId,
  onClose,
}: {
  position: { x: number; y: number };
  channelId: string;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const id = requestAnimationFrame(() => document.addEventListener('mousedown', handler));
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', escHandler);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', escHandler);
    };
  }, [onClose]);

  const style: React.CSSProperties = {
    position: 'fixed',
    top: Math.min(position.y, window.innerHeight - 60),
    left: Math.min(position.x, window.innerWidth - 200),
    zIndex: 200,
  };

  return createPortal(
    <div
      ref={menuRef}
      style={style}
      className="w-[200px] py-1.5 bg-bg-tertiary rounded-lg shadow-high border border-border"
    >
      <button
        onClick={() => {
          navigator.clipboard.writeText(channelId);
          toastStore.addToast({
            type: 'system',
            title: 'Copied!',
            message: 'Channel ID copied to clipboard',
          });
          onClose();
        }}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-modifier-hover hover:text-text-primary transition-colors"
      >
        <svg
          className="w-4 h-4 text-text-muted flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
          />
        </svg>
        <span>Copy Channel ID</span>
      </button>
    </div>,
    document.body,
  );
}

// ── Channel Item ──

interface ChannelItemProps {
  channel: Channel;
  isActive: boolean;
  serverId: string;
  onSettingsClick?: (channel: Channel) => void;
}

const ChannelItem = memo(function ChannelItem({ channel, isActive, serverId: _serverId, onSettingsClick }: ChannelItemProps) {
  const hasUnread = (channel.unread_count ?? 0) > 0;
  const voice = isVoiceType(channel.type);
  const currentVoiceChannelId = useVoiceStore((s) => s.currentChannelId);
  const isInThisVoice = voice && currentVoiceChannelId === channel.id;
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }, []);

  if (voice) {
    return (
      <div role="treeitem">
        <motion.div whileHover={{ x: 2 }} transition={{ duration: 0.1 }}>
          <div
            onClick={() => voiceService.join(channel.id, channel.name)}
            onContextMenu={handleContextMenu}
            className={clsx(
              'group/channel relative flex items-center gap-1.5 px-2 py-1.5 mb-0.5 rounded text-sm transition-colors cursor-pointer',
              isInThisVoice
                ? 'bg-bg-modifier-selected text-text-primary'
                : 'text-text-muted hover:bg-bg-modifier-hover hover:text-text-secondary',
            )}
          >
            {channelIcon(channel.type)}
            <span className="truncate flex-1">{channel.name}</span>

            {channel.is_afk_channel && (
              <span className="text-[10px] text-text-muted uppercase font-semibold tracking-wide">AFK</span>
            )}

            {onSettingsClick && (
              <button
                onClick={(e) => { e.stopPropagation(); onSettingsClick(channel); }}
                className="opacity-0 group-hover/channel:opacity-100 p-0.5 rounded hover:bg-bg-modifier-active text-text-muted hover:text-text-primary transition-all"
                title="Edit Channel"
              >
                {settingsIcon}
              </button>
            )}
          </div>
        </motion.div>
        <InlineParticipants channelId={channel.id} />
        {ctxMenu && (
          <ChannelContextMenu
            position={ctxMenu}
            channelId={channel.id}
            onClose={() => setCtxMenu(null)}
          />
        )}
      </div>
    );
  }

  return (
    <>
      <motion.div whileHover={{ x: 2 }} transition={{ duration: 0.1 }} role="treeitem">
        <Link
          to={`/channels/${channel.id}`}
          onContextMenu={handleContextMenu}
          className={clsx(
            'group/channel relative flex items-center gap-1.5 px-2 py-1.5 mb-0.5 rounded text-sm transition-colors',
            isActive
              ? 'bg-bg-modifier-selected text-text-primary'
              : hasUnread
                ? 'text-text-primary font-medium hover:bg-bg-modifier-hover'
                : 'text-text-muted hover:bg-bg-modifier-hover hover:text-text-secondary',
          )}
        >
          {hasUnread && !isActive && (
            <span className="absolute -left-1 w-1 h-2 bg-text-primary rounded-r" />
          )}

          {channelIcon(channel.type)}
          <span className="truncate flex-1">{channel.name}</span>

          {onSettingsClick && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSettingsClick(channel); }}
              className="opacity-0 group-hover/channel:opacity-100 p-0.5 rounded hover:bg-bg-modifier-active text-text-muted hover:text-text-primary transition-all"
              title="Edit Channel"
            >
              {settingsIcon}
            </button>
          )}

          {hasUnread && !isActive && (
            <UnreadIndicator count={channel.unread_count} hasMentions={channel.has_mentions} />
          )}
        </Link>
      </motion.div>

      {ctxMenu && (
        <ChannelNotificationMenu
          channelId={channel.id}
          position={ctxMenu}
          onClose={() => setCtxMenu(null)}
          onOpenSettings={onSettingsClick ? () => { setCtxMenu(null); onSettingsClick(channel); } : undefined}
        />
      )}
    </>
  );
});

// ── Channel Notification Context Menu (right-click, text channels only) ──

type NotificationLevel = 'all' | 'mentions' | 'none' | 'default';

interface ChannelNotifState {
  level: NotificationLevel;
  suppress_everyone: boolean;
  suppress_roles: boolean;
}

const LEVEL_OPTIONS: { value: NotificationLevel; label: string; icon: string }[] = [
  { value: 'default', label: 'Default', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
  { value: 'all', label: 'All Messages', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
  { value: 'mentions', label: 'Mentions Only', icon: 'M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207' },
  { value: 'none', label: 'Nothing', icon: 'M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2' },
];

function ChannelNotificationMenu({
  channelId,
  position,
  onClose,
  onOpenSettings,
}: {
  channelId: string;
  position: { x: number; y: number };
  onClose: () => void;
  onOpenSettings?: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [settings, setSettings] = useState<ChannelNotifState>({
    level: 'default',
    suppress_everyone: false,
    suppress_roles: false,
  });

  // Fetch current settings
  useEffect(() => {
    api
      .get<ChannelNotifState>(`/channels/${channelId}/notification-settings`)
      .then(setSettings)
      .catch(() => {});
  }, [channelId]);

  // Click-outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    // Delay to avoid the same right-click closing immediately
    const id = requestAnimationFrame(() => document.addEventListener('mousedown', handler));
    const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', escHandler);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', escHandler);
    };
  }, [onClose]);

  const save = useCallback(
    async (updates: Partial<ChannelNotifState>) => {
      const next = { ...settings, ...updates };
      setSettings(next);
      try {
        await api.patch(`/channels/${channelId}/notification-settings`, next);
      } catch {
        toastStore.addToast({ title: 'Error', message: 'Failed to save notification settings', type: 'system' });
      }
    },
    [channelId, settings],
  );

  // Clamp menu to viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    top: Math.min(position.y, window.innerHeight - 340),
    left: Math.min(position.x, window.innerWidth - 220),
    zIndex: 200,
  };

  return createPortal(
    <div ref={menuRef} style={style} className="w-[200px] py-1.5 bg-bg-tertiary rounded-lg shadow-high border border-border">
      {/* Header */}
      <div className="px-3 py-1.5 text-xs font-semibold text-text-muted uppercase tracking-wide">
        Notification Settings
      </div>

      {/* Level options */}
      {LEVEL_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => save({ level: opt.value })}
          className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-modifier-hover hover:text-text-primary transition-colors"
        >
          <svg className="w-4 h-4 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={opt.icon} />
          </svg>
          <span className="flex-1 text-left">{opt.label}</span>
          {settings.level === opt.value && (
            <svg className="w-4 h-4 text-success flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
      ))}

      {/* Divider */}
      <div className="h-px bg-border mx-2 my-1" />

      {/* Suppress toggles */}
      <button
        onClick={() => save({ suppress_everyone: !settings.suppress_everyone })}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-modifier-hover hover:text-text-primary transition-colors"
      >
        {settings.suppress_everyone ? (
          <svg className="w-4 h-4 text-success flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <span className="w-4 h-4 flex-shrink-0" />
        )}
        <span>Suppress @everyone</span>
      </button>
      <button
        onClick={() => save({ suppress_roles: !settings.suppress_roles })}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-modifier-hover hover:text-text-primary transition-colors"
      >
        {settings.suppress_roles ? (
          <svg className="w-4 h-4 text-success flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <span className="w-4 h-4 flex-shrink-0" />
        )}
        <span>Suppress @role</span>
      </button>

      {/* Channel Settings shortcut */}
      {onOpenSettings && (
        <>
          <div className="h-px bg-border mx-2 my-1" />
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-modifier-hover hover:text-text-primary transition-colors"
          >
            <svg className="w-4 h-4 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>Channel Settings</span>
          </button>
        </>
      )}

      {/* Copy Channel ID */}
      <div className="h-px bg-border mx-2 my-1" />
      <button
        onClick={() => {
          navigator.clipboard.writeText(channelId);
          toastStore.addToast({ type: 'system', title: 'Copied!', message: 'Channel ID copied to clipboard' });
          onClose();
        }}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-modifier-hover hover:text-text-primary transition-colors"
      >
        <svg className="w-4 h-4 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
        </svg>
        <span>Copy Channel ID</span>
      </button>
    </div>,
    document.body,
  );
}
