import { createSignal, Show, For, onCleanup, createEffect } from 'solid-js';
import clsx from 'clsx';
import { voiceStore, type VoiceParticipant } from '@/stores/voice';
import { Avatar } from './Avatar';

export interface StreamViewerProps {
  streamerId: string;
  streamerName: string;
  streamerAvatar?: string | null;
  channelId: string;
  videoElement?: HTMLVideoElement | null;
  onClose: () => void;
  onMinimize: () => void;
  isMinimized?: boolean;
}

export function StreamViewer(props: StreamViewerProps) {
  const [isFullscreen, setIsFullscreen] = createSignal(false);
  const [isMuted, setIsMuted] = createSignal(false);
  const [volume, setVolume] = createSignal(100);
  const [showControls, setShowControls] = createSignal(true);
  let containerRef: HTMLDivElement | undefined;
  let videoRef: HTMLVideoElement | undefined;
  let controlsTimeout: ReturnType<typeof setTimeout>;

  // Get viewers (participants in the channel who are not streaming)
  const viewers = () => {
    const participants = voiceStore.getParticipants(props.channelId);
    return participants.filter(p => p.userId !== props.streamerId);
  };

  // Handle fullscreen toggle
  const toggleFullscreen = async () => {
    if (!containerRef) return;
    
    try {
      if (!document.fullscreenElement) {
        await containerRef.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (err) {
      console.error('Fullscreen error:', err);
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

  // Handle mute toggle
  const toggleMute = () => {
    setIsMuted(!isMuted());
    if (videoRef) {
      videoRef.muted = !isMuted();
    }
  };

  // Handle volume change
  const handleVolumeChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const newVolume = parseInt(target.value, 10);
    setVolume(newVolume);
    if (videoRef) {
      videoRef.volume = newVolume / 100;
    }
    if (newVolume === 0) {
      setIsMuted(true);
    } else if (isMuted()) {
      setIsMuted(false);
    }
  };

  // Auto-hide controls
  const handleMouseMove = () => {
    setShowControls(true);
    clearTimeout(controlsTimeout);
    controlsTimeout = setTimeout(() => {
      if (!props.isMinimized) {
        setShowControls(false);
      }
    }, 3000);
  };

  onCleanup(() => {
    clearTimeout(controlsTimeout);
  });

  // Minimized view (Picture-in-Picture style)
  if (props.isMinimized) {
    return (
      <div
        class="fixed bottom-20 right-4 w-80 h-48 bg-black rounded-lg shadow-2xl overflow-hidden z-50 cursor-pointer group border-2 border-purple-500/50"
        onClick={props.onMinimize}
      >
        {/* Video placeholder */}
        <div class="w-full h-full bg-gradient-to-br from-purple-900/50 to-black flex items-center justify-center">
          <Show 
            when={props.videoElement}
            fallback={
              <div class="text-center">
                <Avatar
                  src={props.streamerAvatar}
                  alt={props.streamerName}
                  size="lg"
                />
                <p class="text-white text-sm mt-2">{props.streamerName}'s Stream</p>
              </div>
            }
          >
            <video
              ref={videoRef}
              class="w-full h-full object-contain"
              autoplay
              muted={isMuted()}
            />
          </Show>
        </div>
        
        {/* Overlay with streamer info */}
        <div class="absolute top-2 left-2 flex items-center gap-2 bg-black/60 rounded px-2 py-1">
          <span class="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          <span class="text-white text-xs font-medium">{props.streamerName}</span>
        </div>
        
        {/* Expand hint on hover */}
        <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <div class="bg-white/20 rounded-full p-3">
            <svg class="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </div>
        </div>
        
        {/* Close button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            props.onClose();
          }}
          class="absolute top-2 right-2 w-6 h-6 bg-black/60 hover:bg-red-500/80 rounded-full flex items-center justify-center transition-colors"
        >
          <svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    );
  }

  // Full view
  return (
    <div
      ref={containerRef}
      class={clsx(
        'flex flex-col bg-black h-full w-full relative',
        isFullscreen() && 'fixed inset-0 z-[100]'
      )}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setShowControls(false)}
    >
      {/* Video area */}
      <div class="flex-1 flex items-center justify-center relative overflow-hidden">
        <Show 
          when={props.videoElement}
          fallback={
            <div class="text-center">
              <div class="w-32 h-32 rounded-full bg-purple-500/20 flex items-center justify-center mb-4 mx-auto">
                <Avatar
                  src={props.streamerAvatar}
                  alt={props.streamerName}
                  size="xl"
                />
              </div>
              <p class="text-white text-xl font-medium">{props.streamerName}'s Stream</p>
              <p class="text-gray-400 text-sm mt-2">Connecting to stream...</p>
            </div>
          }
        >
          <video
            ref={videoRef}
            class="max-w-full max-h-full object-contain"
            autoplay
            muted={isMuted()}
          />
        </Show>
        
        {/* Live indicator */}
        <div class="absolute top-4 left-4 flex items-center gap-2 bg-red-600 rounded px-3 py-1.5">
          <span class="w-2 h-2 bg-white rounded-full animate-pulse" />
          <span class="text-white text-sm font-semibold">LIVE</span>
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
          showControls() ? 'opacity-100' : 'opacity-0'
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
              <p class="text-gray-400 text-xs">Streaming</p>
            </div>
          </div>
        </div>

        {/* Control buttons */}
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-4">
            {/* Mute/Unmute */}
            <button
              onClick={toggleMute}
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
            {/* Minimize */}
            <button
              onClick={props.onMinimize}
              class="text-white hover:text-purple-400 transition-colors"
              title="Minimize"
            >
              <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4" />
              </svg>
            </button>
            
            {/* Fullscreen */}
            <button
              onClick={toggleFullscreen}
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
              onClick={props.onClose}
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
  );
}

export default StreamViewer;
