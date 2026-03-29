#!/usr/bin/env node

/**
 * Copies RNNoise WASM binaries and worklet processor from @sapphi-red/web-noise-suppressor
 * into packages/web/public/ so they can be loaded at runtime by AudioWorklet.
 *
 * Run: node scripts/download-nsnet2-wasm.mjs
 */

import { cpSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve from the web workspace where the dep is installed
const webRequire = createRequire(resolve(__dirname, '..', 'packages', 'web', 'package.json'));
const distDir = dirname(webRequire.resolve('@sapphi-red/web-noise-suppressor'));
const targetWasmDir = resolve(__dirname, '..', 'packages', 'web', 'public', 'wasm', 'rnnoise');
const targetWorkletDir = resolve(__dirname, '..', 'packages', 'web', 'public', 'worklets');

// Ensure target dirs exist
mkdirSync(targetWasmDir, { recursive: true });
mkdirSync(targetWorkletDir, { recursive: true });

// Copy WASM binaries
const wasmFiles = ['rnnoise.wasm', 'rnnoise_simd.wasm'];
for (const file of wasmFiles) {
  const src = resolve(distDir, file);
  const dest = resolve(targetWasmDir, file);
  if (!existsSync(src)) {
    console.error(`Missing: ${src}`);
    process.exit(1);
  }
  cpSync(src, dest);
  console.log(`Copied ${file} -> ${dest}`);
}

// Copy worklet processor
const workletSrc = resolve(distDir, 'rnnoise', 'workletProcessor.js');
const workletDest = resolve(targetWorkletDir, 'rnnoise-worklet-processor.js');
if (!existsSync(workletSrc)) {
  console.error(`Missing: ${workletSrc}`);
  process.exit(1);
}
cpSync(workletSrc, workletDest);
console.log(`Copied workletProcessor.js -> ${workletDest}`);

console.log('\nDone! RNNoise assets copied to packages/web/public/');
