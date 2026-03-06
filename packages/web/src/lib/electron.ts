/**
 * Electron integration layer for the web app.
 * Provides typed access to the preload bridge API when running inside Electron.
 */

export interface ElectronAPI {
  // Identity
  isElectron: true;
  platform: 'win32' | 'darwin' | 'linux';

  // Window controls
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;

  // Notifications
  showNotification: (title: string, body: string) => Promise<void>;
  flashFrame: (flag: boolean) => Promise<void>;

  // Global shortcuts
  onGlobalShortcut: (callback: (action: string) => void) => () => void;

  // Server URL
  getServerUrl: () => Promise<string>;
  setServerUrl: (url: string) => Promise<void>;
  connectToServer: (url: string) => Promise<void>;

  // Auto-start
  getAutoStart: () => Promise<boolean>;
  setAutoStart: (enabled: boolean) => Promise<void>;

  // Screen share
  screenShare: {
    getSources: () => Promise<Array<{ id: string; name: string; thumbnail: string }>>;
    onPickRequest: (callback: () => void) => () => void;
    selectSource: (id: string, audioMode: 'system' | 'app' | 'none') => void;
    onAudioModeSelected: (callback: (mode: 'system' | 'app' | 'none') => void) => () => void;
  };

  // Per-app audio capture (WASAPI on Windows)
  appAudio: {
    onPcmData: (callback: (buffer: ArrayBuffer) => void) => () => void;
    onSourceLost: (callback: () => void) => () => void;
    stop: () => void;
    isSupported: () => Promise<boolean>;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

/** Check if the app is running inside Electron */
export function isElectron(): boolean {
  return !!window.electronAPI?.isElectron;
}

/** Get the Electron API, or null if not in Electron */
export function getElectronAPI(): ElectronAPI | null {
  return window.electronAPI ?? null;
}
