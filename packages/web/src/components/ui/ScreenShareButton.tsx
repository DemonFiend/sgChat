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
        <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-56 bg-bg-primary border-2 border-brand-primary/50 rounded-xl shadow-2xl overflow-hidden z-50">
          {/* Header with icon */}
          <div class="p-3 bg-brand-primary/10 border-b border-brand-primary/30">
            <div class="flex items-center gap-2">
              <svg class="w-5 h-5 text-brand-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span class="text-sm font-semibold text-text-primary">Select Quality</span>
            </div>
          </div>
          <div class="p-2">
            <button
              onClick={() => handleQualitySelect('standard')}
              class="w-full px-4 py-3 text-left text-sm text-text-primary hover:bg-brand-primary/20 rounded-lg flex items-center justify-between transition-colors"
            >
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <span class="text-blue-400 font-bold text-xs">SD</span>
                </div>
                <div>
                  <div class="font-medium">Standard</div>
                  <div class="text-xs text-text-muted">720p @ 30fps</div>
                </div>
              </div>
            </button>
            <button
              onClick={() => handleQualitySelect('high')}
              class="w-full px-4 py-3 text-left text-sm text-text-primary hover:bg-brand-primary/20 rounded-lg flex items-center justify-between transition-colors"
            >
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
                  <span class="text-purple-400 font-bold text-xs">HD</span>
                </div>
                <div>
                  <div class="font-medium">High Quality</div>
                  <div class="text-xs text-text-muted">1080p @ 60fps</div>
                </div>
              </div>
            </button>
            <button
              onClick={() => handleQualitySelect('native')}
              class="w-full px-4 py-3 text-left text-sm text-text-primary hover:bg-brand-primary/20 rounded-lg flex items-center justify-between transition-colors"
            >
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                  <span class="text-green-400 font-bold text-xs">4K</span>
                </div>
                <div>
                  <div class="font-medium">Native</div>
                  <div class="text-xs text-text-muted">Full resolution</div>
                </div>
              </div>
            </button>
          </div>
          <button
            onClick={() => setShowMenu(false)}
            class="w-full px-4 py-2.5 text-sm text-text-muted hover:text-text-primary hover:bg-bg-secondary border-t border-bg-tertiary transition-colors"
          >
            Cancel
          </button>
        </div>
        <div
          class="fixed inset-0 z-40 bg-black/20"
          onClick={() => setShowMenu(false)}
        />
      </Show>

      {/* Settings Menu - for changing quality while streaming */}
      <Show when={showSettingsMenu()}>
        <div class="absolute bottom-full right-0 mb-3 w-56 bg-bg-primary border-2 border-status-online/50 rounded-xl shadow-2xl overflow-hidden z-50">
          {/* Header */}
          <div class="p-3 bg-status-online/10 border-b border-status-online/30">
            <div class="flex items-center gap-2">
              <svg class="w-5 h-5 text-status-online" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span class="text-sm font-semibold text-text-primary">Change Quality</span>
            </div>
          </div>
          <div class="p-2">
            <button
              onClick={() => handleQualitySelect('standard')}
              class={clsx(
                "w-full px-4 py-3 text-left text-sm rounded-lg flex items-center gap-3 transition-colors",
                voiceStore.screenShareQuality() === 'standard' 
                  ? 'bg-status-online/20 text-status-online' 
                  : 'text-text-primary hover:bg-bg-modifier-hover'
              )}
            >
              <div class={clsx(
                "w-8 h-8 rounded-full flex items-center justify-center",
                voiceStore.screenShareQuality() === 'standard' ? 'bg-status-online/30' : 'bg-blue-500/20'
              )}>
                <span class={clsx("font-bold text-xs", voiceStore.screenShareQuality() === 'standard' ? 'text-status-online' : 'text-blue-400')}>SD</span>
              </div>
              <div>
                <div class="font-medium">Standard</div>
                <div class="text-xs text-text-muted">720p @ 30fps</div>
              </div>
              {voiceStore.screenShareQuality() === 'standard' && (
                <svg class="w-5 h-5 ml-auto text-status-online" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              )}
            </button>
            <button
              onClick={() => handleQualitySelect('high')}
              class={clsx(
                "w-full px-4 py-3 text-left text-sm rounded-lg flex items-center gap-3 transition-colors",
                voiceStore.screenShareQuality() === 'high' 
                  ? 'bg-status-online/20 text-status-online' 
                  : 'text-text-primary hover:bg-bg-modifier-hover'
              )}
            >
              <div class={clsx(
                "w-8 h-8 rounded-full flex items-center justify-center",
                voiceStore.screenShareQuality() === 'high' ? 'bg-status-online/30' : 'bg-purple-500/20'
              )}>
                <span class={clsx("font-bold text-xs", voiceStore.screenShareQuality() === 'high' ? 'text-status-online' : 'text-purple-400')}>HD</span>
              </div>
              <div>
                <div class="font-medium">High Quality</div>
                <div class="text-xs text-text-muted">1080p @ 60fps</div>
              </div>
              {voiceStore.screenShareQuality() === 'high' && (
                <svg class="w-5 h-5 ml-auto text-status-online" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              )}
            </button>
            <button
              onClick={() => handleQualitySelect('native')}
              class={clsx(
                "w-full px-4 py-3 text-left text-sm rounded-lg flex items-center gap-3 transition-colors",
                voiceStore.screenShareQuality() === 'native' 
                  ? 'bg-status-online/20 text-status-online' 
                  : 'text-text-primary hover:bg-bg-modifier-hover'
              )}
            >
              <div class={clsx(
                "w-8 h-8 rounded-full flex items-center justify-center",
                voiceStore.screenShareQuality() === 'native' ? 'bg-status-online/30' : 'bg-green-500/20'
              )}>
                <span class={clsx("font-bold text-xs", voiceStore.screenShareQuality() === 'native' ? 'text-status-online' : 'text-green-400')}>4K</span>
              </div>
              <div>
                <div class="font-medium">Native</div>
                <div class="text-xs text-text-muted">Full resolution</div>
              </div>
              {voiceStore.screenShareQuality() === 'native' && (
                <svg class="w-5 h-5 ml-auto text-status-online" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              )}
            </button>
          </div>
          <button
            onClick={() => setShowSettingsMenu(false)}
            class="w-full px-4 py-2.5 text-sm text-text-muted hover:text-text-primary hover:bg-bg-secondary border-t border-bg-tertiary transition-colors"
          >
            Close
          </button>
        </div>
        <div
          class="fixed inset-0 z-40 bg-black/20"
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
