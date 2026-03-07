import { useState } from 'react';
import { api } from '@/api';

interface CreateServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (server: { id: string; name: string }) => void;
}

export function CreateServerModal({ isOpen, onClose, onCreated }: CreateServerModalProps) {
  const [serverName, setServerName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleCreate = async () => {
    const name = serverName.trim();
    if (!name) return;

    setCreating(true);
    setError('');
    try {
      const res = await api.post<{ id: string; name: string }>('/servers', { name });
      onCreated?.(res);
      setServerName('');
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create server');
    } finally {
      setCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !creating) handleCreate();
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-bg-secondary rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <h2 className="text-xl font-bold text-text-primary mb-1">Create a Server</h2>
        <p className="text-sm text-text-muted mb-6">
          Give your new server a name. You can always change it later.
        </p>

        <label className="block text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
          Server Name
        </label>
        <input
          type="text"
          name="server-name"
          value={serverName}
          onChange={(e) => setServerName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="My Awesome Server"
          maxLength={100}
          autoFocus
          className="w-full px-3 py-2 bg-bg-tertiary text-text-primary rounded-lg border border-border focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none transition-colors"
        />

        {error && (
          <p className="mt-2 text-sm text-danger">{error}</p>
        )}

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-muted hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!serverName.trim() || creating}
            className="px-4 py-2 text-sm font-medium bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
