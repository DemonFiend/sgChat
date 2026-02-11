import { Show } from 'solid-js';
import { clsx } from 'clsx';

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface AvatarProps {
  src?: string | null;
  alt?: string;
  size?: AvatarSize;
  status?: 'online' | 'idle' | 'dnd' | 'offline' | null;
  class?: string;
}

const sizeClasses: Record<AvatarSize, string> = {
  xs: 'w-6 h-6',
  sm: 'w-8 h-8',
  md: 'w-10 h-10',
  lg: 'w-12 h-12',
  xl: 'w-20 h-20',
};

const statusSizeClasses: Record<AvatarSize, string> = {
  xs: 'w-2 h-2 border',
  sm: 'w-2.5 h-2.5 border',
  md: 'w-3 h-3 border-2',
  lg: 'w-3.5 h-3.5 border-2',
  xl: 'w-5 h-5 border-2',
};

const statusColors: Record<string, string> = {
  online: 'bg-status-online',
  idle: 'bg-status-idle',
  dnd: 'bg-status-dnd',
  offline: 'bg-status-offline',
};

export function Avatar(props: AvatarProps) {
  const size = () => props.size || 'md';
  
  // Generate color from name for fallback
  const fallbackColor = () => {
    if (!props.alt) return 'bg-accent';
    const colors = ['bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-green-500', 'bg-teal-500', 'bg-blue-500', 'bg-indigo-500', 'bg-purple-500', 'bg-pink-500'];
    const index = props.alt.charCodeAt(0) % colors.length;
    return colors[index];
  };

  const initials = () => {
    if (!props.alt) return '?';
    const parts = props.alt.split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return props.alt.slice(0, 2).toUpperCase();
  };

  return (
    <div class={clsx('relative inline-flex shrink-0', props.class)}>
      <Show
        when={props.src}
        fallback={
          <div
            class={clsx(
              'rounded-full flex items-center justify-center text-white font-semibold',
              sizeClasses[size()],
              fallbackColor()
            )}
          >
            <span class={size() === 'xs' ? 'text-xs' : size() === 'sm' ? 'text-xs' : 'text-sm'}>
              {initials()}
            </span>
          </div>
        }
      >
        <img
          src={props.src!}
          alt={props.alt || 'Avatar'}
          loading="lazy"
          decoding="async"
          class={clsx('rounded-full object-cover', sizeClasses[size()])}
        />
      </Show>

      <Show when={props.status}>
        <span
          class={clsx(
            'absolute bottom-0 right-0 rounded-full border-bg-primary',
            statusSizeClasses[size()],
            statusColors[props.status!]
          )}
        />
      </Show>
    </div>
  );
}
