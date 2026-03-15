/// <reference types="vite/client" />

declare module 'dtln-rs' {
  interface DtlnPlugin {
    init(): Promise<DtlnPlugin>;
    dtln_create(): Promise<number>;
    dtln_destroy(handle: number): Promise<void>;
    dtln_denoise(handle: number, input: Float32Array, output: Float32Array): Promise<boolean>;
    isReady(): Promise<boolean>;
  }
  export const DtlnPlugin: DtlnPlugin;
  export default function initDTLN(): Promise<DtlnPlugin>;
}

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_LIVEKIT_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Tauri detection
interface Window {
  __TAURI__?: {
    invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
}
