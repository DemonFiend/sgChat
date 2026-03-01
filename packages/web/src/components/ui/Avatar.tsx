import { clsx } from 'clsx';

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface AvatarProps {
  src?: string | null;
  alt?: string;
  size?: AvatarSize;
  status?: 'online' | 'idle' | 'dnd' | 'offline' | null;
  className?: string;
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

export function Avatar({ src, alt, size = 'md', status, className }: AvatarProps) {
  const fallbackColor = () => {
    if (!alt) return 'bg-accent';
    const colors = ['bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-green-500', 'bg-teal-500', 'bg-blue-500', 'bg-indigo-500', 'bg-purple-500', 'bg-pink-500'];
    return colors[alt.charCodeAt(0) % colors.length];
  };

  const initials = () => {
    if (!alt) return '?';
    const parts = alt.split(' ');
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return alt.slice(0, 2).toUpperCase();
  };

  return (
    <div className={clsx('relative inline-flex shrink-0', className)}>
      {src ? (
        <img
          src={src}
          alt={alt || 'Avatar'}
          loading="lazy"
          decoding="async"
          className={clsx('rounded-full object-cover', sizeClasses[size])}
        />
      ) : (
        <div
          className={clsx(
            'rounded-full flex items-center justify-center text-white font-semibold',
            sizeClasses[size],
            fallbackColor()
          )}
        >
          <span className={size === 'xs' || size === 'sm' ? 'text-xs' : 'text-sm'}>
            {initials()}
          </span>
        </div>
      )}

      {status && (
        <span
          className={clsx(
            'absolute bottom-0 right-0 rounded-full border-bg-primary',
            statusSizeClasses[size],
            statusColors[status]
          )}
        />
      )}
    </div>
  );
}
