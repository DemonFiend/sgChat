import { useState, memo } from 'react';
import { Link, useParams } from 'react-router';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import { UnreadIndicator } from '@/components/ui/UnreadIndicator';

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
}

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

export function ChannelList({ channels, categories, serverId, onChannelSettingsClick }: ChannelListProps) {
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

  const textChannels = channels.filter((c) => c.type === 'text').sort((a, b) => a.position - b.position);
  const voiceChannels = channels
    .filter((c) => ['voice', 'temp_voice', 'temp_voice_generator', 'music'].includes(c.type) && !c.is_afk_channel && c.name.toLowerCase() !== 'afk')
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
                  <button
                    onClick={() => toggleSection(category.id)}
                    aria-expanded={!collapsedSections.has(category.id)}
                    className="flex items-center w-full px-1 mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted hover:text-text-secondary"
                  >
                    <svg
                      className={clsx('w-3 h-3 mr-1 transition-transform', collapsedSections.has(category.id) && '-rotate-90')}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                    {category.name}
                  </button>
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
        </>
      ) : (
        <>
          <div className="px-2 pt-3">
            <button
              onClick={() => toggleSection('text')}
              className="flex items-center w-full px-1 mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted hover:text-text-secondary"
            >
              <svg
                className={clsx('w-3 h-3 mr-1 transition-transform', collapsedSections.has('text') && '-rotate-90')}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
              Text Channels
            </button>
            {!collapsedSections.has('text') && textChannels.map((channel) => (
              <ChannelItem key={channel.id} channel={channel} isActive={channelId === channel.id} serverId={serverId} onSettingsClick={onChannelSettingsClick} />
            ))}
          </div>

          <div className="px-2 pt-3">
            <button
              onClick={() => toggleSection('voice')}
              className="flex items-center w-full px-1 mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted hover:text-text-secondary"
            >
              <svg
                className={clsx('w-3 h-3 mr-1 transition-transform', collapsedSections.has('voice') && '-rotate-90')}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
              Voice Channels
            </button>
            {!collapsedSections.has('voice') && voiceChannels.map((channel) => (
              <ChannelItem key={channel.id} channel={channel} isActive={channelId === channel.id} serverId={serverId} onSettingsClick={onChannelSettingsClick} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface ChannelItemProps {
  channel: Channel;
  isActive: boolean;
  serverId: string;
  onSettingsClick?: (channel: Channel) => void;
}

const ChannelItem = memo(function ChannelItem({ channel, isActive, serverId, onSettingsClick }: ChannelItemProps) {
  const hasUnread = (channel.unread_count ?? 0) > 0;

  return (
    <motion.div whileHover={{ x: 2 }} transition={{ duration: 0.1 }} role="treeitem">
      <Link
        to={`/channels/${channel.id}`}
        className={clsx(
          'group/channel relative flex items-center gap-1.5 px-2 py-1.5 mb-0.5 rounded text-sm transition-colors',
          isActive
            ? 'bg-bg-modifier-selected text-text-primary'
            : hasUnread
              ? 'text-text-primary font-medium hover:bg-bg-modifier-hover'
              : 'text-text-muted hover:bg-bg-modifier-hover hover:text-text-secondary'
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
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        )}

        {hasUnread && !isActive && (
          <UnreadIndicator count={channel.unread_count} hasMentions={channel.has_mentions} />
        )}
      </Link>
    </motion.div>
  );
});
