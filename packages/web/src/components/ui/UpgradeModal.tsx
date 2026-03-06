import { Modal } from './Modal';
import { isElectron } from '@/lib/electron';

interface UpgradeModalProps {
  isOpen: boolean;
  onDismiss: () => void;
  serverVersion: string;
  minClientVersion: string;
}

export function UpgradeModal({ isOpen, onDismiss, serverVersion, minClientVersion }: UpgradeModalProps) {
  const inElectron = isElectron();

  const handleUpdate = () => {
    if (inElectron) {
      // Open the releases page — Electron doesn't have auto-update wired yet
      window.open('/api/releases/latest', '_blank');
    } else {
      // Web: reload to fetch the updated bundle from the server
      window.location.reload();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onDismiss} title="Update Required">
      <div className="space-y-4">
        <p className="text-text-secondary text-sm">
          The server has been updated to <span className="font-semibold text-text-primary">v{serverVersion}</span> and
          requires client version <span className="font-semibold text-text-primary">v{minClientVersion}</span> or newer.
        </p>
        <p className="text-text-secondary text-sm">
          {inElectron
            ? 'Please download the latest version of the desktop app to continue.'
            : 'Reload the page to get the latest version.'}
        </p>
        <div className="flex gap-3 justify-end pt-2">
          <button
            onClick={onDismiss}
            className="px-4 py-2 text-sm rounded bg-bg-modifier-hover text-text-secondary hover:text-text-primary transition-colors"
          >
            Continue anyway
          </button>
          <button
            onClick={handleUpdate}
            className="px-4 py-2 text-sm rounded bg-accent text-white font-medium hover:opacity-90 transition-opacity"
          >
            {inElectron ? 'Download Update' : 'Reload Now'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
