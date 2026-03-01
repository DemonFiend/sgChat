import { useState, useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router';
import { Button, Input, NetworkSelector } from '@/components/ui';
import { api } from '@/api';
import { useNetworkStore } from '@/stores/network';
import { hashPasswordForTransit } from '@/lib/crypto';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);

  const [showNetworkSelector, setShowNetworkSelector] = useState(false);

  const { connectionStatus, serverInfo } = useNetworkStore();
  const isConnected = connectionStatus === 'connected';
  const isFormDisabled = !isConnected;

  const token = searchParams.get('token') || '';

  // Validate token on mount
  useEffect(() => {
    if (!token) {
      setValidating(false);
      setError('No reset token provided');
      return;
    }

    const checkNetwork = () => {
      if (connectionStatus === 'connected') {
        validateToken();
      } else {
        setTimeout(checkNetwork, 500);
      }
    };
    checkNetwork();

    async function validateToken() {
      try {
        const response = await api.get<{ valid: boolean; message?: string }>(
          `/auth/verify-reset-token?token=${encodeURIComponent(token)}`
        );
        setTokenValid(response.valid);
        if (!response.valid) {
          setError(response.message || 'Invalid or expired token');
        }
      } catch {
        setError('Failed to validate reset token');
      } finally {
        setValidating(false);
      }
    }
  }, [token, connectionStatus]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      const hashedPassword = await hashPasswordForTransit(password);
      await api.post('/auth/reset-password', {
        token,
        password: hashedPassword,
      });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to reset password. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-tertiary p-4">
      <div className="w-full max-w-md">
        <div className="bg-bg-primary rounded-md shadow-high p-8">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-text-primary mb-2">Reset Password</h1>
            <p className="text-text-muted">Enter your new password</p>
          </div>

          {/* Network connection */}
          {!isConnected || showNetworkSelector ? (
            <div className="mb-6">
              <NetworkSelector />
            </div>
          ) : (
            <div className="mb-4 flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-success">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
                Connected to &quot;{serverInfo?.name}&quot;
              </span>
              <button
                onClick={() => setShowNetworkSelector(true)}
                className="text-text-link text-xs hover:underline"
              >
                Change
              </button>
            </div>
          )}

          {validating && (
            <div className="flex items-center justify-center py-8">
              <div className="w-8 h-8 border-4 border-brand-primary border-t-transparent rounded-full animate-spin" />
              <span className="ml-3 text-text-muted">Validating reset token...</span>
            </div>
          )}

          {!validating && error && !tokenValid && (
            <div className="mb-4 p-4 rounded bg-danger/10 border border-danger/50 text-danger">
              <p className="font-medium">Unable to reset password</p>
              <p className="mt-1 text-sm">{error}</p>
              <p className="mt-3">
                <Link to="/forgot-password" className="text-text-link hover:underline">
                  Request a new reset link
                </Link>
              </p>
            </div>
          )}

          {!validating && tokenValid && !success && (
            <>
              {error && (
                <div className="mb-4 p-3 rounded bg-danger/10 border border-danger/50 text-danger text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <Input
                  type="password"
                  label="New Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  disabled={isFormDisabled}
                  placeholder="Enter new password"
                />

                <Input
                  type="password"
                  label="Confirm Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  disabled={isFormDisabled}
                  placeholder="Confirm new password"
                />

                <Button
                  type="submit"
                  fullWidth
                  loading={loading}
                  disabled={isFormDisabled || !password || !confirmPassword}
                >
                  {isFormDisabled ? 'Connect to a server first' : 'Reset Password'}
                </Button>
              </form>
            </>
          )}

          {success && (
            <div className="mb-4 p-4 rounded bg-success/10 border border-success/50 text-success">
              <p className="font-medium">Password reset successful!</p>
              <p className="mt-1 text-sm">
                You can now log in with your new password. Redirecting to login...
              </p>
            </div>
          )}

          <p className="mt-4 text-sm text-text-muted text-center">
            <Link to="/login" className="text-text-link hover:underline">
              Back to Login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
