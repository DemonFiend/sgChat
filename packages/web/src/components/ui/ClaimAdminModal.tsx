import { createSignal, Show } from 'solid-js';
import { Button, Input, Modal } from '@/components/ui';
import { api } from '@/api';

interface ClaimAdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ClaimAdminModal(props: ClaimAdminModalProps) {
  const [claimCode, setClaimCode] = createSignal('');
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [success, setSuccess] = createSignal(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    
    const code = claimCode().trim();
    if (!code) {
      setError('Please enter the claim code');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await api.post('/auth/claim-admin', { code });
      setSuccess(true);
      
      // Wait a moment to show success, then close and refresh
      setTimeout(() => {
        props.onSuccess();
        props.onClose();
      }, 1500);
    } catch (err: any) {
      const message = err?.message || err?.error || 'Failed to claim ownership';
      if (message.includes('already been claimed')) {
        setError('This server has already been claimed by another user');
      } else if (message.includes('Invalid')) {
        setError('Invalid claim code. Please check and try again.');
      } else {
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setClaimCode('');
    setError(null);
    setSuccess(false);
    props.onClose();
  };

  return (
    <Modal isOpen={props.isOpen} onClose={handleClose} title="Claim Server Ownership">
      <div class="p-6">
        <Show
          when={!success()}
          fallback={
            <div class="text-center py-8">
              <div class="w-16 h-16 mx-auto mb-4 bg-status-online/20 rounded-full flex items-center justify-center">
                <svg class="w-8 h-8 text-status-online" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 class="text-xl font-semibold text-text-primary mb-2">Ownership Claimed!</h3>
              <p class="text-text-muted">You are now the server administrator.</p>
            </div>
          }
        >
          {/* Lock Icon */}
          <div class="flex justify-center mb-6">
            <div class="w-20 h-20 bg-brand-primary/20 rounded-full flex items-center justify-center">
              <svg class="w-10 h-10 text-brand-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
          </div>

          <div class="text-center mb-6">
            <h3 class="text-lg font-semibold text-text-primary mb-2">
              This server has no owner yet!
            </h3>
            <p class="text-sm text-text-muted">
              If you deployed this server, enter the admin claim code from the server logs to become the administrator.
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            <div class="mb-4">
              <label class="block text-sm font-medium text-text-primary mb-2">
                Claim Code
              </label>
              <Input
                type="text"
                value={claimCode()}
                onInput={(e) => setClaimCode(e.currentTarget.value)}
                placeholder="Enter the 32-character claim code..."
                class="font-mono text-sm"
                disabled={isLoading()}
              />
            </div>

            <Show when={error()}>
              <div class="mb-4 p-3 bg-danger/10 border border-danger/30 rounded-lg">
                <p class="text-sm text-danger">{error()}</p>
              </div>
            </Show>

            <Button
              type="submit"
              variant="primary"
              class="w-full"
              disabled={isLoading() || !claimCode().trim()}
            >
              {isLoading() ? (
                <span class="flex items-center justify-center gap-2">
                  <svg class="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Claiming...
                </span>
              ) : (
                'Claim Ownership'
              )}
            </Button>
          </form>

          <p class="mt-4 text-xs text-text-muted text-center">
            Don't have the code? Contact whoever deployed this server.
          </p>
        </Show>
      </div>
    </Modal>
  );
}
