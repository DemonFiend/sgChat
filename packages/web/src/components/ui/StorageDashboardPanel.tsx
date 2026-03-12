import { StorageTab } from './StorageTab';

interface StorageDashboardPanelProps {
  onClose: () => void;
}

export function StorageDashboardPanel({ onClose }: StorageDashboardPanelProps) {
  return (
    <div className="flex-1 flex flex-col h-full bg-bg-primary">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-bg-tertiary flex-shrink-0">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
          </svg>
          <h2 className="text-lg font-semibold text-text-primary">Storage Dashboard</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded hover:bg-bg-modifier-hover text-text-muted hover:text-text-primary transition-colors"
          title="Close"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          <StorageTab />
        </div>
      </div>
    </div>
  );
}
