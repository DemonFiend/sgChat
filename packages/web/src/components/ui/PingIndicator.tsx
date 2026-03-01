import { useState, useMemo } from 'react';
import { clsx } from 'clsx';
import { useVoiceStore, type ConnectionQualityLevel } from '@/stores/voice';

interface PingIndicatorProps {
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  showTooltip?: boolean;
  className?: string;
}

export function PingIndicator({ size = 'md', showLabel, showTooltip: enableTooltip, className }: PingIndicatorProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const quality = useVoiceStore((s) => s.connectionQuality);

  const sizeClasses = size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-8 h-8' : 'w-5 h-5';
  const heights = useMemo(() => {
    switch (size) {
      case 'sm': return { h1: 3, h2: 5, h3: 7, h4: 9 };
      case 'lg': return { h1: 6, h2: 10, h3: 14, h4: 18 };
      default: return { h1: 4, h2: 7, h3: 10, h4: 13 };
    }
  }, [size]);

  const getQualityColor = (level: ConnectionQualityLevel) => {
    switch (level) {
      case 'excellent': case 'good': return 'text-status-online';
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

  const activeBars = getActiveBars(quality.level);
  const color = getQualityColor(quality.level);
  const pingLabel = quality.ping !== null ? `${quality.ping}ms` : '';

  return (
    <div
      className={clsx('relative flex items-center gap-1.5', className)}
      onMouseEnter={() => enableTooltip !== false && setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Signal Bars */}
      <div className={clsx('flex items-end gap-0.5', sizeClasses)}>
        {[heights.h1, heights.h2, heights.h3, heights.h4].map((h, i) => (
          <div
            key={i}
            className={clsx(
              'w-1 rounded-sm transition-colors',
              activeBars >= i + 1 ? `${color} bg-current` : 'bg-bg-tertiary'
            )}
            style={{ height: `${h}px` }}
          />
        ))}
      </div>

      {/* Optional Label */}
      {showLabel && quality.ping !== null && (
        <span className={clsx('text-xs font-medium', color)}>
          {pingLabel}
        </span>
      )}

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-bg-floating border border-bg-tertiary rounded-lg shadow-lg z-50 whitespace-nowrap">
          <div className="flex items-center gap-2 mb-1">
            <span className={clsx('font-medium', color)}>
              {getQualityLabel(quality.level)}
            </span>
          </div>
          {quality.ping !== null && (
            <div className="flex items-center justify-between gap-4 text-xs">
              <span className="text-text-muted">Latency</span>
              <span className="text-text-primary">{pingLabel}</span>
            </div>
          )}
          {quality.jitter !== null && (
            <div className="flex items-center justify-between gap-4 text-xs">
              <span className="text-text-muted">Jitter</span>
              <span className="text-text-primary">{quality.jitter}ms</span>
            </div>
          )}
          {quality.packetLoss !== null && (
            <div className="flex items-center justify-between gap-4 text-xs">
              <span className="text-text-muted">Packet Loss</span>
              <span className="text-text-primary">{quality.packetLoss}%</span>
            </div>
          )}
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 bg-bg-floating border-r border-b border-bg-tertiary transform rotate-45" />
        </div>
      )}
    </div>
  );
}

interface ConnectionStatusDotProps {
  className?: string;
}

export function ConnectionStatusDot({ className }: ConnectionStatusDotProps) {
  const isConnected = useVoiceStore((s) => s.connectionState === 'connected');
  const quality = useVoiceStore((s) => s.connectionQuality);

  const getDotColor = (level: ConnectionQualityLevel) => {
    switch (level) {
      case 'excellent': case 'good': return 'bg-status-online';
      case 'poor': return 'bg-status-idle';
      case 'lost': return 'bg-danger animate-pulse';
      default: return 'bg-text-muted';
    }
  };

  if (!isConnected) return null;

  return (
    <div
      className={clsx('w-2 h-2 rounded-full', getDotColor(quality.level), className)}
      title={`Connection: ${quality.level}${quality.ping ? ` (${quality.ping}ms)` : ''}`}
    />
  );
}
