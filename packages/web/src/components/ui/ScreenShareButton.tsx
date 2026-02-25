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
  const [showSettingsMenu, setShowSettingsMenu] = createSignal(false);

  const sizeClasses = () => {
    switch (props.size) {
      case 'sm': return 'p-2';
      case 'lg': return 'p-3';
      default: return 'p-2.5';
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
    setShowSettingsMenu(false);
    await voiceService.stopScreenShare();
    await voiceService.startScreenShare(quality);
  };

  const canStream = () => voiceStore.permissions()?.canStream ?? true;

  return (
    <div class="relative flex items-center gap-1">
      {/* Main Screen Share Button */}
      <button
        onClick={handleClick}
        disabled={!canStream()}
        class={clsx(
          'flex items-center justify-center rounded-md transition-colors',
          sizeClasses(),
          !canStream()
            ? 'bg-bg-secondary text-text-muted cursor-not-allowed'
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

      {/* Settings Button - only show when screen sharing */}
      <Show when={voiceStore.isScreenSharing()}>
        <button
          onClick={() => setShowSettingsMenu(!showSettingsMenu())}
          class={clsx(
            'flex items-center justify-center rounded-md transition-colors',
            sizeClasses(),
            'bg-bg-secondary text-text-primary hover:bg-bg-modifier-hover'
          )}
          title="Screen Share Settings"
        >
          <svg class={iconSizeClasses()} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </Show>

      {/* Quality Selection Menu - for starting screen share */}
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

      {/* Settings Menu - for changing quality while streaming */}
      <Show when={showSettingsMenu()}>
        <div class="absolute bottom-full right-0 mb-2 w-48 bg-bg-floating border border-bg-tertiary rounded-lg shadow-lg overflow-hidden z-50">
          <div class="p-2 border-b border-bg-tertiary">
            <span class="text-xs font-semibold text-text-muted uppercase">Change Quality</span>
          </div>
          <div class="p-1">
            <button
              onClick={() => handleQualitySelect('standard')}
              class={clsx(
                "w-full px-3 py-2 text-left text-sm hover:bg-bg-modifier-hover rounded flex items-center justify-between",
                voiceStore.screenShareQuality() === 'standard' ? 'text-status-online' : 'text-text-primary'
              )}
            >
              <span>Standard</span>
              <span class="text-xs text-text-muted">720p 30fps</span>
            </button>
            <button
              onClick={() => handleQualitySelect('high')}
              class={clsx(
                "w-full px-3 py-2 text-left text-sm hover:bg-bg-modifier-hover rounded flex items-center justify-between",
                voiceStore.screenShareQuality() === 'high' ? 'text-status-online' : 'text-text-primary'
              )}
            >
              <span>High</span>
              <span class="text-xs text-text-muted">1080p 60fps</span>
            </button>
            <button
              onClick={() => handleQualitySelect('native')}
              class={clsx(
                "w-full px-3 py-2 text-left text-sm hover:bg-bg-modifier-hover rounded flex items-center justify-between",
                voiceStore.screenShareQuality() === 'native' ? 'text-status-online' : 'text-text-primary'
              )}
            >
              <span>Native</span>
              <span class="text-xs text-text-muted">Full resolution</span>
            </button>
          </div>
          <button
            onClick={() => setShowSettingsMenu(false)}
            class="w-full px-3 py-2 text-sm text-text-muted hover:bg-bg-modifier-hover border-t border-bg-tertiary"
          >
            Close
          </button>
        </div>
        <div
          class="fixed inset-0 z-40"
          onClick={() => setShowSettingsMenu(false)}
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
