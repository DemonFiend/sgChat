/**
 * AI Noise Suppression Service
 *
 * Client-side noise suppression using DTLN (Dual-signal Transformation LSTM Network)
 * via the dtln-rs WASM module. Processes audio entirely on-device — no audio data
 * leaves the user's machine.
 *
 * Architecture:
 *   Outbound: Mic MediaStream → AudioWorklet (buffer) → Main thread DTLN → clean MediaStream
 *   Inbound:  Remote audio element → AudioWorklet (buffer) → Main thread DTLN → clean output
 */

import { isElectron } from './electron';

const DTLN_BLOCK = 512;
const DTLN_RATE = 16000;
const MAX_INBOUND_PIPELINES = 8;

type CpuLevel = 'low' | 'moderate' | 'high';

interface Pipeline {
  context: AudioContext;
  workletNode: AudioWorkletNode;
  source: MediaStreamAudioSourceNode | MediaElementAudioSourceNode;
  destination?: MediaStreamAudioDestinationNode;
}

interface DtlnModule {
  init: () => Promise<any>;
  dtln_create: () => Promise<number>;
  dtln_destroy: (handle: number) => Promise<void>;
  dtln_denoise: (handle: number, input: Float32Array, output: Float32Array) => Promise<boolean>;
}

class NoiseSuppressionService {
  private _supported: boolean | null = null;
  private _unsupportedReason: string | null = null;
  private _dtln: DtlnModule | null = null;
  private _dtlnReady = false;
  private _loading = false;
  private _loadTimeMs = 0;

  // Outbound pipeline (local mic)
  private _outboundPipeline: Pipeline | null = null;
  private _outboundHandle: number = 0;

  // Inbound pipelines (remote participants)
  private _inboundPipelines: Map<string, Pipeline> = new Map();
  private _inboundHandles: Map<string, number> = new Map();

  // CPU monitoring
  private _cpuLevel: CpuLevel = 'low';
  private _cpuListeners: Set<(level: CpuLevel) => void> = new Set();

  // Resampling buffers (reused across calls to avoid GC pressure)
  private _resampleDown = new Float32Array(DTLN_BLOCK);
  private _resampleUp: Float32Array | null = null;
  private _dtlnOutput = new Float32Array(DTLN_BLOCK);

  /**
   * Check whether the current environment supports AI noise suppression.
   */
  checkCapabilities(): { supported: boolean; reason?: string } {
    if (this._supported !== null) {
      return { supported: this._supported, reason: this._unsupportedReason || undefined };
    }

    // DTLN WASM module requires Emscripten runtime glue only available in Electron.
    // In the browser it hangs indefinitely, causing a 10s timeout delay on voice join.
    if (!isElectron()) {
      this._supported = false;
      this._unsupportedReason = 'AI noise suppression is only available in the desktop app';
      return { supported: false, reason: this._unsupportedReason };
    }

    // Check AudioWorklet support
    if (typeof AudioContext === 'undefined' && typeof (window as any).webkitAudioContext === 'undefined') {
      this._supported = false;
      this._unsupportedReason = 'AudioContext is not supported in this browser';
      return { supported: false, reason: this._unsupportedReason };
    }

    const ctx = new AudioContext();
    const hasWorklet = typeof ctx.audioWorklet !== 'undefined';
    ctx.close();

    if (!hasWorklet) {
      this._supported = false;
      this._unsupportedReason = 'AudioWorklet is not supported in this browser';
      return { supported: false, reason: this._unsupportedReason };
    }

    // Check WebAssembly support
    if (typeof WebAssembly === 'undefined') {
      this._supported = false;
      this._unsupportedReason = 'WebAssembly is not supported in this browser';
      return { supported: false, reason: this._unsupportedReason };
    }

    this._supported = true;
    return { supported: true };
  }

  /**
   * Lazily load the DTLN WASM module.
   */
  async loadModel(): Promise<void> {
    if (this._dtlnReady || this._loading) return;
    this._loading = true;

    const t0 = performance.now();
    try {
      console.log('[NoiseSuppressionService] Loading DTLN model...');

      // Dynamic import of dtln-rs — Vite will handle the module resolution
      const { default: initDTLN } = await import('dtln-rs');

      // dtln-rs WASM module is broken for browser use (missing Emscripten runtime glue).
      // initDTLN() returns a promise that never resolves. Add a timeout so we fail
      // gracefully and fall back to browser noiseSuppression: true.
      const LOAD_TIMEOUT_MS = 10_000;
      this._dtln = await Promise.race([
        initDTLN(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('DTLN WASM load timed out after 10s')), LOAD_TIMEOUT_MS),
        ),
      ]);
      this._dtlnReady = true;

      this._loadTimeMs = performance.now() - t0;
      console.log(`[NoiseSuppressionService] DTLN model loaded in ${this._loadTimeMs.toFixed(0)}ms`);

      // Run a quick benchmark for device performance detection
      await this._benchmarkDevice();
    } catch (err) {
      console.error('[NoiseSuppressionService] Failed to load DTLN model:', err);
      this._dtlnReady = false;
      throw err;
    } finally {
      this._loading = false;
    }
  }

  /**
   * Run a single inference to estimate device performance.
   */
  private async _benchmarkDevice(): Promise<void> {
    if (!this._dtln) return;

    const handle = await this._dtln.dtln_create();
    const input = new Float32Array(DTLN_BLOCK); // silence
    const output = new Float32Array(DTLN_BLOCK);

    const t0 = performance.now();
    await this._dtln.dtln_denoise(handle, input, output);
    const elapsed = performance.now() - t0;

    await this._dtln.dtln_destroy(handle);

    console.log(`[NoiseSuppressionService] Benchmark: single inference = ${elapsed.toFixed(1)}ms`);
    if (elapsed > 15) {
      console.warn('[NoiseSuppressionService] Device may struggle with AI noise suppression');
    }
  }

  /**
   * Process an outbound microphone track through DTLN.
   * Returns a new MediaStreamTrack with noise-suppressed audio.
   */
  async processOutboundTrack(rawStream: MediaStream): Promise<MediaStream> {
    if (!this._dtlnReady || !this._dtln) {
      await this.loadModel();
    }
    if (!this._dtln) throw new Error('DTLN model not available');

    // Clean up any existing outbound pipeline
    if (this._outboundPipeline) {
      this._destroyPipeline(this._outboundPipeline, this._outboundHandle);
    }

    const context = new AudioContext({ sampleRate: 48000 });
    const ratio = context.sampleRate / DTLN_RATE;
    const inputBlockSize = Math.round(DTLN_BLOCK * ratio);

    // Ensure resample buffer matches
    if (!this._resampleUp || this._resampleUp.length !== inputBlockSize) {
      this._resampleUp = new Float32Array(inputBlockSize);
    }

    // Register the worklet processor
    await context.audioWorklet.addModule('/worklets/dtln-worklet-processor.js');

    // Create the DTLN handle for outbound
    this._outboundHandle = await this._dtln.dtln_create();

    // Build the Web Audio graph
    const source = context.createMediaStreamSource(rawStream);
    const workletNode = new AudioWorkletNode(context, 'dtln-worklet-processor', {
      processorOptions: { sampleRate: context.sampleRate },
    });
    const destination = context.createMediaStreamDestination();

    // Handle frames from the worklet
    workletNode.port.onmessage = async (e) => {
      const msg = e.data;
      if (msg.type === 'frame') {
        await this._processFrame(msg.samples, workletNode, this._outboundHandle, ratio, inputBlockSize);
      } else if (msg.type === 'cpu-timing') {
        this._updateCpuLevel(msg.avgMs);
      }
    };

    // Connect: source → worklet → destination
    source.connect(workletNode);
    workletNode.connect(destination);

    this._outboundPipeline = { context, workletNode, source, destination };

    console.log('[NoiseSuppressionService] Outbound pipeline started');
    return destination.stream;
  }

  /**
   * Process an inbound remote participant's audio through DTLN.
   */
  async processInboundTrack(
    participantIdentity: string,
    audioElement: HTMLAudioElement,
  ): Promise<void> {
    if (!this._dtlnReady || !this._dtln) return;

    // Respect the cap
    if (this._inboundPipelines.size >= MAX_INBOUND_PIPELINES) {
      console.log(`[NoiseSuppressionService] Inbound pipeline cap reached (${MAX_INBOUND_PIPELINES}), skipping:`, participantIdentity);
      return;
    }

    // Clean up existing pipeline for this participant if any
    this.removeInboundTrack(participantIdentity);

    const context = new AudioContext({ sampleRate: 48000 });
    const ratio = context.sampleRate / DTLN_RATE;
    const inputBlockSize = Math.round(DTLN_BLOCK * ratio);

    await context.audioWorklet.addModule('/worklets/dtln-worklet-processor.js');

    const handle = await this._dtln.dtln_create();
    const source = context.createMediaElementSource(audioElement);
    const workletNode = new AudioWorkletNode(context, 'dtln-worklet-processor', {
      processorOptions: { sampleRate: context.sampleRate },
    });

    workletNode.port.onmessage = async (e) => {
      const msg = e.data;
      if (msg.type === 'frame') {
        await this._processFrame(msg.samples, workletNode, handle, ratio, inputBlockSize);
      }
    };

    // Connect: source → worklet → speakers
    source.connect(workletNode);
    workletNode.connect(context.destination);

    this._inboundPipelines.set(participantIdentity, { context, workletNode, source });
    this._inboundHandles.set(participantIdentity, handle);

    console.log('[NoiseSuppressionService] Inbound pipeline started for:', participantIdentity);
  }

  /**
   * Remove an inbound pipeline for a disconnected participant.
   */
  removeInboundTrack(participantIdentity: string): void {
    const pipeline = this._inboundPipelines.get(participantIdentity);
    const handle = this._inboundHandles.get(participantIdentity) || 0;
    if (pipeline) {
      this._destroyPipeline(pipeline, handle);
      this._inboundPipelines.delete(participantIdentity);
      this._inboundHandles.delete(participantIdentity);
      console.log('[NoiseSuppressionService] Inbound pipeline stopped for:', participantIdentity);
    }
  }

  /**
   * Tear down all pipelines. Call on voice disconnect.
   */
  async destroy(): Promise<void> {
    // Destroy outbound
    if (this._outboundPipeline) {
      this._destroyPipeline(this._outboundPipeline, this._outboundHandle);
      this._outboundPipeline = null;
      this._outboundHandle = 0;
    }

    // Destroy all inbound
    for (const [identity, pipeline] of this._inboundPipelines) {
      const handle = this._inboundHandles.get(identity) || 0;
      this._destroyPipeline(pipeline, handle);
    }
    this._inboundPipelines.clear();
    this._inboundHandles.clear();

    this._cpuLevel = 'low';
    console.log('[NoiseSuppressionService] All pipelines torn down');
  }

  /**
   * Process a single frame: downsample → DTLN → upsample → send back to worklet.
   */
  private async _processFrame(
    samples: Float32Array,
    workletNode: AudioWorkletNode,
    handle: number,
    ratio: number,
    inputBlockSize: number,
  ): Promise<void> {
    if (!this._dtln || !handle) return;

    // Downsample to 16kHz
    this._downsample(samples, this._resampleDown, ratio);

    // DTLN inference
    await this._dtln.dtln_denoise(handle, this._resampleDown, this._dtlnOutput);

    // Upsample back to native rate
    if (!this._resampleUp || this._resampleUp.length !== inputBlockSize) {
      this._resampleUp = new Float32Array(inputBlockSize);
    }
    this._upsample(this._dtlnOutput, this._resampleUp, ratio);

    // Send processed samples back to worklet
    workletNode.port.postMessage(
      { type: 'processed', samples: this._resampleUp.slice() },
    );
  }

  /**
   * Linear-interpolation downsample from native rate to 16kHz.
   */
  private _downsample(input: Float32Array, output: Float32Array, ratio: number): void {
    for (let i = 0; i < DTLN_BLOCK; i++) {
      const srcIdx = i * ratio;
      const idx = Math.floor(srcIdx);
      const frac = srcIdx - idx;
      const a = input[idx] || 0;
      const b = input[Math.min(idx + 1, input.length - 1)] || 0;
      output[i] = a + frac * (b - a);
    }
  }

  /**
   * Linear-interpolation upsample from 16kHz to native rate.
   */
  private _upsample(input: Float32Array, output: Float32Array, ratio: number): void {
    const outLen = output.length;
    for (let i = 0; i < outLen; i++) {
      const srcIdx = i / ratio;
      const idx = Math.floor(srcIdx);
      const frac = srcIdx - idx;
      const a = input[Math.min(idx, DTLN_BLOCK - 1)] || 0;
      const b = input[Math.min(idx + 1, DTLN_BLOCK - 1)] || 0;
      output[i] = a + frac * (b - a);
    }
  }

  private _destroyPipeline(pipeline: Pipeline, handle: number): void {
    try {
      pipeline.workletNode.port.postMessage({ type: 'set-enabled', enabled: false });
      pipeline.workletNode.disconnect();
      pipeline.source.disconnect();
      pipeline.destination?.disconnect();
      pipeline.context.close();
    } catch {
      // Ignore errors during cleanup
    }
    if (handle && this._dtln) {
      this._dtln.dtln_destroy(handle).catch(() => {});
    }
  }

  private _updateCpuLevel(avgMs: number): void {
    const blockDurationMs = (DTLN_BLOCK / DTLN_RATE) * 1000; // ~32ms
    const utilization = avgMs / blockDurationMs;

    let level: CpuLevel;
    if (utilization < 0.3) level = 'low';
    else if (utilization < 0.6) level = 'moderate';
    else level = 'high';

    if (level !== this._cpuLevel) {
      this._cpuLevel = level;
      console.log(`[NoiseSuppressionService] CPU usage level: ${level}`);
      this._cpuListeners.forEach((fn) => fn(level));
    }
  }

  // ─── Public getters ──────────────────────────────────────────────────────────

  get isReady(): boolean {
    return this._dtlnReady;
  }

  get isLoading(): boolean {
    return this._loading;
  }

  get cpuLevel(): CpuLevel {
    return this._cpuLevel;
  }

  get loadTimeMs(): number {
    return this._loadTimeMs;
  }

  get activeInboundCount(): number {
    return this._inboundPipelines.size;
  }

  onCpuLevelChange(fn: (level: CpuLevel) => void): () => void {
    this._cpuListeners.add(fn);
    return () => this._cpuListeners.delete(fn);
  }
}

// Singleton export
export const noiseSuppressionService = new NoiseSuppressionService();
export type { CpuLevel };
