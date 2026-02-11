import { JSX, Show, createSignal, onCleanup } from 'solid-js';
import { clsx } from 'clsx';

interface TooltipProps {
  content: string;
  children: JSX.Element;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}

export function Tooltip(props: TooltipProps) {
  const [isVisible, setIsVisible] = createSignal(false);
  let timeoutId: ReturnType<typeof setTimeout>;
  let triggerRef: HTMLDivElement | undefined;

  const position = () => props.position || 'top';
  const delay = () => props.delay ?? 300;

  const positionClasses: Record<string, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  const arrowClasses: Record<string, string> = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-bg-tertiary border-x-transparent border-b-transparent',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-bg-tertiary border-x-transparent border-t-transparent',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-bg-tertiary border-y-transparent border-r-transparent',
    right: 'right-full top-1/2 -translate-y-1/2 border-r-bg-tertiary border-y-transparent border-l-transparent',
  };

  const handleMouseEnter = () => {
    timeoutId = setTimeout(() => setIsVisible(true), delay());
  };

  const handleMouseLeave = () => {
    clearTimeout(timeoutId);
    setIsVisible(false);
  };

  onCleanup(() => {
    clearTimeout(timeoutId);
  });

  return (
    <div
      ref={triggerRef}
      class="relative inline-flex"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
    >
      {props.children}

      <Show when={isVisible()}>
        <div
          role="tooltip"
          class={clsx(
            'absolute z-50 px-3 py-2 text-sm font-medium rounded-md shadow-high',
            'bg-bg-tertiary text-text-primary whitespace-nowrap',
            'animate-in fade-in zoom-in-95 duration-100',
            positionClasses[position()]
          )}
        >
          {props.content}
          <div
            class={clsx(
              'absolute w-0 h-0 border-4',
              arrowClasses[position()]
            )}
          />
        </div>
      </Show>
    </div>
  );
}
