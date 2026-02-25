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
  const [isMinimized, setIsMinimized] = createSignal(false);
  const [videoElement, setVideoElement] = createSignal<HTMLVideoElement | null>(null);

  const watchStream = (stream: StreamInfo) => {
    setActiveStream(stream);
    setIsMinimized(false);
  };

  const minimizeStream = () => {
    setIsMinimized(true);
  };

  const maximizeStream = () => {
    setIsMinimized(false);
  };

  const toggleMinimize = () => {
    setIsMinimized(!isMinimized());
  };

  const leaveStream = () => {
    setActiveStream(null);
    setIsMinimized(false);
    setVideoElement(null);
  };

  const isWatchingStream = () => activeStream() !== null;

  const isWatchingStreamer = (streamerId: string) => activeStream()?.streamerId === streamerId;

  return {
    activeStream,
    isMinimized,
    videoElement,
    setVideoElement,
    watchStream,
    minimizeStream,
    maximizeStream,
    toggleMinimize,
    leaveStream,
    isWatchingStream,
    isWatchingStreamer,
  };
}

export const streamViewerStore = createRoot(createStreamViewerStore);
