import { Show, createSignal } from 'solid-js';
import { clsx } from 'clsx';
import { voiceStore, type ConnectionQualityLevel } from '@/stores/voice';

interface PingIndicatorProps {
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  showTooltip?: boolean;
  class?: string;
}

export function PingIndicator(props: PingIndicatorProps) {
  const [showTooltip, setShowTooltip] = createSignal(false);

  const sizeClasses = () => {
    switch (props.size) {
      case 'sm': return 'w-4 h-4';
      case 'lg': return 'w-8 h-8';
      default: return 'w-5 h-5';
    }
  };

  const barHeight = () => {
    switch (props.size) {
      case 'sm': return { h1: 3, h2: 5, h3: 7, h4: 9 };
      case 'lg': return { h1: 6, h2: 10, h3: 14, h4: 18 };
      default: return { h1: 4, h2: 7, h3: 10, h4: 13 };
    }
  };

  const quality = () => voiceStore.connectionQuality();

  const getQualityColor = (level: ConnectionQualityLevel) => {
    switch (level) {
      case 'excellent': return 'text-status-online';
      case 'good': return 'text-status-online';
      case 'poor': return 'text-status-idle';
      case 'lost': return 'text-danger';
      default: return 'text-text-muted';
    }
  };

  const getActiveBars = (level: ConnectionQualityLevel) => {
    switch (level) {
      case 'excellent': return 4;
      case 'good': return 3;
      case 'poor': return 2;
      case 'lost': return 1;
      default: return 0;
    }
  };

  const getQualityLabel = (level: ConnectionQualityLevel) => {
    switch (level) {
      case 'excellent': return 'Excellent';
      case 'good': return 'Good';
      case 'poor': return 'Poor';
      case 'lost': return 'Lost';
      default: return 'Unknown';
    }
  };

  const getPingLabel = () => {
    const ping = quality().ping;
    if (ping === null) return '';
    return `${ping}ms`;
  };

  const heights = barHeight();
  const activeBars = () => getActiveBars(quality().level);
  const color = () => getQualityColor(quality().level);

  return (
    <div
      class={clsx('relative flex items-center gap-1.5', props.class)}
      onMouseEnter={() => props.showTooltip !== false && setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Signal Bars */}
      <div class={clsx('flex items-end gap-0.5', sizeClasses())}>
        <div
          class={clsx(
            'w-1 rounded-sm transition-colors',
            activeBars() >= 1 ? color() : 'bg-bg-tertiary'
          )}
          style={{ height: `${heights.h1}px`, background: activeBars() >= 1 ? undefined : undefined }}
          classList={{ 'bg-current': activeBars() >= 1 }}
        />
        <div
          class={clsx(
            'w-1 rounded-sm transition-colors',
            activeBars() >= 2 ? color() : 'bg-bg-tertiary'
          )}
          style={{ height: `${heights.h2}px` }}
          classList={{ 'bg-current': activeBars() >= 2 }}
        />
        <div
          class={clsx(
            'w-1 rounded-sm transition-colors',
            activeBars() >= 3 ? color() : 'bg-bg-tertiary'
          )}
          style={{ height: `${heights.h3}px` }}
          classList={{ 'bg-current': activeBars() >= 3 }}
        />
        <div
          class={clsx(
            'w-1 rounded-sm transition-colors',
            activeBars() >= 4 ? color() : 'bg-bg-tertiary'
          )}
          style={{ height: `${heights.h4}px` }}
          classList={{ 'bg-current': activeBars() >= 4 }}
        />
      </div>

      {/* Optional Label */}
      <Show when={props.showLabel && quality().ping !== null}>
        <span class={clsx('text-xs font-medium', color())}>
          {getPingLabel()}
        </span>
      </Show>

      {/* Tooltip */}
      <Show when={showTooltip()}>
        <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-bg-floating border border-bg-tertiary rounded-lg shadow-lg z-50 whitespace-nowrap">
          <div class="flex items-center gap-2 mb-1">
            <span class={clsx('font-medium', color())}>
              {getQualityLabel(quality().level)}
            </span>
          </div>
          <Show when={quality().ping !== null}>
            <div class="flex items-center justify-between gap-4 text-xs">
              <span class="text-text-muted">Latency</span>
              <span class="text-text-primary">{getPingLabel()}</span>
            </div>
          </Show>
          <Show when={quality().jitter !== null}>
            <div class="flex items-center justify-between gap-4 text-xs">
              <span class="text-text-muted">Jitter</span>
              <span class="text-text-primary">{quality().jitter}ms</span>
            </div>
          </Show>
          <Show when={quality().packetLoss !== null}>
            <div class="flex items-center justify-between gap-4 text-xs">
              <span class="text-text-muted">Packet Loss</span>
              <span class="text-text-primary">{quality().packetLoss}%</span>
            </div>
          </Show>
          <div class="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 bg-bg-floating border-r border-b border-bg-tertiary transform rotate-45" />
        </div>
      </Show>
    </div>
  );
}

interface ConnectionStatusDotProps {
  class?: string;
}

export function ConnectionStatusDot(props: ConnectionStatusDotProps) {
  const quality = () => voiceStore.connectionQuality();

  const getDotColor = (level: ConnectionQualityLevel) => {
    switch (level) {
      case 'excellent':
      case 'good':
        return 'bg-status-online';
      case 'poor':
        return 'bg-status-idle';
      case 'lost':
        return 'bg-danger animate-pulse';
      default:
        return 'bg-text-muted';
    }
  };

  return (
    <Show when={voiceStore.isConnected()}>
      <div
        class={clsx(
          'w-2 h-2 rounded-full',
          getDotColor(quality().level),
          props.class
        )}
        title={`Connection: ${quality().level}${quality().ping ? ` (${quality().ping}ms)` : ''}`}
      />
    </Show>
  );
}
