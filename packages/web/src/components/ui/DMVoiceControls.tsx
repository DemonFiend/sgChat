import { Show, createSignal } from 'solid-js';
import { clsx } from 'clsx';
import { voiceStore } from '@/stores/voice';
import { dmVoiceService } from '@/lib/dmVoiceService';
import { ScreenShareButton } from './ScreenShareButton';
import { PingIndicator } from './PingIndicator';

interface DMVoiceControlsProps {
  dmChannelId: string;
  friendId: string;
  friendName: string;
  class?: string;
}

export function DMVoiceControls(props: DMVoiceControlsProps) {
  const [isJoining, setIsJoining] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const isInDMCall = () => {
    return voiceStore.isConnected() && voiceStore.currentChannelId() === props.dmChannelId;
  };

  const handleVoiceCall = async () => {
    setError(null);
    
    if (isInDMCall()) {
      await dmVoiceService.leave();
      return;
    }

    // If in another call, leave first
    if (voiceStore.isConnected()) {
      await dmVoiceService.leave();
    }

    setIsJoining(true);
    try {
      await dmVoiceService.join(props.dmChannelId, props.friendName);
    } catch (err: any) {
      setError(err?.message || 'Failed to start call');
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div class={clsx('flex items-center gap-2', props.class)}>
      {/* Voice Call Button */}
      <button
        onClick={handleVoiceCall}
        disabled={isJoining()}
        class={clsx(
          'w-10 h-10 rounded-full flex items-center justify-center transition-colors',
          isInDMCall()
            ? 'bg-danger/20 text-danger hover:bg-danger/30'
            : 'bg-bg-tertiary text-text-muted hover:text-text-primary hover:bg-bg-modifier-hover',
          isJoining() && 'opacity-50 cursor-wait'
        )}
        title={isInDMCall() ? 'End Call' : 'Start Voice Call'}
      >
        <Show
          when={!isJoining()}
          fallback={
            <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          }
        >
          <Show
            when={isInDMCall()}
            fallback={
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            }
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
            </svg>
          </Show>
        </Show>
      </button>

      {/* Screen Share Button (only show when in call) */}
      <Show when={isInDMCall()}>
        <ScreenShareButton size="sm" showQualityMenu />
      </Show>

      {/* Ping Indicator (only show when in call) */}
      <Show when={isInDMCall()}>
        <PingIndicator size="sm" showTooltip />
      </Show>

      {/* Error Display */}
      <Show when={error()}>
        <span class="text-xs text-danger">{error()}</span>
      </Show>
    </div>
  );
}

interface DMCallStatusBarProps {
  dmChannelId: string;
  friendName: string;
  class?: string;
}

export function DMCallStatusBar(props: DMCallStatusBarProps) {
  const isInDMCall = () => {
    return voiceStore.isConnected() && voiceStore.currentChannelId() === props.dmChannelId;
  };

  const handleMuteClick = async () => {
    await dmVoiceService.toggleMute();
  };

  const handleDeafenClick = async () => {
    await dmVoiceService.toggleDeafen();
  };

  const handleEndCall = async () => {
    await dmVoiceService.leave();
  };

  return (
    <Show when={isInDMCall()}>
      <div class={clsx('bg-bg-tertiary border-t border-bg-modifier-accent p-3', props.class)}>
        {/* Connection Status */}
        <div class="flex items-center justify-between gap-2 mb-2">
          <div class="flex items-center gap-2">
            <div class={`w-2 h-2 rounded-full ${voiceStore.isSpeaking() ? 'bg-status-online animate-pulse' : 'bg-status-online'}`} />
            <span class="text-xs text-status-online font-medium">In Call with {props.friendName}</span>
          </div>
          <PingIndicator size="sm" showLabel showTooltip />
        </div>

        {/* Screen Share Status */}
        <Show when={voiceStore.isScreenSharing()}>
          <div class="flex items-center gap-2 mb-2">
            <div class="flex items-center gap-1 px-2 py-0.5 bg-status-online/20 text-status-online rounded text-xs font-medium">
              <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span>Sharing Screen</span>
            </div>
          </div>
        </Show>

        {/* Controls */}
        <div class="flex items-center gap-2">
          {/* Mute Button */}
          <button
            onClick={handleMuteClick}
            class={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              voiceStore.isMuted()
                ? 'bg-danger/20 text-danger hover:bg-danger/30'
                : 'bg-bg-secondary text-text-primary hover:bg-bg-modifier-hover'
            }`}
            title={voiceStore.isMuted() ? 'Unmute' : 'Mute'}
          >
            <Show
              when={voiceStore.isMuted()}
              fallback={
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              }
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            </Show>
          </button>

          {/* Deafen Button */}
          <button
            onClick={handleDeafenClick}
            class={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              voiceStore.isDeafened()
                ? 'bg-danger/20 text-danger hover:bg-danger/30'
                : 'bg-bg-secondary text-text-primary hover:bg-bg-modifier-hover'
            }`}
            title={voiceStore.isDeafened() ? 'Undeafen' : 'Deafen'}
          >
            <Show
              when={voiceStore.isDeafened()}
              fallback={
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              }
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            </Show>
          </button>

          {/* Screen Share Button */}
          <ScreenShareButton size="sm" showQualityMenu />

          {/* End Call Button */}
          <button
            onClick={handleEndCall}
            class="flex items-center justify-center p-2 rounded-md bg-danger/20 text-danger hover:bg-danger/30 transition-colors"
            title="End Call"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
            </svg>
          </button>
        </div>

        {/* Error State */}
        <Show when={voiceStore.error()}>
          <div class="mt-2 text-xs text-danger">
            {voiceStore.error()}
          </div>
        </Show>
      </div>
    </Show>
  );
}
