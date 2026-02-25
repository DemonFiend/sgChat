import { Show, createSignal } from 'solid-js';
import { clsx } from 'clsx';
import { voiceStore, type ScreenShareQuality } from '@/stores/voice';
import { voiceService } from '@/lib/voiceService';

interface ScreenShareButtonProps {
  size?: 'sm' | 'md' | 'lg';
  class?: string;
  showQualityMenu?: boolean;
}

export function ScreenShareButton(props: ScreenShareButtonProps) {
  const [showMenu, setShowMenu] = createSignal(false);

  const sizeClasses = () => {
    switch (props.size) {
      case 'sm': return 'w-8 h-8';
      case 'lg': return 'w-12 h-12';
      default: return 'w-10 h-10';
    }
  };

  const iconSizeClasses = () => {
    switch (props.size) {
      case 'sm': return 'w-4 h-4';
      case 'lg': return 'w-6 h-6';
      default: return 'w-5 h-5';
    }
  };

  const handleClick = async () => {
    if (voiceStore.isScreenSharing()) {
      await voiceService.stopScreenShare();
    } else if (props.showQualityMenu) {
      setShowMenu(true);
    } else {
      await voiceService.startScreenShare();
    }
  };

  const handleQualitySelect = async (quality: ScreenShareQuality) => {
    setShowMenu(false);
    await voiceService.startScreenShare(quality);
  };

  const canStream = () => voiceStore.permissions()?.canStream ?? false;

  return (
    <div class="relative">
      <button
        onClick={handleClick}
        disabled={!canStream()}
        class={clsx(
          'flex items-center justify-center rounded-full transition-colors',
          sizeClasses(),
          !canStream()
            ? 'bg-bg-secondary text-text-muted cursor-not-allowed opacity-50'
            : voiceStore.isScreenSharing()
              ? 'bg-status-online/20 text-status-online hover:bg-status-online/30'
              : 'bg-bg-secondary text-text-primary hover:bg-bg-modifier-hover',
          props.class
        )}
        title={
          !canStream()
            ? 'You do not have permission to share your screen'
            : voiceStore.isScreenSharing()
              ? 'Stop Sharing'
              : 'Share Screen'
        }
      >
        <Show
          when={voiceStore.isScreenSharing()}
          fallback={
            <svg class={iconSizeClasses()} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          }
        >
          <svg class={iconSizeClasses()} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </Show>
      </button>

      {/* Quality Selection Menu */}
      <Show when={showMenu()}>
        <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-bg-floating border border-bg-tertiary rounded-lg shadow-lg overflow-hidden z-50">
          <div class="p-2 border-b border-bg-tertiary">
            <span class="text-xs font-semibold text-text-muted uppercase">Screen Share Quality</span>
          </div>
          <div class="p-1">
            <button
              onClick={() => handleQualitySelect('standard')}
              class="w-full px-3 py-2 text-left text-sm text-text-primary hover:bg-bg-modifier-hover rounded flex items-center justify-between"
            >
              <span>Standard</span>
              <span class="text-xs text-text-muted">720p 30fps</span>
            </button>
            <button
              onClick={() => handleQualitySelect('high')}
              class="w-full px-3 py-2 text-left text-sm text-text-primary hover:bg-bg-modifier-hover rounded flex items-center justify-between"
            >
              <span>High</span>
              <span class="text-xs text-text-muted">1080p 60fps</span>
            </button>
            <button
              onClick={() => handleQualitySelect('native')}
              class="w-full px-3 py-2 text-left text-sm text-text-primary hover:bg-bg-modifier-hover rounded flex items-center justify-between"
            >
              <span>Native</span>
              <span class="text-xs text-text-muted">Full resolution</span>
            </button>
          </div>
          <button
            onClick={() => setShowMenu(false)}
            class="w-full px-3 py-2 text-sm text-text-muted hover:bg-bg-modifier-hover border-t border-bg-tertiary"
          >
            Cancel
          </button>
        </div>
        <div
          class="fixed inset-0 z-40"
          onClick={() => setShowMenu(false)}
        />
      </Show>
    </div>
  );
}

interface ScreenShareQualityIndicatorProps {
  class?: string;
}

export function ScreenShareQualityIndicator(props: ScreenShareQualityIndicatorProps) {
  const qualityLabel = () => {
    switch (voiceStore.screenShareQuality()) {
      case 'high': return '1080p';
      case 'native': return 'Native';
      default: return '720p';
    }
  };

  return (
    <Show when={voiceStore.isScreenSharing()}>
      <div class={clsx('flex items-center gap-1 px-2 py-0.5 bg-status-online/20 text-status-online rounded text-xs font-medium', props.class)}>
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        <span>{qualityLabel()}</span>
      </div>
    </Show>
  );
}
