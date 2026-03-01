import { useState } from 'react';
import { Button, Input, Modal } from '@/components/ui';
import { api } from '@/api';

interface ClaimAdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ClaimAdminModal({ isOpen, onClose, onSuccess }: ClaimAdminModalProps) {
  const [claimCode, setClaimCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const code = claimCode.trim();
    if (!code) {
      setError('Please enter the claim code');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await api.post('/auth/claim-admin', { code });
      setSuccess(true);

      setTimeout(() => {
        onSuccess();
        onClose();
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
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Claim Server Ownership">
      <div className="p-6">
        {success ? (
          <div className="text-center py-8">
            <div className="w-16 h-16 mx-auto mb-4 bg-status-online/20 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-status-online" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-text-primary mb-2">Ownership Claimed!</h3>
            <p className="text-text-muted">You are now the server administrator.</p>
          </div>
        ) : (
          <>
            {/* Lock Icon */}
            <div className="flex justify-center mb-6">
              <div className="w-20 h-20 bg-brand-primary/20 rounded-full flex items-center justify-center">
                <svg className="w-10 h-10 text-brand-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
            </div>

            <div className="text-center mb-6">
              <h3 className="text-lg font-semibold text-text-primary mb-2">
                This server has no owner yet!
              </h3>
              <p className="text-sm text-text-muted">
                If you deployed this server, enter the admin claim code from the server logs to become the administrator.
              </p>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Claim Code
                </label>
                <Input
                  type="text"
                  value={claimCode}
                  onChange={(e) => setClaimCode(e.target.value)}
                  placeholder="Enter the 32-character claim code..."
                  className="font-mono text-sm"
                  disabled={isLoading}
                />
              </div>

              {error && (
                <div className="mb-4 p-3 bg-danger/10 border border-danger/30 rounded-lg">
                  <p className="text-sm text-danger">{error}</p>
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                disabled={isLoading || !claimCode.trim()}
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Claiming...
                  </span>
                ) : (
                  'Claim Ownership'
                )}
              </Button>
            </form>

            <p className="mt-4 text-xs text-text-muted text-center">
              Don&apos;t have the code? Contact whoever deployed this server.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
