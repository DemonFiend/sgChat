import { createSignal, Show, For, onMount } from 'solid-js';
import { A, useParams, useNavigate } from '@solidjs/router';
import { clsx } from 'clsx';
import { authStore } from '@/stores/auth';
import { networkStore } from '@/stores/network';
import { voiceStore } from '@/stores/voice';
import { voiceService } from '@/lib/voiceService';
import { serverPopupStore } from '@/stores';
import { canManageChannels } from '@/stores/permissions';
import { Channel, Category, ChannelType } from './ChannelList';
import { InlineParticipants } from '@/components/ui/VoiceParticipantsList';
import { VoiceConnectedBar } from '@/components/ui/VoiceConnectedBar';
import { ChannelSettingsModal } from '@/components/ui/ChannelSettingsModal';
import { SoundboardPanel } from '@/components/ui/SoundboardPanel';

// Sidebar resize constants
const MIN_WIDTH = 192; // 240px - 20% = 192px
const MAX_WIDTH = 384; // 240px + 60% = 384px
const DEFAULT_WIDTH = 240; // 15rem (w-60)
const STORAGE_KEY = 'serverSidebarWidth';

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
  const [width, setWidth] = createSignal(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = createSignal(false);
  const [settingsChannelId, setSettingsChannelId] = createSignal<string | null>(null);

  const settingsChannel = () => {
    const id = settingsChannelId();
    if (!id) return null;
    return props.channels.find(c => c.id === id) || null;
  };

  // Load saved width from localStorage on mount
  onMount(() => {
    const savedWidth = localStorage.getItem(STORAGE_KEY);
    if (savedWidth) {
      const parsed = parseInt(savedWidth, 10);
      if (!isNaN(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) {
        setWidth(parsed);
      }
    }
  });

  const handleMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = width();

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startX; // Positive when dragging right
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + deltaX));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      // Save to localStorage
      localStorage.setItem(STORAGE_KEY, width().toString());
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  };

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
  // Filter out AFK channel from regular voice channels
  // Sort temp_voice channels directly after their generator (same category_id)
  const voiceChannels = () => {
    const channels = props.channels.filter(c => 
      (c.type === 'voice' || c.type === 'temp_voice' || c.type === 'temp_voice_generator' || c.type === 'music') && 
      !c.is_afk_channel && 
      c.name.toLowerCase() !== 'afk'
    );
    
    const nonTemp = channels.filter(c => c.type !== 'temp_voice').sort((a, b) => a.position - b.position);
    const tempChannels = channels.filter(c => c.type === 'temp_voice').sort((a, b) => a.position - b.position);
    
    const result: typeof channels = [];
    for (const ch of nonTemp) {
      result.push(ch);
      if (ch.type === 'temp_voice_generator') {
        for (const temp of tempChannels) {
          if (temp.category_id === ch.category_id) {
            result.push(temp);
          }
        }
      }
    }
    // Add orphaned temp channels not matched to a generator
    for (const temp of tempChannels) {
      if (!result.includes(temp)) {
        result.push(temp);
      }
    }
    return result;
  };
  // Find AFK channel using is_afk_channel flag first, then fallback to name
  const afkChannel = () => props.channels.find(c => c.is_afk_channel) || 
    props.channels.find(c => c.type === 'voice' && c.name.toLowerCase() === 'afk');

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

    // Sort channels within each category, placing temp_voice after their generator
    for (const [key, list] of categorized.entries()) {
      const nonTemp = list.filter(c => c.type !== 'temp_voice').sort((a, b) => a.position - b.position);
      const tempChs = list.filter(c => c.type === 'temp_voice').sort((a, b) => a.position - b.position);
      
      if (tempChs.length > 0) {
        const sorted: Channel[] = [];
        for (const ch of nonTemp) {
          sorted.push(ch);
          if (ch.type === 'temp_voice_generator') {
            sorted.push(...tempChs.filter(t => t.category_id === ch.category_id));
          }
        }
        for (const t of tempChs) {
          if (!sorted.includes(t)) sorted.push(t);
        }
        categorized.set(key, sorted);
      } else {
        list.sort((a, b) => a.position - b.position);
      }
    }

    return { categorized, sortedCategories };
  };

  // Check if we should use category-based view
  const useCategoryView = () => props.categories.length > 0;

  // Check if a channel type is voice-like (needs voice controls)
  const isVoiceChannel = (type: ChannelType) => 
    type === 'voice' || type === 'temp_voice' || type === 'temp_voice_generator' || type === 'music';

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
      case 'music':
        return (
          <svg class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        );
      case 'announcement':
        return (
          <svg class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
          </svg>
        );
      case 'temp_voice_generator':
        return (
          <svg class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        );
      case 'temp_voice':
        return (
          <svg class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            <circle cx="18" cy="6" r="2" fill="currentColor" />
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
    <div 
      class="flex flex-col h-full bg-bg-secondary border-r border-bg-tertiary relative"
      style={{ width: `${width()}px` }}
    >
      {/* Resize Handle - Right Edge */}
      <div
        class={clsx(
          'absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-brand-primary/50 transition-colors z-10 group',
          isResizing() && 'bg-brand-primary'
        )}
        onMouseDown={handleMouseDown}
        title="Drag to resize sidebar"
      >
        {/* Wider hover area for easier grabbing */}
        <div class="absolute -left-1 -right-1 top-0 bottom-0" />
      </div>

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
                        onSettingsClick={(id) => setSettingsChannelId(id)}
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
                        onSettingsClick={(id) => setSettingsChannelId(id)}
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
                    isVoice={isVoiceChannel(channel.type)}
                    onSettingsClick={(id) => setSettingsChannelId(id)}
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
                        isVoice={isVoiceChannel(channel.type)}
                        onSettingsClick={(id) => setSettingsChannelId(id)}
                      />
                    )}
                  </For>
                </Show>
              </div>
            )}
          </For>
        </Show>

        {/* AFK Channel - Separate section only when NOT using category view */}
        <Show when={afkChannel() && !useCategoryView()}>
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
              onSettingsClick={(id) => setSettingsChannelId(id)}
            />
          </div>
        </Show>
      </div>

      {/* Soundboard Panel - shown when in voice */}
      <Show when={voiceStore.isConnected() && props.server?.id}>
        <SoundboardPanel serverId={props.server!.id} />
      </Show>

      {/* Voice Connected Bar - Fixed at bottom when in voice */}
      <VoiceConnectedBar />

      {/* Channel Settings Modal */}
      <Show when={settingsChannel()}>
        {(ch) => (
          <ChannelSettingsModal
            isOpen={!!settingsChannelId()}
            onClose={() => setSettingsChannelId(null)}
            channel={{
              id: ch().id,
              name: ch().name,
              type: ch().type,
              topic: ch().topic,
              bitrate: ch().bitrate,
              user_limit: ch().user_limit,
              server_id: props.server?.id || '',
            }}
          />
        )}
      </Show>
    </div>
  );
}

interface ChannelItemProps {
  channel: Channel;
  isActive: boolean;
  icon: any;
  isVoice?: boolean;
  onSettingsClick?: (channelId: string) => void;
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
      <div class="mb-0.5 group relative">
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

        {/* Settings gear - shown on hover for admins */}
        <Show when={props.onSettingsClick && canManageChannels()}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              props.onSettingsClick?.(props.channel.id);
            }}
            class="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 transition-all"
            title="Channel Settings"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </Show>

        {/* Show participants when there are users in the channel */}
        <Show when={participantCount() > 0}>
          <InlineParticipants channelId={props.channel.id} channelName={props.channel.name} maxShow={5} />
        </Show>
      </div>
    );
  }

  // Text channels use navigation
  return (
    <div class="group relative">
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

      {/* Settings gear - shown on hover for admins */}
      <Show when={props.onSettingsClick && canManageChannels()}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            props.onSettingsClick?.(props.channel.id);
          }}
          class="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 transition-all"
          title="Channel Settings"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </Show>
    </div>
  );
}
