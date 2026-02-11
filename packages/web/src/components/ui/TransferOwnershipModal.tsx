import { createSignal, For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
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

export function TransferOwnershipModal(props: TransferOwnershipModalProps) {
  const [selectedMember, setSelectedMember] = createSignal<string>('');
  const [confirmText, setConfirmText] = createSignal('');
  const [step, setStep] = createSignal<'select' | 'confirm'>('select');
  const [isTransferring, setIsTransferring] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const eligibleMembers = () => props.members.filter(m => m.id !== props.currentOwnerId);

  const selectedMemberData = () => props.members.find(m => m.id === selectedMember());

  const handleContinue = () => {
    if (selectedMember()) {
      setStep('confirm');
    }
  };

  const handleTransfer = async () => {
    if (confirmText() !== 'TRANSFER') {
      setError('Please type TRANSFER to confirm');
      return;
    }

    setIsTransferring(true);
    setError(null);

    try {
      await api.post('/server/transfer-ownership', {
        new_owner_id: selectedMember()
      });
      
      props.onTransferComplete?.();
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
    props.onClose();
  };

  return (
    <Show when={props.isOpen}>
      <Portal>
        <div class="fixed inset-0 z-[100] flex items-center justify-center">
          {/* Backdrop */}
          <div 
            class="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Modal */}
          <div class="relative bg-bg-primary rounded-lg shadow-2xl max-w-md w-full mx-4 overflow-hidden border border-danger/30">
            {/* Header */}
            <div class="bg-danger/20 px-6 py-4 border-b border-danger/30">
              <h2 class="text-xl font-bold text-danger">Transfer Server Ownership</h2>
            </div>

            {/* Content */}
            <div class="p-6">
              <Show when={step() === 'select'}>
                <div class="space-y-4">
                  <div class="bg-danger/10 border border-danger/30 rounded-lg p-4">
                    <p class="text-sm text-text-primary">
                      <strong class="text-danger">Warning:</strong> This action is irreversible. 
                      You will lose all owner privileges and the new owner will have full control over the server.
                    </p>
                  </div>

                  <Show 
                    when={eligibleMembers().length > 0}
                    fallback={
                      <div class="text-center py-8 text-text-muted">
                        <p>No eligible members to transfer ownership to.</p>
                        <p class="text-sm mt-2">You need at least one other member in the server.</p>
                      </div>
                    }
                  >
                    <div>
                      <label class="block text-sm font-medium text-text-muted mb-2">
                        Select New Owner
                      </label>
                      <select
                        value={selectedMember()}
                        onChange={(e) => setSelectedMember(e.currentTarget.value)}
                        class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
                      >
                        <option value="">Select a member...</option>
                        <For each={eligibleMembers()}>
                          {(member) => (
                            <option value={member.id}>
                              {member.username}
                            </option>
                          )}
                        </For>
                      </select>
                    </div>
                  </Show>
                </div>
              </Show>

              <Show when={step() === 'confirm'}>
                <div class="space-y-4">
                  <div class="bg-danger/10 border border-danger/30 rounded-lg p-4">
                    <p class="text-sm text-text-primary mb-3">
                      You are about to transfer ownership to:
                    </p>
                    <div class="flex items-center gap-3 p-3 bg-bg-tertiary rounded">
                      <div class="w-10 h-10 rounded-full bg-brand-primary flex items-center justify-center text-white font-bold">
                        {selectedMemberData()?.avatar_url ? (
                          <img 
                            src={selectedMemberData()!.avatar_url!} 
                            alt={selectedMemberData()!.username}
                            class="w-full h-full rounded-full object-cover"
                          />
                        ) : (
                          selectedMemberData()?.username.charAt(0).toUpperCase()
                        )}
                      </div>
                      <span class="font-medium text-text-primary">
                        {selectedMemberData()?.username}
                      </span>
                    </div>
                  </div>

                  <div>
                    <label class="block text-sm font-medium text-text-muted mb-2">
                      Type <span class="font-mono text-danger">TRANSFER</span> to confirm
                    </label>
                    <input
                      type="text"
                      value={confirmText()}
                      onInput={(e) => setConfirmText(e.currentTarget.value)}
                      placeholder="TRANSFER"
                      class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-danger font-mono"
                    />
                  </div>

                  <Show when={error()}>
                    <div class="bg-danger/10 border border-danger/30 rounded p-3">
                      <p class="text-sm text-danger">{error()}</p>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>

            {/* Footer */}
            <div class="bg-bg-secondary px-6 py-4 flex justify-end gap-3 border-t border-border-subtle">
              <button
                onClick={handleClose}
                disabled={isTransferring()}
                class="px-4 py-2 text-sm font-medium text-text-primary hover:text-text-muted transition-colors"
              >
                Cancel
              </button>
              
              <Show when={step() === 'select'}>
                <button
                  onClick={handleContinue}
                  disabled={!selectedMember()}
                  class={clsx(
                    "px-4 py-2 text-sm font-medium rounded transition-colors",
                    selectedMember() 
                      ? "bg-danger text-white hover:bg-danger/90" 
                      : "bg-bg-tertiary text-text-muted cursor-not-allowed"
                  )}
                >
                  Continue
                </button>
              </Show>
              
              <Show when={step() === 'confirm'}>
                <button
                  onClick={() => setStep('select')}
                  disabled={isTransferring()}
                  class="px-4 py-2 text-sm font-medium text-text-muted hover:text-text-primary transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleTransfer}
                  disabled={isTransferring() || confirmText() !== 'TRANSFER'}
                  class={clsx(
                    "px-4 py-2 text-sm font-medium rounded transition-colors",
                    confirmText() === 'TRANSFER' && !isTransferring()
                      ? "bg-danger text-white hover:bg-danger/90" 
                      : "bg-bg-tertiary text-text-muted cursor-not-allowed"
                  )}
                >
                  {isTransferring() ? 'Transferring...' : 'Transfer Ownership'}
                </button>
              </Show>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
