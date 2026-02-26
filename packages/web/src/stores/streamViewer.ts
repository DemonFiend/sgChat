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

  const watchStream = (stream: StreamInfo) => {
    console.log('[StreamViewerStore] watchStream called:', stream);
    setActiveStream(stream);
    console.log('[StreamViewerStore] activeStream is now:', activeStream());
  };

  const leaveStream = () => {
    console.log('[StreamViewerStore] leaveStream called');
    setActiveStream(null);
    setVideoElement(null);
  };

  const isWatchingStream = () => activeStream() !== null;

  const isWatchingStreamer = (streamerId: string) => activeStream()?.streamerId === streamerId;

  return {
    activeStream,
    videoElement,
    setVideoElement,
    watchStream,
    leaveStream,
    isWatchingStream,
    isWatchingStreamer,
  };
}

export const streamViewerStore = createRoot(createStreamViewerStore);
