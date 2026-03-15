import { useEffect, useRef } from 'react';
import { useVoiceStore } from '@/stores/voice';
import { dmVoiceService } from '@/lib/dmVoiceService';

interface DMCallAreaProps {
  dmChannelId: string;
  friendName: string;
}

export function DMCallArea({ dmChannelId, friendName }: DMCallAreaProps) {
  const connectionState = useVoiceStore((s) => s.connectionState);
  const currentChannelId = useVoiceStore((s) => s.currentChannelId);
  const isVideoOn = useVoiceStore((s) => s.localState.isVideoOn);
  const remoteScreenShareUserId = useVoiceStore((s) => s.remoteScreenShareUserId);
  const remoteVideoUsers = useVoiceStore((s) => s.remoteVideoUsers);
  const isScreenSharing = useVoiceStore((s) => s.screenShare.isSharing);

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
    // Audio-only call indicator
    return (
      <div className="flex items-center justify-center py-8 bg-bg-secondary/50 border-b border-bg-tertiary">
        <div className="flex flex-col items-center gap-2">
          <div className="w-16 h-16 rounded-full bg-status-online/20 flex items-center justify-center animate-pulse">
            <svg className="w-8 h-8 text-status-online" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </div>
          <span className="text-sm text-status-online font-medium">In call with {friendName}</span>
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
