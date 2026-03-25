import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, Input, NetworkSelector } from '@/components/ui';
import { useAuthStore, LoginError } from '@/stores/auth';
import { useNetworkStore } from '@/stores/network';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [retryAfter, setRetryAfter] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showNetworkSelector, setShowNetworkSelector] = useState(false);

  const { loginWithRememberMe } = useAuthStore();
  const { connectionStatus, currentUrl, serverInfo, getAccountsForNetwork, isCredentialExpired } = useNetworkStore();

  const isConnected = connectionStatus === 'connected';
  const isFormDisabled = !isConnected;

  const hasSavedCredentials = () => {
    if (!currentUrl) return false;
    const accounts = getAccountsForNetwork(currentUrl);
    return accounts.some((a) => a.rememberMe && a.encryptedPassword && !isCredentialExpired(a));
  };

  const handleNetworkReady = useCallback((url: string) => {
    const accounts = getAccountsForNetwork(url);
    if (accounts.length > 0) {
      setEmail(accounts[0].email);
      if (accounts[0].rememberMe && accounts[0].encryptedPassword) {
        setRememberMe(true);
      }
    }
  }, [getAccountsForNetwork]);

  // Auto-populate saved credentials when already connected on mount
  useEffect(() => {
    if (isConnected && currentUrl) {
      handleNetworkReady(currentUrl);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await loginWithRememberMe(email, password, rememberMe);
      const { isPendingApproval } = useAuthStore.getState();
      if (isPendingApproval) {
        navigate('/pending-approval');
      } else {
        navigate('/channels/@me');
      }
    } catch (err) {
      if (err instanceof LoginError && err.code === 'APPLICATION_DENIED') {
        setError(err.message);
        setRetryAfter(err.retry_after || null);
      } else {
        setError(err instanceof Error ? err.message : 'Login failed');
        setRetryAfter(null);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-tertiary p-4">
      <div className="w-full max-w-md">
        <div className="bg-bg-primary rounded-md shadow-high p-8">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-text-primary mb-2">Welcome back!</h1>
            <p className="text-text-muted">We&apos;re so excited to see you again!</p>
          </div>

          {/* Network connection */}
          {!isConnected || showNetworkSelector ? (
            <div className="mb-6">
              <NetworkSelector
                onNetworkReady={handleNetworkReady}
                showAutoLoginToggle
                showSetDefaultCheckbox
              />
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

          {error && (
            <div className="mb-4 p-3 rounded bg-danger/10 border border-danger/50 text-danger text-sm">
              <p>{error}</p>
              {retryAfter && (
                <p className="mt-1 text-text-muted">
                  You may re-apply after{' '}
                  <span className="font-medium text-text-primary">
                    {new Date(retryAfter).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                </p>
              )}
            </div>
          )}

          {hasSavedCredentials() && !error && (
            <div className="mb-4 p-3 rounded bg-success/10 border border-success/50 text-success text-sm">
              Saved login available for this account
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="email"
              label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              disabled={isFormDisabled}
            />

            <Input
              type="password"
              label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              disabled={isFormDisabled}
            />

            <label className="flex items-center gap-2 text-sm text-text-muted cursor-pointer">
              <input
                type="checkbox"
                name="rememberMe"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                disabled={isFormDisabled}
                className="w-4 h-4 rounded border-border-primary bg-bg-secondary text-accent-primary focus:ring-accent-primary focus:ring-offset-0"
              />
              Remember me
            </label>

            <Button
              type="submit"
              fullWidth
              loading={loading}
              disabled={isFormDisabled || !email || !password}
            >
              {isFormDisabled ? 'Connect to a server first' : 'Log In'}
            </Button>
          </form>

          <div className="mt-4 flex justify-between items-center text-sm text-text-muted">
            <Link to="/forgot-password" className="text-text-link hover:underline">
              Forgot your password?
            </Link>
            <span>
              Need an account?{' '}
              <Link to="/register" className="text-text-link hover:underline">
                Register
              </Link>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
