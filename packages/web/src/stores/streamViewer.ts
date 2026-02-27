import { createSignal, createRoot } from 'solid-js';

export interface StreamInfo {
  streamerId: string;
  streamerName: string;
  streamerAvatar: string | null;
  channelId: string;
  channelName: string;
}

function createStreamViewerStore() {
  const [activeStream, setActiveStream] = createSignal<StreamInfo | null>(null);
  const [videoElement, setVideoElement] = createSignal<HTMLVideoElement | null>(null);
  const [audioAvailableVersion, setAudioAvailableVersion] = createSignal(0);
  const [isMinimized, setIsMinimized] = createSignal(false);

  const watchStream = (stream: StreamInfo) => {
    console.log('[StreamViewerStore] watchStream called:', stream);
    setActiveStream(stream);
    setIsMinimized(false); // Always start in full view
    console.log('[StreamViewerStore] activeStream is now:', activeStream());
  };

  const leaveStream = () => {
    console.log('[StreamViewerStore] leaveStream called');
    setActiveStream(null);
    setVideoElement(null);
    setIsMinimized(false);
  };

  const minimizeStream = () => {
    console.log('[StreamViewerStore] minimizeStream called');
    setIsMinimized(true);
  };

  const maximizeStream = () => {
    console.log('[StreamViewerStore] maximizeStream called');
    setIsMinimized(false);
  };

  const toggleMinimize = () => {
    setIsMinimized(prev => !prev);
  };

  const isWatchingStream = () => activeStream() !== null;

  const isWatchingStreamer = (streamerId: string) => activeStream()?.streamerId === streamerId;

  const notifyAudioAvailable = () => {
    console.log('[StreamViewerStore] Audio track became available');
    setAudioAvailableVersion(v => v + 1);
  };

  return {
    activeStream,
    videoElement,
    setVideoElement,
    watchStream,
    leaveStream,
    isWatchingStream,
    isWatchingStreamer,
    audioAvailableVersion,
    notifyAudioAvailable,
    isMinimized,
    minimizeStream,
    maximizeStream,
    toggleMinimize,
  };
}

export const streamViewerStore = createRoot(createStreamViewerStore);
