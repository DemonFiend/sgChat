import { Show } from 'solid-js';
import { voiceStore } from '@/stores/voice';
import { voiceService } from '@/lib/voiceService';

export function VoiceConnectedBar() {
  const handleMuteClick = async () => {
    await voiceService.toggleMute();
  };

  const handleDeafenClick = async () => {
    await voiceService.toggleDeafen();
  };

  const handleDisconnectClick = async () => {
    await voiceService.leave();
  };

  return (
    <Show when={voiceStore.isConnected() || voiceStore.isConnecting()}>
      <div class="bg-bg-tertiary border-t border-bg-modifier-accent p-3">
        {/* Connection Status */}
        <div class="flex items-center gap-2 mb-2">
          <Show 
            when={voiceStore.isConnected()} 
            fallback={
              <>
                <div class="w-2 h-2 bg-warning rounded-full animate-pulse" />
                <span class="text-xs text-warning font-medium">Connecting...</span>
              </>
            }
          >
            <div class={`w-2 h-2 rounded-full ${voiceStore.isSpeaking() ? 'bg-status-online animate-pulse' : 'bg-status-online'}`} />
            <span class="text-xs text-status-online font-medium">Voice Connected</span>
          </Show>
        </div>

        {/* Channel Name */}
        <div class="flex items-center gap-2 mb-3">
          <svg class="w-4 h-4 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          </svg>
          <span class="text-sm text-text-primary font-medium truncate">
            {voiceStore.currentChannelName() || 'Voice Channel'}
          </span>
        </div>

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

          {/* Disconnect Button */}
          <button
            onClick={handleDisconnectClick}
            class="flex items-center justify-center p-2 rounded-md bg-danger/20 text-danger hover:bg-danger/30 transition-colors"
            title="Disconnect"
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
