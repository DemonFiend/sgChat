import { useElectron } from '@/hooks/useElectron';

/**
 * Title bar for Electron — draggable region with app icon and title.
 * Native titleBarOverlay handles minimize/maximize/close buttons.
 * Only renders when running inside Electron.
 */
export function TitleBar() {
  const { isElectron } = useElectron();

  if (!isElectron) return null;

  return (
    <div
      className="flex items-center h-8 bg-bg-tertiary select-none shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* App icon + title */}
      <div className="flex items-center gap-2 pl-3">
        <svg className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12zM7 9h2v2H7V9zm4 0h2v2h-2V9zm4 0h2v2h-2V9z" />
        </svg>
        <span className="text-xs font-semibold text-text-muted">sgChat</span>
      </div>
    </div>
  );
}
