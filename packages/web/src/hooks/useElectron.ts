import { useState, useEffect, useMemo } from 'react';
import { isElectron, getElectronAPI, type ElectronAPI } from '@/lib/electron';

/** Returns Electron detection state and typed API access */
export function useElectron(): {
  isElectron: boolean;
  platform: ElectronAPI['platform'] | null;
  api: ElectronAPI | null;
} {
  const api = useMemo(() => getElectronAPI(), []);
  return {
    isElectron: !!api,
    platform: api?.platform ?? null,
    api,
  };
}

/** Subscribe to Electron maximize/restore state changes */
export function useElectronMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;

    // Get initial state
    api.isMaximized().then(setMaximized);

    // Subscribe to changes
    const cleanup = api.onMaximizedChange(setMaximized);
    return cleanup;
  }, []);

  return maximized;
}

/**
 * Wire up Electron global shortcuts (mute/deafen) to callbacks.
 * No-op when not running in Electron.
 */
export function useGlobalShortcuts(handlers: {
  onMuteToggle?: () => void;
  onDeafenToggle?: () => void;
}): void {
  useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;

    const cleanup = api.onGlobalShortcut((action: string) => {
      if (action === 'toggle-mute') handlers.onMuteToggle?.();
      if (action === 'toggle-deafen') handlers.onDeafenToggle?.();
    });

    return cleanup;
  }, [handlers.onMuteToggle, handlers.onDeafenToggle]);
}
