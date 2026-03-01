import { useState } from 'react';
import { Link } from 'react-router';
import { Button, Input, NetworkSelector } from '@/components/ui';
import { api } from '@/api';
import { useNetworkStore } from '@/stores/network';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const [showNetworkSelector, setShowNetworkSelector] = useState(false);

  const { connectionStatus, serverInfo } = useNetworkStore();
  const isConnected = connectionStatus === 'connected';
  const isFormDisabled = !isConnected;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await api.post('/auth/forgot-password', { email });
      setSuccess(true);
    } catch {
      // Even on error, show success to prevent email enumeration
      setSuccess(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-tertiary p-4">
      <div className="w-full max-w-md">
        <div className="bg-bg-primary rounded-md shadow-high p-8">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-text-primary mb-2">Forgot Password</h1>
            <p className="text-text-muted">Enter your email to receive a password reset link</p>
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

          {error && (
            <div className="mb-4 p-3 rounded bg-danger/10 border border-danger/50 text-danger text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-4 p-3 rounded bg-success/10 border border-success/50 text-success text-sm">
              <p className="font-medium">Check your email</p>
              <p className="mt-1 text-sm">
                If an account exists with that email, you&apos;ll receive a password reset link shortly.
              </p>
            </div>
          )}

          {!success && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                type="email"
                label="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                disabled={isFormDisabled}
                placeholder="Enter your email address"
              />

              <Button
                type="submit"
                fullWidth
                loading={loading}
                disabled={isFormDisabled || !email}
              >
                {isFormDisabled ? 'Connect to a server first' : 'Send Reset Link'}
              </Button>
            </form>
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
