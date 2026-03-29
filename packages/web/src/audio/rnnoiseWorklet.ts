import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor';

const RNNOISE_WASM_URL = '/wasm/rnnoise/rnnoise.wasm';
const RNNOISE_SIMD_WASM_URL = '/wasm/rnnoise/rnnoise_simd.wasm';
const RNNOISE_WORKLET_URL = '/worklets/rnnoise-worklet-processor.js';

let wasmBinaryCache: ArrayBuffer | null = null;

export async function createRnnoiseNode(audioContext: AudioContext): Promise<RnnoiseWorkletNode> {
  // Register the worklet processor
  await audioContext.audioWorklet.addModule(RNNOISE_WORKLET_URL);

  // Load WASM binary (with SIMD auto-detection), cache for reuse
  if (!wasmBinaryCache) {
    wasmBinaryCache = await loadRnnoise({
      url: RNNOISE_WASM_URL,
      simdUrl: RNNOISE_SIMD_WASM_URL,
    });
  }

  return new RnnoiseWorkletNode(audioContext, {
    maxChannels: 1,
    wasmBinary: wasmBinaryCache,
  });
}

export function clearRnnoiseCache(): void {
  wasmBinaryCache = null;
}
