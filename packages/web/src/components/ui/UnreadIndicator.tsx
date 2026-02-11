import { Show } from 'solid-js';
import { clsx } from 'clsx';

interface UnreadIndicatorProps {
  count?: number;
  hasMentions?: boolean;
  class?: string;
}

export function UnreadIndicator(props: UnreadIndicatorProps) {
  const displayCount = () => {
    if (!props.count || props.count <= 0) return null;
    if (props.count > 99) return '99+';
    return props.count.toString();
  };

  return (
    <Show when={props.count && props.count > 0}>
      <span
        class={clsx(
          "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-xs font-bold",
          props.hasMentions 
            ? "bg-danger text-white" 
            : "bg-text-muted text-bg-primary",
          props.class
        )}
      >
        {displayCount()}
      </span>
    </Show>
  );
}

// Dot indicator for simpler unread state (no count)
interface UnreadDotProps {
  isUnread: boolean;
  class?: string;
}

export function UnreadDot(props: UnreadDotProps) {
  return (
    <Show when={props.isUnread}>
      <span 
        class={clsx(
          "w-2 h-2 rounded-full bg-text-primary",
          props.class
        )} 
      />
    </Show>
  );
}
