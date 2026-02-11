import { For, Show, createSignal } from 'solid-js';
import { A, useParams } from '@solidjs/router';
import { clsx } from 'clsx';
import { UnreadIndicator } from '@/components/ui';

export type ChannelType = 'text' | 'voice' | 'announcement';

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  category_id: string | null;
  position: number;
  topic?: string;
  unread_count?: number;
  has_mentions?: boolean;
}

export interface Category {
  id: string;
  name: string;
  position: number;
}

interface ChannelListProps {
  serverName: string;
  serverIcon?: string | null;
  channels: Channel[];
  categories: Category[];
  onSettingsClick?: () => void;
  onServerSettingsClick?: () => void;
}

export function ChannelList(props: ChannelListProps) {
  const params = useParams<{ channelId?: string }>();
  const [collapsedCategories, setCollapsedCategories] = createSignal<Set<string>>(new Set());

  const toggleCategory = (categoryId: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  const getChannelsByCategory = (categoryId: string | null) => {
    return props.channels
      .filter((c) => c.category_id === categoryId)
      .sort((a, b) => a.position - b.position);
  };

  const uncategorizedChannels = () => getChannelsByCategory(null);
  const sortedCategories = () => [...props.categories].sort((a, b) => a.position - b.position);

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
      case 'announcement':
        return (
          <svg class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
          </svg>
        );
    }
  };

  return (
    <div class="flex flex-col w-60 h-full bg-bg-secondary">
      {/* Server header */}
      <button
        onClick={props.onServerSettingsClick}
        class="flex items-center justify-between h-12 px-4 border-b border-bg-tertiary hover:bg-bg-modifier-hover transition-colors"
      >
        <span class="font-semibold text-text-primary truncate">{props.serverName}</span>
        <svg class="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Channel list */}
      <div class="flex-1 overflow-y-auto py-3 px-2 scrollbar-thin">
        {/* Uncategorized channels */}
        <For each={uncategorizedChannels()}>
          {(channel) => (
            <ChannelItem
              channel={channel}
              isActive={params.channelId === channel.id}
              icon={channelIcon(channel.type)}
            />
          )}
        </For>

        {/* Categorized channels */}
        <For each={sortedCategories()}>
          {(category) => (
            <div class="mt-4 first:mt-0">
              <button
                onClick={() => toggleCategory(category.id)}
                class="flex items-center w-full px-1 mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted hover:text-text-secondary"
              >
                <svg
                  class={clsx(
                    'w-3 h-3 mr-1 transition-transform',
                    collapsedCategories().has(category.id) && '-rotate-90'
                  )}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
                {category.name}
              </button>

              <Show when={!collapsedCategories().has(category.id)}>
                <For each={getChannelsByCategory(category.id)}>
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
          )}
        </For>
      </div>
    </div>
  );
}

interface ChannelItemProps {
  channel: Channel;
  isActive: boolean;
  icon: any;
}

function ChannelItem(props: ChannelItemProps) {
  const hasUnread = () => (props.channel.unread_count ?? 0) > 0;
  
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
        <UnreadIndicator 
          count={props.channel.unread_count} 
          hasMentions={props.channel.has_mentions} 
        />
      </Show>
    </A>
  );
}
