/**
 * DTLN AudioWorklet Processor
 *
 * Buffers audio frames and relays them to/from the main thread for DTLN
 * inference. The actual WASM processing happens on the main thread via dtln-rs.
 *
 * Protocol:
 *   Main → Worklet:  { type: 'processed', samples: Float32Array }
 *                     { type: 'set-enabled', enabled: boolean }
 *   Worklet → Main:  { type: 'frame', samples: Float32Array }
 *
 * Architecture:
 *   Mic (48kHz, 128/frame) → [buffer 1536 samples] → postMessage to main
 *   Main thread: downsample → DTLN → upsample → postMessage back
 *   Worklet: double-buffer output, drain 128 samples per process() call
 */

const DTLN_BLOCK = 512;
const DTLN_RATE = 16000;

class DtlnWorkletProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    this._enabled = true;
    this._sampleRate = options.processorOptions?.sampleRate || 48000;
    this._ratio = this._sampleRate / DTLN_RATE;

    // Input accumulation buffer (at native sample rate)
    this._inputBlockSize = Math.round(DTLN_BLOCK * this._ratio);
    this._inputBuffer = new Float32Array(this._inputBlockSize);
    this._inputPos = 0;

    // Double-buffered output: one being drained, one being filled
    this._outputA = new Float32Array(this._inputBlockSize);
    this._outputB = new Float32Array(this._inputBlockSize);
    this._activeOutput = this._outputA;
    this._outputPos = 0;
    this._hasOutput = false;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'processed') {
        // Swap buffers: the one we were draining becomes the fill target
        if (this._activeOutput === this._outputA) {
          this._outputB.set(msg.samples);
          this._activeOutput = this._outputB;
        } else {
          this._outputA.set(msg.samples);
          this._activeOutput = this._outputA;
        }
        this._outputPos = 0;
        this._hasOutput = true;
      } else if (msg.type === 'set-enabled') {
        this._enabled = msg.enabled;
        if (!msg.enabled) {
          this._hasOutput = false;
          this._inputPos = 0;
        }
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input?.[0] || !output?.[0]) return true;

    const inData = input[0];
    const outData = output[0];
    const len = inData.length;

    // If disabled, passthrough
    if (!this._enabled) {
      outData.set(inData);
      return true;
    }

    // Accumulate input samples
    const remaining = this._inputBlockSize - this._inputPos;
    const toCopy = Math.min(len, remaining);
    this._inputBuffer.set(inData.subarray(0, toCopy), this._inputPos);
    this._inputPos += toCopy;

    // When we have a full block, send it to main thread for DTLN processing
    if (this._inputPos >= this._inputBlockSize) {
      this.port.postMessage(
        { type: 'frame', samples: this._inputBuffer.slice() },
      );
      this._inputPos = 0;

      // Handle leftover samples from this frame
      if (toCopy < len) {
        const leftover = len - toCopy;
        this._inputBuffer.set(inData.subarray(toCopy), 0);
        this._inputPos = leftover;
      }
    }

    // Output: drain from the active output buffer
    if (this._hasOutput && this._outputPos + len <= this._activeOutput.length) {
      outData.set(this._activeOutput.subarray(this._outputPos, this._outputPos + len));
      this._outputPos += len;
    } else {
      // No processed data yet or buffer exhausted — output silence
      outData.fill(0);
    }

    return true;
  }
}

registerProcessor('dtln-worklet-processor', DtlnWorkletProcessor);
