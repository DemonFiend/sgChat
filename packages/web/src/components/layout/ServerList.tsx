import { For, Show } from 'solid-js';
import { A, useLocation } from '@solidjs/router';
import { clsx } from 'clsx';
import { Tooltip } from '@/components/ui';

interface Server {
  id: string;
  name: string;
  icon_url: string | null;
}

interface ServerListProps {
  servers: Server[];
  onCreateServer: () => void;
}

export function ServerList(props: ServerListProps) {
  const location = useLocation();

  const isActive = (serverId: string) => {
    return location.pathname.startsWith(`/channels/${serverId}`);
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .slice(0, 3)
      .toUpperCase();
  };

  return (
    <nav
      class="flex flex-col items-center w-[72px] h-full py-3 bg-bg-tertiary overflow-y-auto scrollbar-hide"
      aria-label="Servers"
    >
      {/* Home / DMs Button */}
      <Tooltip content="Direct Messages" position="right">
        <A
          href="/channels/@me"
          class={clsx(
            'relative flex items-center justify-center w-12 h-12 mb-2 rounded-2xl transition-all duration-200',
            'hover:rounded-xl hover:bg-accent',
            location.pathname.startsWith('/channels/@me')
              ? 'bg-accent rounded-xl'
              : 'bg-bg-primary'
          )}
        >
          <svg class="w-7 h-7 text-text-primary" fill="currentColor" viewBox="0 0 24 24">
            <path d="M21.79 18l-1.42-1.42a.996.996 0 111.41-1.41l1.42 1.42a.996.996 0 11-1.41 1.41zM19 17a.997.997 0 01-1-1v-1h-1a1 1 0 110-2h1v-1a1 1 0 112 0v1h1a1 1 0 110 2h-1v1c0 .55-.45 1-1 1zm-5-6c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm-6 0c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm6 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zM8 15c-2.33 0-7 1.17-7 3.5V19h6v-2.5c0-.85.33-2.34 2.37-3.47C8.5 13.01 8 13 8 13z" />
          </svg>
          
          {/* Active indicator */}
          <Show when={location.pathname.startsWith('/channels/@me')}>
            <span class="absolute left-0 w-1 h-10 bg-text-primary rounded-r-full" />
          </Show>
        </A>
      </Tooltip>

      {/* Separator */}
      <div class="w-8 h-0.5 bg-divider mb-2" />

      {/* Server list */}
      <For each={props.servers}>
        {(server) => (
          <Tooltip content={server.name} position="right">
            <A
              href={`/channels/${server.id}`}
              class={clsx(
                'relative flex items-center justify-center w-12 h-12 mb-2 transition-all duration-200',
                'hover:rounded-xl',
                isActive(server.id) ? 'rounded-xl' : 'rounded-2xl'
              )}
            >
              <Show
                when={server.icon_url}
                fallback={
                  <div
                    class={clsx(
                      'flex items-center justify-center w-full h-full text-text-primary font-semibold transition-all duration-200',
                      isActive(server.id)
                        ? 'bg-accent rounded-xl'
                        : 'bg-bg-primary rounded-2xl hover:rounded-xl hover:bg-accent'
                    )}
                  >
                    {getInitials(server.name)}
                  </div>
                }
              >
                <img
                  src={server.icon_url!}
                  alt={server.name}
                  class={clsx(
                    'w-full h-full object-cover transition-all duration-200',
                    isActive(server.id) ? 'rounded-xl' : 'rounded-2xl hover:rounded-xl'
                  )}
                />
              </Show>

              {/* Active indicator */}
              <Show when={isActive(server.id)}>
                <span class="absolute left-0 w-1 h-10 bg-text-primary rounded-r-full" />
              </Show>
            </A>
          </Tooltip>
        )}
      </For>

      {/* Add Server Button */}
      <Tooltip content="Add a Server" position="right">
        <button
          onClick={props.onCreateServer}
          class={clsx(
            'flex items-center justify-center w-12 h-12 mb-2 rounded-2xl',
            'bg-bg-primary text-success hover:rounded-xl hover:bg-success hover:text-white',
            'transition-all duration-200'
          )}
        >
          <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </Tooltip>

      {/* Explore Public Servers */}
      <Tooltip content="Explore Public Servers" position="right">
        <button
          class={clsx(
            'flex items-center justify-center w-12 h-12 rounded-2xl',
            'bg-bg-primary text-success hover:rounded-xl hover:bg-success hover:text-white',
            'transition-all duration-200'
          )}
        >
          <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
      </Tooltip>
    </nav>
  );
}
