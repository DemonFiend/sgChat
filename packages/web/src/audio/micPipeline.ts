import type { NoiseSuppressionMode } from '@sgchat/shared';
import { createRnnoiseNode, clearRnnoiseCache } from './rnnoiseWorklet';

export interface MicPipelineConfig {
  deviceId?: string;
  autoGainControl: boolean;
  echoCancellation: boolean;
  noiseSuppressionMode: NoiseSuppressionMode;
  noiseAggressiveness: number;
}

export interface MicPipelineResult {
  stream: MediaStream;
  analyserNode: AnalyserNode;
  cleanup: () => Promise<void>;
}

/**
 * Checks whether the browser supports AudioWorklet + WASM (required for RNNoise mode).
 */
export function checkRnnoiseSupport(): { supported: boolean; reason?: string } {
  if (
    typeof AudioContext === 'undefined' &&
    typeof (window as any).webkitAudioContext === 'undefined'
  ) {
    return { supported: false, reason: 'AudioContext not supported' };
  }
  if (typeof AudioWorkletNode === 'undefined') {
    return { supported: false, reason: 'AudioWorklet not supported' };
  }
  if (typeof WebAssembly === 'undefined') {
    return { supported: false, reason: 'WebAssembly not supported' };
  }
  return { supported: true };
}

/**
 * Acquires a microphone stream and applies the selected noise suppression mode.
 *
 * Modes:
 * - 'off': Raw getUserMedia, no processing
 * - 'native': Browser's built-in noiseSuppression constraint
 * - 'nsnet2': RNNoise WASM AudioWorklet (off main thread)
 * - 'deepfilter': Treated as 'nsnet2' on web (desktop-only mode)
 */
export async function acquireMicStream(config: MicPipelineConfig): Promise<MicPipelineResult> {
  const effectiveMode = resolveMode(config.noiseSuppressionMode);

  // For native mode, let the browser handle noise suppression via constraints
  const useNativeNS = effectiveMode === 'native';

  const rawStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: config.deviceId ? { exact: config.deviceId } : undefined,
      autoGainControl: config.autoGainControl,
      echoCancellation: config.echoCancellation,
      noiseSuppression: useNativeNS,
    },
  });

  // For 'off' and 'native' modes, just attach an analyser and return
  if (effectiveMode === 'off' || effectiveMode === 'native') {
    const audioContext = new AudioContext({ sampleRate: 48000 });
    const source = audioContext.createMediaStreamSource(rawStream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    return {
      stream: rawStream,
      analyserNode: analyser,
      cleanup: async () => {
        rawStream.getTracks().forEach((t) => t.stop());
        source.disconnect();
        await audioContext.close();
      },
    };
  }

  // 'nsnet2' (or 'deepfilter' fallback) — RNNoise AudioWorklet pipeline
  try {
    const audioContext = new AudioContext({ sampleRate: 48000 });
    const source = audioContext.createMediaStreamSource(rawStream);
    const rnnoiseNode = await createRnnoiseNode(audioContext);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const destination = audioContext.createMediaStreamDestination();

    // Audio graph: source -> rnnoise -> analyser -> destination
    source.connect(rnnoiseNode);
    rnnoiseNode.connect(analyser);
    analyser.connect(destination);

    console.log('[mic-pipeline] RNNoise worklet loaded and connected');

    return {
      stream: destination.stream,
      analyserNode: analyser,
      cleanup: async () => {
        rawStream.getTracks().forEach((t) => t.stop());
        source.disconnect();
        rnnoiseNode.disconnect();
        rnnoiseNode.destroy();
        analyser.disconnect();
        destination.disconnect();
        await audioContext.close();
      },
    };
  } catch (err) {
    console.warn('[mic-pipeline] RNNoise failed, falling back to native NS:', err);
    clearRnnoiseCache();

    // Fallback: re-acquire with native NS enabled
    rawStream.getTracks().forEach((t) => t.stop());
    return acquireMicStream({
      ...config,
      noiseSuppressionMode: 'native',
    });
  }
}

/**
 * Resolves the effective mode for web: 'deepfilter' maps to 'nsnet2' (best available on web).
 * If RNNoise is not supported, falls back to 'native'.
 */
function resolveMode(mode: NoiseSuppressionMode): 'off' | 'native' | 'nsnet2' {
  if (mode === 'off') return 'off';
  if (mode === 'native') return 'native';

  // deepfilter and nsnet2 both map to nsnet2 (RNNoise) on web
  const support = checkRnnoiseSupport();
  if (!support.supported) {
    console.warn(
      `[mic-pipeline] RNNoise not supported (${support.reason}), falling back to native`
    );
    return 'native';
  }
  return 'nsnet2';
}
