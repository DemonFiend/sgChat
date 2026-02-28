import { Show, createSignal, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Avatar } from './Avatar';
import { voiceService } from '@/lib/voiceService';
import { voiceStore } from '@/stores/voice';

interface UserProfilePopoverProps {
  onClose: () => void;
  anchorRect: { top: number; left: number; bottom: number; right: number };
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  status?: 'online' | 'idle' | 'dnd' | 'offline';
  roleColor?: string | null;
  customStatus?: string | null;
  isInVoice?: boolean;
  voiceChannelId?: string;
  canMoveMembers?: boolean;
  canDisconnectMembers?: boolean;
  isCurrentUser?: boolean;
}

export function UserProfilePopover(props: UserProfilePopoverProps) {
  let popoverRef: HTMLDivElement | undefined;
  const [volume, setVolume] = createSignal(voiceService.getUserVolume(props.userId));
  const [locallyMuted, setLocallyMuted] = createSignal(voiceService.isLocallyMuted(props.userId));

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onClose();
  };

  const handleClickOutside = (e: MouseEvent) => {
    if (popoverRef && !popoverRef.contains(e.target as Node)) {
      props.onClose();
    }
  };

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown);
    requestAnimationFrame(() => {
      document.addEventListener('mousedown', handleClickOutside);
    });
  });

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('mousedown', handleClickOutside);
  });

  // Position the popover relative to the anchor
  const position = () => {
    const popoverWidth = 300;
    const popoverHeight = 340;
    const padding = 8;
    const anchor = props.anchorRect;

    // Try to position to the left of the anchor
    let x = anchor.left - popoverWidth - padding;
    if (x < padding) {
      // If not enough space on the left, position to the right
      x = anchor.right + padding;
    }
    if (x + popoverWidth > window.innerWidth - padding) {
      x = window.innerWidth - popoverWidth - padding;
    }

    // Center vertically relative to anchor
    let y = anchor.top + (anchor.bottom - anchor.top) / 2 - popoverHeight / 2;
    y = Math.max(padding, Math.min(y, window.innerHeight - popoverHeight - padding));

    return { x, y };
  };

  const displayName = () => props.displayName || props.username;

  const handleVolumeChange = (value: number) => {
    setVolume(value);
    voiceService.setUserVolume(props.userId, value);
  };

  const handleToggleLocalMute = () => {
    voiceService.toggleLocalMute(props.userId);
    setLocallyMuted(voiceService.isLocallyMuted(props.userId));
  };

  const handleDisconnect = async () => {
    if (props.voiceChannelId) {
      try {
        await voiceService.disconnectMember(props.userId, props.voiceChannelId);
      } catch (err) {
        console.error('[UserProfilePopover] Failed to disconnect member:', err);
      }
    }
    props.onClose();
  };

  const showVoiceControls = () =>
    props.isInVoice && !props.isCurrentUser && voiceStore.isConnected();

  return (
    <Portal>
      <div
        ref={popoverRef}
        class="fixed z-[90] w-[300px] bg-bg-primary rounded-lg shadow-high border border-divider overflow-hidden"
        style={{
          left: `${position().x}px`,
          top: `${position().y}px`,
        }}
      >
        {/* Banner / Header */}
        <div class="h-16 bg-brand-primary/30 relative">
          <div class="absolute -bottom-8 left-4">
            <div class="ring-4 ring-bg-primary rounded-full">
              <Avatar
                src={props.avatarUrl}
                alt={displayName()}
                size="lg"
                status={props.status}
              />
            </div>
          </div>
        </div>

        {/* User Info */}
        <div class="pt-10 px-4 pb-3">
          <div class="flex items-center gap-1.5">
            <h3
              class="text-lg font-semibold truncate"
              style={{ color: props.roleColor || 'var(--color-text-primary)' }}
            >
              {displayName()}
            </h3>
          </div>
          <p class="text-sm text-text-muted">{props.username}</p>

          <Show when={props.customStatus}>
            <p class="mt-1 text-sm text-text-secondary">{props.customStatus}</p>
          </Show>
        </div>

        <div class="border-t border-divider mx-3" />

        {/* Voice Controls */}
        <Show when={showVoiceControls()}>
          <div class="px-4 py-3">
            <h4 class="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
              User Volume
            </h4>

            {/* Volume Slider */}
            <div class="flex items-center gap-2">
              <button
                onClick={handleToggleLocalMute}
                class={`p-1 rounded transition-colors ${
                  locallyMuted()
                    ? 'text-danger hover:bg-danger/10'
                    : 'text-text-muted hover:bg-bg-modifier-hover'
                }`}
                title={locallyMuted() ? 'Unmute' : 'Mute'}
              >
                <Show
                  when={!locallyMuted() && volume() > 0}
                  fallback={
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                  }
                >
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  </svg>
                </Show>
              </button>

              <input
                type="range"
                min={0}
                max={200}
                value={volume()}
                onInput={(e) => handleVolumeChange(parseInt(e.currentTarget.value))}
                class="flex-1 h-1.5 accent-brand-primary cursor-pointer"
              />

              <span class="text-xs text-text-muted w-9 text-right">{volume()}%</span>
            </div>
          </div>

          <div class="border-t border-divider mx-3" />
        </Show>

        {/* Moderator Actions */}
        <Show when={showVoiceControls() && (props.canMoveMembers || props.canDisconnectMembers)}>
          <div class="px-4 py-3 space-y-1">
            <Show when={props.canDisconnectMembers}>
              <button
                onClick={handleDisconnect}
                class="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-danger rounded hover:bg-danger/10 transition-colors"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
                Disconnect from Voice
              </button>
            </Show>
          </div>
        </Show>
      </div>
    </Portal>
  );
}
