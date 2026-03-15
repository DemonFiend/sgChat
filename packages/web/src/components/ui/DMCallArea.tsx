import { useEffect, useRef } from 'react';
import { useVoiceStore } from '@/stores/voice';
import { dmVoiceService } from '@/lib/dmVoiceService';
import { Avatar } from './Avatar';

interface DMCallAreaProps {
  dmChannelId: string;
  friendName: string;
  friendAvatarUrl?: string | null;
  currentUserAvatarUrl?: string | null;
  currentUserDisplayName?: string | null;
}

export function DMCallArea({
  dmChannelId,
  friendName,
  friendAvatarUrl,
  currentUserAvatarUrl,
  currentUserDisplayName,
}: DMCallAreaProps) {
  const connectionState = useVoiceStore((s) => s.connectionState);
  const currentChannelId = useVoiceStore((s) => s.currentChannelId);
  const isVideoOn = useVoiceStore((s) => s.localState.isVideoOn);
  const remoteScreenShareUserId = useVoiceStore((s) => s.remoteScreenShareUserId);
  const remoteVideoUsers = useVoiceStore((s) => s.remoteVideoUsers);
  const isScreenSharing = useVoiceStore((s) => s.screenShare.isSharing);
  const dmCallPhase = useVoiceStore((s) => s.dmCallPhase);
  const remoteParticipantLeft = useVoiceStore((s) => s.remoteParticipantLeft);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLDivElement>(null);
  const screenShareRef = useRef<HTMLDivElement>(null);

  const isInDMCall = connectionState === 'connected' && currentChannelId === dmChannelId;

  // Attach local video track
  useEffect(() => {
    if (!isInDMCall || !isVideoOn || !localVideoRef.current) return;

    const track = dmVoiceService.getLocalVideoTrack();
    if (track) {
      localVideoRef.current.srcObject = new MediaStream([track]);
    }

    return () => {
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
    };
  }, [isInDMCall, isVideoOn]);

  // Attach remote video elements
  useEffect(() => {
    if (!isInDMCall || !remoteVideoRef.current) return;

    const container = remoteVideoRef.current;
    container.innerHTML = '';

    for (const userId of remoteVideoUsers) {
      const el = dmVoiceService.getRemoteVideoElement(userId);
      if (el) {
        el.className = 'w-full h-full object-cover rounded-lg';
        container.appendChild(el);
      }
    }

    return () => {
      container.innerHTML = '';
    };
  }, [isInDMCall, remoteVideoUsers]);

  // Attach remote screen share element
  useEffect(() => {
    if (!isInDMCall || !screenShareRef.current || !remoteScreenShareUserId) return;

    const container = screenShareRef.current;
    container.innerHTML = '';

    const el = dmVoiceService.getRemoteScreenShareElement(remoteScreenShareUserId);
    if (el) {
      el.className = 'w-full h-full object-contain rounded-lg';
      container.appendChild(el);
    }

    return () => {
      container.innerHTML = '';
    };
  }, [isInDMCall, remoteScreenShareUserId]);

  if (!isInDMCall) return null;

  const hasRemoteVideo = remoteVideoUsers.length > 0;
  const hasRemoteScreenShare = !!remoteScreenShareUserId;
  const hasAnyMedia = isVideoOn || hasRemoteVideo || hasRemoteScreenShare || isScreenSharing;

  if (!hasAnyMedia) {
    const isWaiting = dmCallPhase === 'notifying' || dmCallPhase === 'waiting';
    const isConnectedWithFriend = dmCallPhase === 'connected' && !remoteParticipantLeft;
    const friendLeft = remoteParticipantLeft;

    // Determine status text and colors
    let callStatusText: string;
    let accentColor: string;
    let bgAccent: string;

    if (friendLeft) {
      callStatusText = `${friendName} left the call`;
      accentColor = 'text-danger';
      bgAccent = 'bg-danger/20';
    } else if (dmCallPhase === 'notifying') {
      callStatusText = `Notifying ${friendName}...`;
      accentColor = 'text-warning';
      bgAccent = 'bg-warning/20';
    } else if (dmCallPhase === 'waiting') {
      callStatusText = `Waiting for ${friendName}...`;
      accentColor = 'text-warning';
      bgAccent = 'bg-warning/20';
    } else {
      callStatusText = `In call with ${friendName}`;
      accentColor = 'text-status-online';
      bgAccent = 'bg-status-online/20';
    }

    return (
      <div className="flex items-center justify-center py-8 bg-bg-secondary/50 border-b border-bg-tertiary">
        <div className="flex flex-col items-center gap-3">
          {/* Avatar display */}
          <div className="flex items-center gap-4">
            {/* Local user avatar */}
            <div className="flex flex-col items-center gap-1">
              <div className={`rounded-full ${isWaiting ? 'ring-2 ring-warning/50 animate-pulse' : ''} ${friendLeft ? '' : ''}`}>
                <Avatar
                  src={currentUserAvatarUrl}
                  alt={currentUserDisplayName || 'You'}
                  size="lg"
                />
              </div>
              <span className="text-xs text-text-muted">You</span>
            </div>

            {/* Connection indicator between avatars */}
            {isConnectedWithFriend && (
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-status-online" />
                <div className="w-1.5 h-1.5 rounded-full bg-status-online" />
                <div className="w-1.5 h-1.5 rounded-full bg-status-online" />
              </div>
            )}

            {isWaiting && (
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
                <div className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" style={{ animationDelay: '0.2s' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" style={{ animationDelay: '0.4s' }} />
              </div>
            )}

            {friendLeft && (
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-danger/40" />
                <div className="w-1.5 h-1.5 rounded-full bg-danger/40" />
                <div className="w-1.5 h-1.5 rounded-full bg-danger/40" />
              </div>
            )}

            {/* Friend avatar */}
            <div className="flex flex-col items-center gap-1">
              <div className={`rounded-full transition-opacity ${friendLeft ? 'opacity-40' : ''} ${isConnectedWithFriend ? 'ring-2 ring-status-online/50' : ''}`}>
                <Avatar
                  src={friendAvatarUrl}
                  alt={friendName}
                  size="lg"
                />
              </div>
              <span className={`text-xs ${friendLeft ? 'text-danger/60' : 'text-text-muted'}`}>{friendName}</span>
            </div>
          </div>

          {/* Status text */}
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${bgAccent} ${isWaiting || isConnectedWithFriend ? 'animate-pulse' : ''}`} />
            <span className={`text-sm ${accentColor} font-medium`}>{callStatusText}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative bg-bg-secondary border-b border-bg-tertiary">
      {/* Screen share takes priority - full width */}
      {hasRemoteScreenShare && (
        <div className="relative w-full" style={{ minHeight: '300px', maxHeight: '60vh' }}>
          <div ref={screenShareRef} className="w-full h-full flex items-center justify-center bg-black rounded-lg" style={{ minHeight: '300px' }} />
          <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 text-white text-xs rounded flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            {friendName}'s screen
          </div>
        </div>
      )}

      {/* Video feeds */}
      {(isVideoOn || hasRemoteVideo) && (
        <div className={`flex gap-2 p-2 ${hasRemoteScreenShare ? 'absolute bottom-2 right-2 z-10' : ''}`}>
          {/* Remote video */}
          {hasRemoteVideo && (
            <div
              ref={remoteVideoRef}
              className={hasRemoteScreenShare ? 'w-32 h-24 rounded-lg overflow-hidden shadow-lg' : 'flex-1 rounded-lg overflow-hidden bg-black'}
              style={hasRemoteScreenShare ? undefined : { minHeight: '200px', maxHeight: '40vh' }}
            />
          )}

          {/* Local video (self view) */}
          {isVideoOn && (
            <div className={hasRemoteScreenShare || hasRemoteVideo ? 'w-32 h-24 rounded-lg overflow-hidden shadow-lg relative' : 'flex-1 rounded-lg overflow-hidden bg-black relative'} style={hasRemoteScreenShare || hasRemoteVideo ? undefined : { minHeight: '200px', maxHeight: '40vh' }}>
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover rounded-lg mirror"
                style={{ transform: 'scaleX(-1)' }}
              />
              <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/60 text-white text-xs rounded">You</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
