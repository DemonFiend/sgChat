import { useVoiceStore } from '@/stores/voice';
import { voiceService } from '@/lib/voiceService';
import { ScreenShareButton, ScreenShareQualityIndicator } from './ScreenShareButton';
import { PingIndicator } from './PingIndicator';

export function VoiceConnectedBar() {
  const connectionState = useVoiceStore((s) => s.connectionState);
  const isSpeaking = useVoiceStore((s) => s.localState.isSpeaking);
  const isMuted = useVoiceStore((s) => s.localState.isMuted);
  const isDeafened = useVoiceStore((s) => s.localState.isDeafened);
  const isScreenSharing = useVoiceStore((s) => s.screenShare.isSharing);
  const currentChannelName = useVoiceStore((s) => s.currentChannelName);
  const error = useVoiceStore((s) => s.error);

  const isConnected = connectionState === 'connected';
  const isConnecting = connectionState === 'connecting';

  if (!isConnected && !isConnecting) return null;

  return (
    <div className="bg-bg-tertiary border-t border-bg-modifier-accent p-3">
      {/* Connection Status */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          {isConnected ? (
            <>
              <div className={`w-2 h-2 rounded-full ${isSpeaking ? 'bg-status-online animate-pulse' : 'bg-status-online'}`} />
              <span className="text-xs text-status-online font-medium">Voice Connected</span>
            </>
          ) : (
            <>
              <div className="w-2 h-2 bg-warning rounded-full animate-pulse" />
              <span className="text-xs text-warning font-medium">Connecting...</span>
            </>
          )}
        </div>
        {isConnected && <PingIndicator size="sm" showLabel showTooltip />}
      </div>

      {/* Screen Share Status */}
      {isScreenSharing && (
        <div className="flex items-center gap-2 mb-2">
          <ScreenShareQualityIndicator />
        </div>
      )}

      {/* Channel Name */}
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-4 h-4 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
        </svg>
        <span className="text-sm text-text-primary font-medium truncate">
          {currentChannelName || 'Voice Channel'}
        </span>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => voiceService.toggleMute()}
          className={`flex items-center justify-center p-2 rounded-md transition-colors ${
            isMuted
              ? 'bg-danger/20 text-danger hover:bg-danger/30'
              : 'bg-bg-secondary text-text-primary hover:bg-bg-modifier-hover'
          }`}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 14l4-4m0 4l-4-4" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          )}
        </button>

        <button
          onClick={() => voiceService.toggleDeafen()}
          className={`flex items-center justify-center p-2 rounded-md transition-colors ${
            isDeafened
              ? 'bg-danger/20 text-danger hover:bg-danger/30'
              : 'bg-bg-secondary text-text-primary hover:bg-bg-modifier-hover'
          }`}
          title={isDeafened ? 'Undeafen' : 'Deafen'}
        >
          {isDeafened ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
          )}
        </button>

        <ScreenShareButton size="sm" showQualityMenu />

        <button
          onClick={() => voiceService.leave()}
          className="flex items-center justify-center p-2 rounded-md bg-danger/20 text-danger hover:bg-danger/30 transition-colors"
          title="Disconnect"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
          </svg>
        </button>
      </div>

      {error && (
        <div className="mt-2 text-xs text-danger">{error}</div>
      )}
    </div>
  );
}
