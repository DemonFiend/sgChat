import { createSignal, Show, For, onCleanup, createEffect, createMemo } from 'solid-js';
import { Portal } from 'solid-js/web';
import clsx from 'clsx';
import { voiceStore } from '@/stores/voice';
import { Avatar } from './Avatar';
import { voiceService } from '@/lib/voiceService';
import { streamViewerStore } from '@/stores/streamViewer';

export interface StreamViewerProps {
  streamerId: string;
  streamerName: string;
  streamerAvatar?: string | null;
  channelId: string;
  channelName?: string;
  videoElement?: HTMLVideoElement | null;
  onClose: () => void;
}

export function StreamViewer(props: StreamViewerProps) {
  const [isFullscreen, setIsFullscreen] = createSignal(false);
  const [isPiP, setIsPiP] = createSignal(false);
  const [isMuted, setIsMuted] = createSignal(false);
  const [volume, setVolume] = createSignal(100);
  const [showControls, setShowControls] = createSignal(true);
  const [hasStreamAudio, setHasStreamAudio] = createSignal(false);
  let fullViewContainerRef: HTMLDivElement | undefined;
  let videoContainerRef: HTMLDivElement | undefined;
  let controlsTimeout: ReturnType<typeof setTimeout>;
  let streamAudioElement: HTMLAudioElement | null = null;

  // Get viewers (participants in the channel who are not streaming)
  const viewers = () => {
    const participants = voiceStore.getParticipants(props.channelId);
    return participants.filter(p => p.userId !== props.streamerId);
  };
  
  // Check if current user is the host/streamer
  const isHostPreview = createMemo(() => {
    return voiceService.isLocalUserStreamer(props.streamerId);
  });

  // Get the effective video element (either from props or local preview for host)
  const effectiveVideoElement = createMemo(() => {
    if (props.videoElement) {
      return props.videoElement;
    }
    // If this is the host viewing their own stream, get local preview
    if (isHostPreview()) {
      return voiceService.getLocalScreenShareVideo();
    }
    return null;
  });

  // Connection status message
  const connectionStatus = createMemo(() => {
    if (effectiveVideoElement()) {
      return { status: 'connected', message: '' };
    }
    if (isHostPreview()) {
      return { status: 'waiting', message: 'Setting up your stream preview...' };
    }
    if (!voiceStore.isConnected()) {
      return { status: 'not-connected', message: 'Join the voice channel to watch this stream' };
    }
    if (voiceStore.currentChannelId() !== props.channelId) {
      return { status: 'wrong-channel', message: 'Join this voice channel to watch the stream' };
    }
    return { status: 'waiting', message: 'Connecting to stream...' };
  });
  
  // Handle joining the voice channel to watch the stream
  const handleJoinChannel = async () => {
    try {
      await voiceService.join(props.channelId, props.channelName || 'Voice Channel');
    } catch (err) {
      console.error('[StreamViewer] Failed to join channel:', err);
    }
  };

  // Handle fullscreen toggle
  const toggleFullscreen = async () => {
    if (!fullViewContainerRef) return;
    
    try {
      if (!document.fullscreenElement) {
        await fullViewContainerRef.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error('Fullscreen error:', err);
    }
  };

  // Handle Picture-in-Picture toggle
  const togglePiP = async () => {
    const video = effectiveVideoElement();
    if (!video) {
      console.warn('[StreamViewer] No video element for PiP');
      return;
    }
    
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
      } else {
        console.warn('[StreamViewer] PiP not supported');
      }
    } catch (err) {
      console.error('[StreamViewer] PiP error:', err);
    }
  };

  // Listen for fullscreen changes
  createEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    onCleanup(() => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    });
  });

  // Listen for PiP changes
  createEffect(() => {
    const handlePiPEnter = () => setIsPiP(true);
    const handlePiPExit = () => setIsPiP(false);
    
    const video = effectiveVideoElement();
    if (video) {
      video.addEventListener('enterpictureinpicture', handlePiPEnter);
      video.addEventListener('leavepictureinpicture', handlePiPExit);
      
      onCleanup(() => {
        video.removeEventListener('enterpictureinpicture', handlePiPEnter);
        video.removeEventListener('leavepictureinpicture', handlePiPExit);
      });
    }
  });

  // Attach screen share audio when available (reactive to audioAvailableVersion + polling fallback)
  createEffect(() => {
    const streamerId = props.streamerId;
    // React to audioAvailableVersion changes from streamViewerStore
    const _audioVersion = streamViewerStore.audioAvailableVersion();
    
    const checkAndAttachAudio = () => {
      const hasAudio = voiceService.hasScreenShareAudio(streamerId);
      setHasStreamAudio(hasAudio);
      
      if (hasAudio && !streamAudioElement) {
        console.log('[StreamViewer] Attaching screen share audio for:', streamerId);
        streamAudioElement = voiceService.attachScreenShareAudio(streamerId, volume(), isMuted());
      }
    };
    
    // Check immediately
    checkAndAttachAudio();
    
    // Also poll every 500ms as a fallback (in case audio track arrives late)
    const pollInterval = setInterval(checkAndAttachAudio, 500);
    
    // Cleanup when component unmounts or streamer changes
    onCleanup(() => {
      clearInterval(pollInterval);
      if (streamAudioElement) {
        console.log('[StreamViewer] Detaching screen share audio for:', streamerId);
        voiceService.detachScreenShareAudio(streamerId);
        streamAudioElement = null;
      }
    });
  });

  // Sync volume/mute with screen share audio
  createEffect(() => {
    const vol = volume();
    const muted = isMuted();
    const streamerId = props.streamerId;
    
    // Update screen share audio if it exists
    voiceService.updateScreenShareAudio(streamerId, vol, muted);
  });

  // Attach video element to the video container
  createEffect(() => {
    const video = effectiveVideoElement();
    const container = videoContainerRef;
    
    if (video && container) {
      // Style the video element
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.objectFit = 'contain';
      video.style.maxWidth = '100%';
      video.style.maxHeight = '100%';
      video.autoplay = true;
      video.playsInline = true;
      
      // Apply current mute/volume settings (muted for host preview to avoid feedback)
      video.muted = isHostPreview() ? true : isMuted();
      video.volume = isHostPreview() ? 0 : volume() / 100;
      
      // Only append if not already in this container
      if (video.parentElement !== container) {
        container.innerHTML = '';
        container.appendChild(video);
        console.log('[StreamViewer] Video element attached to container', isHostPreview() ? '(host preview)' : '');
      }
    }
  });
  
  // Sync mute state with video element
  createEffect(() => {
    const muted = isMuted();
    const video = effectiveVideoElement();
    // Don't change mute for host preview
    if (video && !isHostPreview()) {
      video.muted = muted;
    }
  });
  
  // Sync volume with video element
  createEffect(() => {
    const vol = volume();
    const video = effectiveVideoElement();
    // Don't change volume for host preview
    if (video && !isHostPreview()) {
      video.volume = vol / 100;
    }
  });

  // Handle mute toggle
  const toggleMute = () => {
    setIsMuted(!isMuted());
  };

  // Handle volume change
  const handleVolumeChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const newVolume = parseInt(target.value, 10);
    setVolume(newVolume);
    if (newVolume === 0) {
      setIsMuted(true);
    } else if (isMuted()) {
      setIsMuted(false);
    }
  };

  // Auto-hide controls after inactivity
  const handleMouseMove = () => {
    setShowControls(true);
    clearTimeout(controlsTimeout);
    controlsTimeout = setTimeout(() => {
      setShowControls(false);
    }, 3000);
  };

  onCleanup(() => {
    clearTimeout(controlsTimeout);
    // Ensure screen share audio is cleaned up
    if (streamAudioElement) {
      voiceService.detachScreenShareAudio(props.streamerId);
      streamAudioElement = null;
    }
  });

  return (
    <Portal>
      {/* Full-screen Stream Viewer overlay */}
      <div
        ref={fullViewContainerRef}
        class={clsx(
          'fixed inset-0 z-[55] flex flex-col bg-black overflow-hidden',
          isFullscreen() && 'z-[100]'
        )}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setShowControls(false)}
      >
        {/* Video area */}
        <div class="flex-1 flex items-center justify-center relative overflow-hidden bg-gradient-to-br from-purple-900/20 to-black">
          <Show 
            when={effectiveVideoElement()}
            fallback={
              <div class="text-center p-4">
                <div class="w-32 h-32 rounded-full bg-purple-500/20 flex items-center justify-center mb-4 mx-auto">
                  <Avatar
                    src={props.streamerAvatar}
                    alt={props.streamerName}
                    size="xl"
                  />
                </div>
                <p class="text-white text-xl font-medium">
                  {props.streamerName}'s Stream
                </p>
                <p class="text-gray-400 text-sm mt-2">
                  {connectionStatus().message || 'Connecting...'}
                </p>
                
                {/* Show join button if not in the voice channel */}
                <Show when={connectionStatus().status === 'not-connected' || connectionStatus().status === 'wrong-channel'}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleJoinChannel();
                    }}
                    class="mt-4 px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2 mx-auto"
                  >
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                    Join Voice Channel
                  </button>
                </Show>
                
                {/* Show loading spinner if waiting for video */}
                <Show when={connectionStatus().status === 'waiting'}>
                  <div class="mt-4">
                    <div class="animate-spin rounded-full h-8 w-8 border-2 border-purple-500 border-t-transparent mx-auto" />
                  </div>
                </Show>
              </div>
            }
          >
            <div 
              ref={videoContainerRef} 
              class="w-full h-full flex items-center justify-center"
            />
          </Show>
          
          {/* Live indicator */}
          <div class="absolute top-4 left-4 flex items-center gap-2">
            <div class="flex items-center gap-2 bg-red-600 rounded px-3 py-1.5">
              <span class="w-2 h-2 bg-white rounded-full animate-pulse" />
              <span class="text-white text-sm font-semibold">LIVE</span>
            </div>
            <Show when={isHostPreview()}>
              <div class="bg-purple-600 rounded px-3 py-1.5">
                <span class="text-white text-sm font-semibold">YOUR STREAM</span>
              </div>
            </Show>
          </div>
          
          {/* Viewers */}
          <div class="absolute top-4 right-4 flex items-center gap-2">
            <div class="flex -space-x-2">
              <For each={viewers().slice(0, 5)}>
                {(viewer) => (
                  <div 
                    class="w-8 h-8 rounded-full border-2 border-black overflow-hidden"
                    title={viewer.displayName || viewer.username}
                  >
                    <Avatar
                      src={viewer.avatarUrl}
                      alt={viewer.displayName || viewer.username}
                      size="xs"
                    />
                  </div>
                )}
              </For>
              <Show when={viewers().length > 5}>
                <div class="w-8 h-8 rounded-full border-2 border-black bg-gray-700 flex items-center justify-center text-white text-xs font-medium">
                  +{viewers().length - 5}
                </div>
              </Show>
            </div>
            <span class="text-white text-sm bg-black/60 px-2 py-1 rounded">
              {viewers().length} watching
            </span>
          </div>
        </div>

        {/* Controls bar */}
        <div
          class={clsx(
            'absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-4 transition-opacity duration-300',
            showControls() ? 'opacity-100' : 'opacity-0 pointer-events-none'
          )}
        >
          {/* Streamer info */}
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <Avatar
                src={props.streamerAvatar}
                alt={props.streamerName}
                size="sm"
              />
              <div>
                <p class="text-white font-medium">{props.streamerName}</p>
                <p class="text-gray-400 text-xs">Streaming in voice channel</p>
              </div>
            </div>
          </div>

          {/* Control buttons */}
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-4">
              {/* Mute/Unmute */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleMute();
                }}
                class="text-white hover:text-purple-400 transition-colors"
                title={isMuted() ? 'Unmute' : 'Mute'}
              >
                <Show
                  when={isMuted()}
                  fallback={
                    <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                  }
                >
                  <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                  </svg>
                </Show>
              </button>
              
              {/* Volume slider */}
              <input
                type="range"
                min="0"
                max="100"
                value={volume()}
                onInput={handleVolumeChange}
                class="w-24 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-purple-500"
              />
            </div>

            <div class="flex items-center gap-4">
              {/* Picture-in-Picture */}
              <Show when={effectiveVideoElement() && document.pictureInPictureEnabled}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePiP();
                  }}
                  class="text-white hover:text-purple-400 transition-colors"
                  title={isPiP() ? 'Exit Picture-in-Picture' : 'Picture-in-Picture'}
                >
                  <Show
                    when={isPiP()}
                    fallback={
                      <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 6v12a2 2 0 002 2h4M4 6l4 4m8-4v4a2 2 0 002 2h4m-6-6l6 6" />
                        <rect x="12" y="12" width="8" height="6" rx="1" stroke-width="2" />
                      </svg>
                    }
                  >
                    <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </Show>
                </button>
              </Show>
              
              {/* Fullscreen */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFullscreen();
                }}
                class="text-white hover:text-purple-400 transition-colors"
                title={isFullscreen() ? 'Exit Fullscreen' : 'Fullscreen'}
              >
                <Show
                  when={isFullscreen()}
                  fallback={
                    <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                    </svg>
                  }
                >
                  <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 9V5m0 0H5m4 0L4 10m11-1V5m0 0h4m-4 0l5 5M9 15v4m0 0H5m4 0l-5-5m11 5l5-5m-5 5v-4m0 4h4" />
                  </svg>
                </Show>
              </button>
              
              {/* Leave stream */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  props.onClose();
                }}
                class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
                title="Leave Stream"
              >
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Leave
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}

export default StreamViewer;
