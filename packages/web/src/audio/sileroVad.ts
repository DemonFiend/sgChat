import { MicVAD } from '@ricky0123/vad-web';

export interface SileroVadCallbacks {
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
}

export interface SileroVadHandle {
  start: () => Promise<void>;
  pause: () => Promise<void>;
  destroy: () => Promise<void>;
}

/**
 * Creates a Silero VAD instance that listens to the given stream for speech activity.
 * Falls back gracefully if ONNX runtime fails to load.
 */
export async function createSileroVad(
  stream: MediaStream,
  callbacks: SileroVadCallbacks
): Promise<SileroVadHandle | null> {
  try {
    const vad = await MicVAD.new({
      getStream: async () => stream,
      onSpeechStart: () => callbacks.onSpeechStart?.(),
      onSpeechEnd: () => callbacks.onSpeechEnd?.(),
      onVADMisfire: () => {},
      onFrameProcessed: () => {},
      onSpeechRealStart: () => {},
      startOnLoad: true,
    });

    return {
      start: () => vad.start(),
      pause: () => vad.pause(),
      destroy: () => vad.destroy(),
    };
  } catch (err) {
    console.warn('[silero-vad] Failed to initialize Silero VAD, continuing without it:', err);
    return null;
  }
}
