import { useState } from 'react';
import { clsx } from 'clsx';
import { useVoiceStore } from '@/stores/voice';
import { dmVoiceService } from '@/lib/dmVoiceService';
import { ScreenShareButton } from './ScreenShareButton';
import { PingIndicator } from './PingIndicator';

interface DMVoiceControlsProps {
  dmChannelId: string;
  friendId: string;
  friendName: string;
  className?: string;
}

export function DMVoiceControls({ dmChannelId, friendName, className }: DMVoiceControlsProps) {
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectionState = useVoiceStore((s) => s.connectionState);
  const currentChannelId = useVoiceStore((s) => s.currentChannelId);

  const isInDMCall = connectionState === 'connected' && currentChannelId === dmChannelId;

  const handleVoiceCall = async () => {
    setError(null);
    if (isInDMCall) {
      await dmVoiceService.leave();
      return;
    }
    if (connectionState === 'connected') {
      await dmVoiceService.leave();
    }
    setIsJoining(true);
    try {
      await dmVoiceService.join(dmChannelId, friendName);
    } catch (err: any) {
      setError(err?.message || 'Failed to start call');
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className={clsx('flex items-center gap-2', className)}>
      <button
        onClick={handleVoiceCall}
        disabled={isJoining}
        className={clsx(
          'w-10 h-10 rounded-full flex items-center justify-center transition-colors',
          isInDMCall
            ? 'bg-danger/20 text-danger hover:bg-danger/30'
            : 'bg-bg-tertiary text-text-muted hover:text-text-primary hover:bg-bg-modifier-hover',
          isJoining && 'opacity-50 cursor-wait'
        )}
        title={isInDMCall ? 'End Call' : 'Start Voice Call'}
      >
        {isJoining ? (
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : isInDMCall ? (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
          </svg>
        )}
      </button>

      {/* Video Call Button (shown when not in call) */}
      {!isInDMCall && !isJoining && (
        <button
          onClick={async () => {
            setError(null);
            if (connectionState === 'connected') {
              await dmVoiceService.leave();
            }
            setIsJoining(true);
            try {
              await dmVoiceService.join(dmChannelId, friendName);
              await dmVoiceService.setVideoOn(true);
            } catch (err: any) {
              setError(err?.message || 'Failed to start video call');
            } finally {
              setIsJoining(false);
            }
          }}
          className="w-10 h-10 rounded-full flex items-center justify-center transition-colors bg-bg-tertiary text-text-muted hover:text-text-primary hover:bg-bg-modifier-hover"
          title="Start Video Call"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </button>
      )}
      {isInDMCall && <ScreenShareButton size="sm" showQualityMenu />}
      {isInDMCall && <PingIndicator size="sm" showTooltip />}
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

interface DMCallStatusBarProps {
  dmChannelId: string;
  friendName: string;
  className?: string;
}

export function DMCallStatusBar({ dmChannelId, friendName, className }: DMCallStatusBarProps) {
  const connectionState = useVoiceStore((s) => s.connectionState);
  const currentChannelId = useVoiceStore((s) => s.currentChannelId);
  const isSpeaking = useVoiceStore((s) => s.localState.isSpeaking);
  const isMuted = useVoiceStore((s) => s.localState.isMuted);
  const isDeafened = useVoiceStore((s) => s.localState.isDeafened);
  const isVideoOn = useVoiceStore((s) => s.localState.isVideoOn);
  const isScreenSharing = useVoiceStore((s) => s.screenShare.isSharing);
  const error = useVoiceStore((s) => s.error);
  const dmCallPhase = useVoiceStore((s) => s.dmCallPhase);
  const remoteParticipantLeft = useVoiceStore((s) => s.remoteParticipantLeft);

  const isInDMCall = connectionState === 'connected' && currentChannelId === dmChannelId;

  if (!isInDMCall) return null;

  const statusText = remoteParticipantLeft
    ? `${friendName} left the call`
    : dmCallPhase === 'notifying'
      ? `Notifying ${friendName}...`
      : dmCallPhase === 'waiting'
        ? `Waiting for ${friendName}...`
        : `In Call with ${friendName}`;

  const isWaiting = dmCallPhase === 'notifying' || dmCallPhase === 'waiting';
  const dotColor = remoteParticipantLeft ? 'bg-danger' : isWaiting ? 'bg-warning' : 'bg-status-online';
  const textColor = remoteParticipantLeft ? 'text-danger' : isWaiting ? 'text-warning' : 'text-status-online';

  return (
    <div className={clsx('bg-bg-tertiary border-t border-bg-modifier-accent p-3', className)}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isWaiting || isSpeaking ? 'animate-pulse' : ''} ${dotColor}`} />
          <span className={`text-xs font-medium ${textColor}`}>{statusText}</span>
        </div>
        <PingIndicator size="sm" showLabel showTooltip />
      </div>

      {isScreenSharing && (
        <div className="flex items-center gap-2 mb-2">
          <div className="flex items-center gap-1 px-2 py-0.5 bg-status-online/20 text-status-online rounded text-xs font-medium">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span>Sharing Screen</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => dmVoiceService.toggleMute()}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
            isMuted
              ? 'bg-danger/20 text-danger hover:bg-danger/30'
              : 'bg-bg-secondary text-text-primary hover:bg-bg-modifier-hover'
          }`}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          )}
        </button>

        <button
          onClick={() => dmVoiceService.toggleDeafen()}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
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
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          )}
        </button>

        <button
          onClick={() => dmVoiceService.toggleVideo()}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
            isVideoOn
              ? 'bg-status-online/20 text-status-online hover:bg-status-online/30'
              : 'bg-bg-secondary text-text-primary hover:bg-bg-modifier-hover'
          }`}
          title={isVideoOn ? 'Turn Off Camera' : 'Turn On Camera'}
        >
          {isVideoOn ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3l18 18" />
            </svg>
          )}
        </button>

        <ScreenShareButton size="sm" showQualityMenu />

        <button
          onClick={() => dmVoiceService.leave()}
          className="flex items-center justify-center p-2 rounded-md bg-danger/20 text-danger hover:bg-danger/30 transition-colors"
          title="End Call"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
          </svg>
        </button>
      </div>

      {error && <div className="mt-2 text-xs text-danger">{error}</div>}
    </div>
  );
}
