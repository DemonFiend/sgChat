import { createSignal, Show, For } from 'solid-js';
import { A, useParams, useNavigate } from '@solidjs/router';
import { clsx } from 'clsx';
import { authStore } from '@/stores/auth';
import { networkStore } from '@/stores/network';
import { voiceStore } from '@/stores/voice';
import { voiceService } from '@/lib/voiceService';
import { serverPopupStore } from '@/stores';
import { Channel, Category, ChannelType } from './ChannelList';
import { InlineParticipants } from '@/components/ui/VoiceParticipantsList';
import { VoiceConnectedBar } from '@/components/ui/VoiceConnectedBar';

export interface ServerInfo {
  id: string;
  name: string;
  icon_url: string | null;
  motd?: string; // Message of the Day
}

interface ServerSidebarProps {
  server: ServerInfo | null;
  channels: Channel[];
  categories: Category[];
  onServerSettingsClick?: () => void;
  onLogout?: () => void;
}

export function ServerSidebar(props: ServerSidebarProps) {
  const params = useParams<{ channelId?: string }>();
  const navigate = useNavigate();
  const [collapsedSections, setCollapsedSections] = createSignal<Set<string>>(new Set());

  const toggleSection = (sectionId: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  // Group channels by type
  const textChannels = () => props.channels.filter(c => c.type === 'text').sort((a, b) => a.position - b.position);
  const voiceChannels = () => props.channels.filter(c => c.type === 'voice' && c.name.toLowerCase() !== 'afk' && c.name.toLowerCase() !== 'away channel').sort((a, b) => a.position - b.position);
  const afkChannel = () => props.channels.find(c => c.type === 'voice' && (c.name.toLowerCase() === 'afk' || c.name.toLowerCase() === 'away channel'));

  // Organize channels by category
  const organizedChannels = () => {
    const categorized = new Map<string | null, Channel[]>();
    const sortedCategories = [...props.categories].sort((a, b) => a.position - b.position);
    
    // Initialize categories
    categorized.set(null, []); // Uncategorized
    for (const cat of sortedCategories) {
      categorized.set(cat.id, []);
    }
    
    // Group channels
    for (const channel of props.channels) {
      const list = categorized.get(channel.category_id) || categorized.get(null)!;
      list.push(channel);
    }
    
    // Sort channels within each category
    for (const list of categorized.values()) {
      list.sort((a, b) => a.position - b.position);
    }
    
    return { categorized, sortedCategories };
  };

  // Check if we should use category-based view
  const useCategoryView = () => props.categories.length > 0;

  const handleLogout = async () => {
    await authStore.logout(false);
    networkStore.clearConnection();
    navigate('/login', { replace: true });
  };

  const channelIcon = (type: ChannelType) => {
    switch (type) {
      case 'text':
        return (
          <svg class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
          </svg>
        );
      case 'voice':
        return (
          <svg class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          </svg>
        );
      default:
        return (
          <svg class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
          </svg>
        );
    }
  };

  return (
    <div class="flex flex-col w-60 h-full bg-bg-secondary border-r border-bg-tertiary">
      {/* Header with Server Info and Settings */}
      <div class="flex items-center gap-2 p-3 border-b border-bg-tertiary">
        {/* Logout Button */}
        <button
          onClick={handleLogout}
          class="p-2 rounded hover:bg-bg-modifier-hover text-text-muted hover:text-danger transition-colors"
          title="Log Out"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>

        {/* Server Icon & Name - Click to view popup */}
        <button
          onClick={() => serverPopupStore.reopenPopup()}
          class="flex-1 flex items-center gap-3 p-2 rounded hover:bg-bg-modifier-hover transition-colors group"
          title="View Server Information"
        >
          <div class="w-10 h-10 rounded-2xl bg-brand-primary flex items-center justify-center overflow-hidden flex-shrink-0">
            <Show
              when={props.server?.icon_url}
              fallback={
                <span class="text-white font-bold text-lg">
                  {props.server?.name?.charAt(0)?.toUpperCase() || 'S'}
                </span>
              }
            >
              <img
                src={props.server!.icon_url!}
                alt={props.server?.name}
                class="w-full h-full object-cover"
              />
            </Show>
          </div>
          <div class="flex-1 min-w-0 text-left">
            <div class="font-semibold text-text-primary truncate text-sm">
              {props.server?.name || 'Server'}
            </div>
          </div>
        </button>

        {/* Server Settings Button - Only show if user has permission */}
        <Show when={props.onServerSettingsClick}>
          <button
            onClick={props.onServerSettingsClick}
            class="p-2 rounded hover:bg-bg-modifier-hover text-text-muted hover:text-text-primary transition-colors"
            title="Server Settings"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </Show>
      </div>

      {/* MOTD - Message of the Day */}
      <div class="px-3 py-2 border-b border-bg-tertiary">
        <div class="text-xs font-semibold uppercase text-text-muted mb-1">MOTD</div>
        <p class="text-sm text-text-secondary line-clamp-2">
          {props.server?.motd || 'Welcome to the server!'}
        </p>
      </div>

      {/* Channel List - Scrollable */}
      <div class="flex-1 overflow-y-auto scrollbar-thin">
        <Show 
          when={useCategoryView()}
          fallback={
            <>
              {/* Default Type-Based View */}
              {/* Text Channels Section */}
              <div class="px-2 pt-3">
                <button
                  onClick={() => toggleSection('text')}
                  class="flex items-center w-full px-1 mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted hover:text-text-secondary"
                >
                  <svg
                    class={clsx(
                      'w-3 h-3 mr-1 transition-transform',
                      collapsedSections().has('text') && '-rotate-90'
                    )}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                  </svg>
                  Text Channels
                </button>
                <Show when={!collapsedSections().has('text')}>
                  <For each={textChannels()}>
                    {(channel) => (
                      <ChannelItem
                        channel={channel}
                        isActive={params.channelId === channel.id}
                        icon={channelIcon(channel.type)}
                      />
                    )}
                  </For>
                </Show>
              </div>

              {/* Voice Channels Section */}
              <div class="px-2 pt-3">
                <button
                  onClick={() => toggleSection('voice')}
                  class="flex items-center w-full px-1 mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted hover:text-text-secondary"
                >
                  <svg
                    class={clsx(
                      'w-3 h-3 mr-1 transition-transform',
                      collapsedSections().has('voice') && '-rotate-90'
                    )}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                  </svg>
                  Voice Channels
                </button>
                <Show when={!collapsedSections().has('voice')}>
                  <For each={voiceChannels()}>
                    {(channel) => (
                      <ChannelItem
                        channel={channel}
                        isActive={params.channelId === channel.id}
                        icon={channelIcon(channel.type)}
                        isVoice
                      />
                    )}
                  </For>
                </Show>
              </div>
            </>
          }
        >
          {/* Category-Based View */}
          {/* Uncategorized Channels */}
          <Show when={(organizedChannels().categorized.get(null)?.length ?? 0) > 0}>
            <div class="px-2 pt-3">
              <For each={organizedChannels().categorized.get(null)}>
                {(channel) => (
                  <ChannelItem
                    channel={channel}
                    isActive={params.channelId === channel.id}
                    icon={channelIcon(channel.type)}
                    isVoice={channel.type === 'voice'}
                  />
                )}
              </For>
            </div>
          </Show>

          {/* Categorized Channels */}
          <For each={organizedChannels().sortedCategories}>
            {(category) => (
              <div class="px-2 pt-3">
                <button
                  onClick={() => toggleSection(category.id)}
                  class="flex items-center w-full px-1 mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted hover:text-text-secondary"
                >
                  <svg
                    class={clsx(
                      'w-3 h-3 mr-1 transition-transform',
                      collapsedSections().has(category.id) && '-rotate-90'
                    )}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                  </svg>
                  {category.name}
                </button>
                <Show when={!collapsedSections().has(category.id)}>
                  <For each={organizedChannels().categorized.get(category.id)}>
                    {(channel) => (
                      <ChannelItem
                        channel={channel}
                        isActive={params.channelId === channel.id}
                        icon={channelIcon(channel.type)}
                        isVoice={channel.type === 'voice'}
                      />
                    )}
                  </For>
                </Show>
              </div>
            )}
          </For>
        </Show>

        {/* AFK Channel - Separate */}
        <Show when={afkChannel()}>
          <div class="px-2 pt-3">
            <div class="px-1 mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
              AFK Channel
            </div>
            <ChannelItem
              channel={afkChannel()!}
              isActive={params.channelId === afkChannel()!.id}
              icon={
                <svg class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              }
              isVoice
            />
          </div>
        </Show>
      </div>

      {/* Voice Connected Bar - Fixed at bottom when in voice */}
      <VoiceConnectedBar />
    </div>
  );
}

interface ChannelItemProps {
  channel: Channel;
  isActive: boolean;
  icon: any;
  isVoice?: boolean;
}

function ChannelItem(props: ChannelItemProps) {
  const hasUnread = () => (props.channel.unread_count ?? 0) > 0;
  const isConnectedToThisChannel = () => voiceService.isConnectedToChannel(props.channel.id);
  const participantCount = () => voiceStore.getParticipants(props.channel.id).length;

  const handleVoiceChannelClick = async () => {
    try {
      if (isConnectedToThisChannel()) {
        // Already connected - leave
        await voiceService.leave();
      } else {
        // Join this channel
        await voiceService.join(props.channel.id, props.channel.name);
      }
    } catch (err) {
      // Error already logged and stored in voiceStore by voiceService
    }
  };

  // Voice channels use a button instead of a link
  if (props.isVoice) {
    return (
      <div class="mb-0.5">
        <button
          onClick={handleVoiceChannelClick}
          class={clsx(
            'relative flex items-center gap-1.5 px-2 py-1.5 w-full rounded text-sm transition-colors text-left',
            isConnectedToThisChannel()
              ? 'bg-brand-primary/20 text-brand-primary'
              : voiceStore.isConnecting() && voiceStore.currentChannelId() === props.channel.id
                ? 'bg-warning/20 text-warning'
                : 'text-text-muted hover:bg-bg-modifier-hover hover:text-text-secondary'
          )}
        >
          {props.icon}
          <span class="truncate flex-1">{props.channel.name}</span>
          
          {/* Participant count badge */}
          <Show when={participantCount() > 0}>
            <span class="text-xs text-text-muted">
              {participantCount()}
            </span>
          </Show>

          {/* Connected indicator */}
          <Show when={isConnectedToThisChannel()}>
            <span class="w-2 h-2 bg-status-online rounded-full animate-pulse" />
          </Show>
        </button>

        {/* Show participants when there are users in the channel */}
        <Show when={participantCount() > 0}>
          <InlineParticipants channelId={props.channel.id} maxShow={5} />
        </Show>
      </div>
    );
  }
  
  // Text channels use navigation
  return (
    <A
      href={`/channels/${props.channel.id}`}
      class={clsx(
        'relative flex items-center gap-1.5 px-2 py-1.5 mb-0.5 rounded text-sm transition-colors',
        props.isActive
          ? 'bg-bg-modifier-selected text-text-primary'
          : hasUnread()
            ? 'text-text-primary font-medium hover:bg-bg-modifier-hover'
            : 'text-text-muted hover:bg-bg-modifier-hover hover:text-text-secondary'
      )}
    >
      {/* Unread indicator dot */}
      <Show when={hasUnread() && !props.isActive}>
        <span class="absolute -left-1 w-1 h-2 bg-text-primary rounded-r" />
      </Show>
      
      {props.icon}
      <span class="truncate flex-1">{props.channel.name}</span>
      
      {/* Unread count badge */}
      <Show when={hasUnread() && !props.isActive}>
        <span 
          class={clsx(
            "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-xs font-bold",
            props.channel.has_mentions 
              ? "bg-danger text-white" 
              : "bg-text-muted text-bg-primary"
          )}
        >
          {(props.channel.unread_count ?? 0) > 99 ? '99+' : props.channel.unread_count}
        </span>
      </Show>
    </A>
  );
}
