import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { api } from '@/api';

interface Member {
  id: string;
  username: string;
  avatar_url?: string | null;
}

interface TransferOwnershipModalProps {
  isOpen: boolean;
  onClose: () => void;
  members: Member[];
  currentOwnerId: string;
  onTransferComplete?: () => void;
}

export function TransferOwnershipModal({ isOpen, onClose, members, currentOwnerId, onTransferComplete }: TransferOwnershipModalProps) {
  const [selectedMember, setSelectedMember] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [step, setStep] = useState<'select' | 'confirm'>('select');
  const [isTransferring, setIsTransferring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligibleMembers = useMemo(() => members.filter(m => m.id !== currentOwnerId), [members, currentOwnerId]);
  const selectedMemberData = useMemo(() => members.find(m => m.id === selectedMember), [members, selectedMember]);

  const handleContinue = () => {
    if (selectedMember) setStep('confirm');
  };

  const handleTransfer = async () => {
    if (confirmText !== 'TRANSFER') {
      setError('Please type TRANSFER to confirm');
      return;
    }

    setIsTransferring(true);
    setError(null);

    try {
      await api.post('/server/transfer-ownership', { new_owner_id: selectedMember });
      onTransferComplete?.();
      handleClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to transfer ownership');
    } finally {
      setIsTransferring(false);
    }
  };

  const handleClose = () => {
    setSelectedMember('');
    setConfirmText('');
    setStep('select');
    setError(null);
    onClose();
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={handleClose} />

      <div className="relative bg-bg-primary rounded-lg shadow-2xl max-w-md w-full mx-4 overflow-hidden border border-danger/30">
        {/* Header */}
        <div className="bg-danger/20 px-6 py-4 border-b border-danger/30">
          <h2 className="text-xl font-bold text-danger">Transfer Server Ownership</h2>
        </div>

        {/* Content */}
        <div className="p-6">
          {step === 'select' && (
            <div className="space-y-4">
              <div className="bg-danger/10 border border-danger/30 rounded-lg p-4">
                <p className="text-sm text-text-primary">
                  <strong className="text-danger">Warning:</strong> This action is irreversible.
                  You will lose all owner privileges and the new owner will have full control over the server.
                </p>
              </div>

              {eligibleMembers.length > 0 ? (
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-2">
                    Select New Owner
                  </label>
                  <select
                    value={selectedMember}
                    onChange={(e) => setSelectedMember(e.target.value)}
                    className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
                  >
                    <option value="">Select a member...</option>
                    {eligibleMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.username}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="text-center py-8 text-text-muted">
                  <p>No eligible members to transfer ownership to.</p>
                  <p className="text-sm mt-2">You need at least one other member in the server.</p>
                </div>
              )}
            </div>
          )}

          {step === 'confirm' && (
            <div className="space-y-4">
              <div className="bg-danger/10 border border-danger/30 rounded-lg p-4">
                <p className="text-sm text-text-primary mb-3">
                  You are about to transfer ownership to:
                </p>
                <div className="flex items-center gap-3 p-3 bg-bg-tertiary rounded">
                  <div className="w-10 h-10 rounded-full bg-brand-primary flex items-center justify-center text-white font-bold">
                    {selectedMemberData?.avatar_url ? (
                      <img
                        src={selectedMemberData.avatar_url}
                        alt={selectedMemberData.username}
                        className="w-full h-full rounded-full object-cover"
                      />
                    ) : (
                      selectedMemberData?.username.charAt(0).toUpperCase()
                    )}
                  </div>
                  <span className="font-medium text-text-primary">
                    {selectedMemberData?.username}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-muted mb-2">
                  Type <span className="font-mono text-danger">TRANSFER</span> to confirm
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="TRANSFER"
                  className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-danger font-mono"
                />
              </div>

              {error && (
                <div className="bg-danger/10 border border-danger/30 rounded p-3">
                  <p className="text-sm text-danger">{error}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-bg-secondary px-6 py-4 flex justify-end gap-3 border-t border-border-subtle">
          <button
            onClick={handleClose}
            disabled={isTransferring}
            className="px-4 py-2 text-sm font-medium text-text-primary hover:text-text-muted transition-colors"
          >
            Cancel
          </button>

          {step === 'select' && (
            <button
              onClick={handleContinue}
              disabled={!selectedMember}
              className={clsx(
                "px-4 py-2 text-sm font-medium rounded transition-colors",
                selectedMember
                  ? "bg-danger text-white hover:bg-danger/90"
                  : "bg-bg-tertiary text-text-muted cursor-not-allowed"
              )}
            >
              Continue
            </button>
          )}

          {step === 'confirm' && (
            <>
              <button
                onClick={() => setStep('select')}
                disabled={isTransferring}
                className="px-4 py-2 text-sm font-medium text-text-muted hover:text-text-primary transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleTransfer}
                disabled={isTransferring || confirmText !== 'TRANSFER'}
                className={clsx(
                  "px-4 py-2 text-sm font-medium rounded transition-colors",
                  confirmText === 'TRANSFER' && !isTransferring
                    ? "bg-danger text-white hover:bg-danger/90"
                    : "bg-bg-tertiary text-text-muted cursor-not-allowed"
                )}
              >
                {isTransferring ? 'Transferring...' : 'Transfer Ownership'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
