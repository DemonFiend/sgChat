import { clsx } from 'clsx';

interface UnreadIndicatorProps {
  count?: number;
  hasMentions?: boolean;
  className?: string;
}

export function UnreadIndicator({ count, hasMentions, className }: UnreadIndicatorProps) {
  if (!count || count <= 0) return null;

  const displayCount = count > 99 ? '99+' : count.toString();

  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-xs font-bold",
        hasMentions
          ? "bg-danger text-white"
          : "bg-text-muted text-bg-primary",
        className
      )}
    >
      {displayCount}
    </span>
  );
}

interface UnreadDotProps {
  isUnread: boolean;
  className?: string;
}

export function UnreadDot({ isUnread, className }: UnreadDotProps) {
  if (!isUnread) return null;

  return (
    <span
      className={clsx(
        "w-2 h-2 rounded-full bg-text-primary",
        className
      )}
    />
  );
}
