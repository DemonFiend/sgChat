import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { useVoiceStore } from '@/stores/voice';
import { Avatar } from './Avatar';
import { voiceService } from '@/lib/voiceService';
import { useStreamViewerStore, streamViewerStore } from '@/stores/streamViewer';

export interface StreamViewerProps {
  streamerId: string;
  streamerName: string;
  streamerAvatar?: string | null;
  channelId: string;
  channelName?: string;
  videoElement?: HTMLVideoElement | null;
  onClose: () => void;
}

export function StreamViewer({
  streamerId,
  streamerName,
  streamerAvatar,
  channelId,
  channelName,
  videoElement,
  onClose,
}: StreamViewerProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPiP, setIsPiP] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  const [showControls, setShowControls] = useState(true);
  const fullViewContainerRef = useRef<HTMLDivElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const streamAudioElementRef = useRef<HTMLAudioElement | null>(null);

  const isMinimized = useStreamViewerStore((s) => s.isMinimized);
  const audioAvailableVersion = useStreamViewerStore((s) => s.audioAvailableVersion);
  const participants = useVoiceStore((s) => s.getParticipants(channelId));
  const isConnected = useVoiceStore((s) => s.connectionState === 'connected');
  const currentChannelId = useVoiceStore((s) => s.currentChannelId);

  // Get viewers (participants in the channel who are not streaming)
  const viewers = useMemo(() => {
    return participants.filter(p => p.userId !== streamerId);
  }, [participants, streamerId]);

  // Check if current user is the host/streamer
  const isHostPreview = useMemo(() => {
    return voiceService.isLocalUserStreamer(streamerId);
  }, [streamerId]);

  // Get the effective video element (either from props or local preview for host)
  const effectiveVideoElement = useMemo(() => {
    if (videoElement) return videoElement;
    if (isHostPreview) return voiceService.getLocalScreenShareVideo();
    return null;
  }, [videoElement, isHostPreview]);

  // Connection status message
  const connectionStatus = useMemo(() => {
    if (effectiveVideoElement) {
      return { status: 'connected', message: '' };
    }
    if (isHostPreview) {
      return { status: 'waiting', message: 'Setting up your stream preview...' };
    }
    if (!isConnected) {
      return { status: 'not-connected', message: 'Join the voice channel to watch this stream' };
    }
    if (currentChannelId !== channelId) {
      return { status: 'wrong-channel', message: 'Join this voice channel to watch the stream' };
    }
    return { status: 'waiting', message: 'Connecting to stream...' };
  }, [effectiveVideoElement, isHostPreview, isConnected, currentChannelId, channelId]);

  // Handle joining the voice channel to watch the stream
  const handleJoinChannel = useCallback(async () => {
    try {
      await voiceService.join(channelId, channelName || 'Voice Channel');
    } catch (err) {
      console.error('[StreamViewer] Failed to join channel:', err);
    }
  }, [channelId, channelName]);

  // Handle fullscreen toggle
  const toggleFullscreen = useCallback(async () => {
    if (!fullViewContainerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await fullViewContainerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error('Fullscreen error:', err);
    }
  }, []);

  // Handle Picture-in-Picture toggle
  const togglePiP = useCallback(async () => {
    if (!effectiveVideoElement) {
      console.warn('[StreamViewer] No video element for PiP');
      return;
    }
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await effectiveVideoElement.requestPictureInPicture();
      } else {
        console.warn('[StreamViewer] PiP not supported');
      }
    } catch (err) {
      console.error('[StreamViewer] PiP error:', err);
    }
  }, [effectiveVideoElement]);

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Listen for PiP changes
  useEffect(() => {
    if (!effectiveVideoElement) return;
    const handlePiPEnter = () => setIsPiP(true);
    const handlePiPExit = () => setIsPiP(false);
    effectiveVideoElement.addEventListener('enterpictureinpicture', handlePiPEnter);
    effectiveVideoElement.addEventListener('leavepictureinpicture', handlePiPExit);
    return () => {
      effectiveVideoElement.removeEventListener('enterpictureinpicture', handlePiPEnter);
      effectiveVideoElement.removeEventListener('leavepictureinpicture', handlePiPExit);
    };
  }, [effectiveVideoElement]);

  // Attach screen share audio when available
  useEffect(() => {
    const checkAndAttachAudio = () => {
      const hasAudio = voiceService.hasScreenShareAudio(streamerId);
      if (hasAudio && !streamAudioElementRef.current) {
        console.log('[StreamViewer] Attaching screen share audio for:', streamerId);
        streamAudioElementRef.current = voiceService.attachScreenShareAudio(streamerId, volume, isMuted);
      }
    };

    checkAndAttachAudio();
    const pollInterval = setInterval(checkAndAttachAudio, 500);

    return () => {
      clearInterval(pollInterval);
      if (streamAudioElementRef.current) {
        console.log('[StreamViewer] Detaching screen share audio for:', streamerId);
        voiceService.detachScreenShareAudio(streamerId);
        streamAudioElementRef.current = null;
      }
    };
  }, [streamerId, audioAvailableVersion]);

  // Sync volume/mute with screen share audio
  useEffect(() => {
    voiceService.updateScreenShareAudio(streamerId, volume, isMuted);
  }, [volume, isMuted, streamerId]);

  // Attach video element to the video container
  useEffect(() => {
    const video = effectiveVideoElement;
    const container = videoContainerRef.current;

    if (video && container) {
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.objectFit = 'contain';
      video.style.maxWidth = '100%';
      video.style.maxHeight = '100%';
      video.autoplay = true;
      video.playsInline = true;
      video.muted = isHostPreview ? true : isMuted;
      video.volume = isHostPreview ? 0 : volume / 100;

      if (video.parentElement !== container) {
        container.innerHTML = '';
        container.appendChild(video);
        console.log('[StreamViewer] Video element attached to container', isHostPreview ? '(host preview)' : '');
      }
    }
  }, [effectiveVideoElement, isHostPreview]);

  // Sync mute state with video element
  useEffect(() => {
    if (effectiveVideoElement && !isHostPreview) {
      effectiveVideoElement.muted = isMuted;
    }
  }, [isMuted, effectiveVideoElement, isHostPreview]);

  // Sync volume with video element
  useEffect(() => {
    if (effectiveVideoElement && !isHostPreview) {
      effectiveVideoElement.volume = volume / 100;
    }
  }, [volume, effectiveVideoElement, isHostPreview]);

  // Handle mute toggle
  const toggleMute = useCallback(() => {
    setIsMuted(prev => !prev);
  }, []);

  // Handle volume change
  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseInt(e.target.value, 10);
    setVolume(newVolume);
    if (newVolume === 0) {
      setIsMuted(true);
    } else if (isMuted) {
      setIsMuted(false);
    }
  }, [isMuted]);

  // Auto-hide controls after inactivity
  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      setShowControls(false);
    }, 3000);
  }, []);

  // Handle leaving the stream properly
  const handleLeave = useCallback(async () => {
    console.log('[StreamViewer] handleLeave called');

    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch (err) {
        console.error('[StreamViewer] Error exiting fullscreen:', err);
      }
    }
    if (document.pictureInPictureElement) {
      try { await document.exitPictureInPicture(); } catch (err) {
        console.error('[StreamViewer] Error exiting PiP:', err);
      }
    }
    if (streamAudioElementRef.current) {
      console.log('[StreamViewer] Detaching audio on leave');
      voiceService.detachScreenShareAudio(streamerId);
      streamAudioElementRef.current = null;
    }
    onClose();
  }, [streamerId, onClose]);

  // Handle minimize
  const handleMinimize = useCallback(async () => {
    console.log('[StreamViewer] handleMinimize called, isPiP:', isPiP);
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch (err) {
        console.error('[StreamViewer] Error exiting fullscreen:', err);
      }
    }
    streamViewerStore.minimizeStream();
  }, [isPiP]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      if (streamAudioElementRef.current) {
        voiceService.detachScreenShareAudio(streamerId);
        streamAudioElementRef.current = null;
      }
    };
  }, [streamerId]);

  return createPortal(
    <>
      {/* Full-screen Stream Viewer overlay - hidden when minimized */}
      {!isMinimized && (
        <div
          ref={fullViewContainerRef}
          className={clsx(
            'fixed inset-0 z-[55] flex flex-col bg-black overflow-hidden',
            isFullscreen && 'z-[100]'
          )}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setShowControls(false)}
        >
          {/* Video area */}
          <div className="flex-1 flex items-center justify-center relative overflow-hidden bg-gradient-to-br from-purple-900/20 to-black">
            {effectiveVideoElement ? (
              <div
                ref={videoContainerRef}
                className="w-full h-full flex items-center justify-center"
              />
            ) : (
              <div className="text-center p-4">
                <div className="w-32 h-32 rounded-full bg-purple-500/20 flex items-center justify-center mb-4 mx-auto">
                  <Avatar
                    src={streamerAvatar}
                    alt={streamerName}
                    size="xl"
                  />
                </div>
                <p className="text-white text-xl font-medium">
                  {streamerName}&apos;s Stream
                </p>
                <p className="text-gray-400 text-sm mt-2">
                  {connectionStatus.message || 'Connecting...'}
                </p>

                {/* Show join button if not in the voice channel */}
                {(connectionStatus.status === 'not-connected' || connectionStatus.status === 'wrong-channel') && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleJoinChannel();
                    }}
                    className="mt-4 px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2 mx-auto"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                    Join Voice Channel
                  </button>
                )}

                {/* Show loading spinner if waiting for video */}
                {connectionStatus.status === 'waiting' && (
                  <div className="mt-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-2 border-purple-500 border-t-transparent mx-auto" />
                  </div>
                )}
              </div>
            )}

            {/* Live indicator */}
            <div className="absolute top-4 left-4 flex items-center gap-2">
              <div className="flex items-center gap-2 bg-red-600 rounded px-3 py-1.5">
                <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                <span className="text-white text-sm font-semibold">LIVE</span>
              </div>
              {isHostPreview && (
                <div className="bg-purple-600 rounded px-3 py-1.5">
                  <span className="text-white text-sm font-semibold">YOUR STREAM</span>
                </div>
              )}
            </div>

            {/* Viewers */}
            <div className="absolute top-4 right-4 flex items-center gap-2">
              <div className="flex -space-x-2">
                {viewers.slice(0, 5).map((viewer) => (
                  <div
                    key={viewer.userId}
                    className="w-8 h-8 rounded-full border-2 border-black overflow-hidden"
                    title={viewer.displayName || viewer.username}
                  >
                    <Avatar
                      src={viewer.avatarUrl}
                      alt={viewer.displayName || viewer.username}
                      size="xs"
                    />
                  </div>
                ))}
                {viewers.length > 5 && (
                  <div className="w-8 h-8 rounded-full border-2 border-black bg-gray-700 flex items-center justify-center text-white text-xs font-medium">
                    +{viewers.length - 5}
                  </div>
                )}
              </div>
              <span className="text-white text-sm bg-black/60 px-2 py-1 rounded">
                {viewers.length} watching
              </span>
            </div>
          </div>

          {/* Controls bar */}
          <div
            className={clsx(
              'absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-4 transition-opacity duration-300',
              showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
            )}
          >
            {/* Streamer info */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Avatar
                  src={streamerAvatar}
                  alt={streamerName}
                  size="sm"
                />
                <div>
                  <p className="text-white font-medium">{streamerName}</p>
                  <p className="text-gray-400 text-xs">Streaming in voice channel</p>
                </div>
              </div>
            </div>

            {/* Control buttons */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {/* Mute/Unmute */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleMute();
                  }}
                  className="text-white hover:text-purple-400 transition-colors"
                  title={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted ? (
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                  ) : (
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                  )}
                </button>

                {/* Volume slider */}
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={volume}
                  onChange={handleVolumeChange}
                  className="w-24 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
              </div>

              <div className="flex items-center gap-4">
                {/* Picture-in-Picture */}
                {effectiveVideoElement && document.pictureInPictureEnabled && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePiP();
                    }}
                    className="text-white hover:text-purple-400 transition-colors"
                    title={isPiP ? 'Exit Picture-in-Picture' : 'Picture-in-Picture'}
                  >
                    {isPiP ? (
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    ) : (
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 6v12a2 2 0 002 2h4M4 6l4 4m8-4v4a2 2 0 002 2h4m-6-6l6 6" />
                        <rect x="12" y="12" width="8" height="6" rx="1" strokeWidth="2" />
                      </svg>
                    )}
                  </button>
                )}

                {/* Fullscreen */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFullscreen();
                  }}
                  className="text-white hover:text-purple-400 transition-colors"
                  title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                >
                  {isFullscreen ? (
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 9V5m0 0H5m4 0L4 10m11-1V5m0 0h4m-4 0l5 5M9 15v4m0 0H5m4 0l-5-5m11 5l5-5m-5 5v-4m0 4h4" />
                    </svg>
                  ) : (
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                    </svg>
                  )}
                </button>

                {/* Minimize (to audio-only or PiP) */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMinimize();
                  }}
                  className="text-white hover:text-purple-400 transition-colors"
                  title="Minimize (keep audio)"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Leave stream */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleLeave();
                  }}
                  className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
                  title="Leave Stream"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Leave
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  );
}

export default StreamViewer;
