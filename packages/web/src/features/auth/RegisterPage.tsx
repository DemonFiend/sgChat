import { useState, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button, Input, NetworkSelector } from '@/components/ui';
import { useAuthStore } from '@/stores/auth';
import { useNetworkStore } from '@/stores/network';

export function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteCodeFromUrl = searchParams.get('invite') || '';

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState(inviteCodeFromUrl);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const [showNetworkSelector, setShowNetworkSelector] = useState(false);

  const { register } = useAuthStore();
  const { connectionStatus, serverInfo } = useNetworkStore();

  const isConnected = connectionStatus === 'connected';
  const isFormDisabled = !isConnected;
  const signupsDisabled = (serverInfo as any)?.signups_disabled === true;
  const hasInviteCode = inviteCode.trim().length > 0;

  // If signups are disabled and no invite code is available, show closed message
  const isRegistrationBlocked = useMemo(
    () => signupsDisabled && !hasInviteCode,
    [signupsDisabled, hasInviteCode],
  );

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!email.includes('@')) {
      errors.email = 'Please enter a valid email';
    }

    if (username.length < 2 || username.length > 32) {
      errors.username = 'Username must be between 2 and 32 characters';
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      errors.username = 'Username can only contain letters, numbers, underscores, and hyphens';
    }

    if (password.length < 8) {
      errors.password = 'Password must be at least 8 characters';
    }

    if (password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!validateForm()) return;

    setLoading(true);

    try {
      await register(email, username, password, inviteCode.trim() || undefined);
      // Check if user is pending approval
      const { isPendingApproval } = useAuthStore.getState();
      if (isPendingApproval) {
        navigate('/pending-approval');
      } else {
        navigate('/channels/@me');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-tertiary p-4">
      <div className="w-full max-w-md">
        <div className="bg-bg-primary rounded-md shadow-high p-8">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-text-primary mb-2">Create an account</h1>
          </div>

          {/* Network connection */}
          {!isConnected || showNetworkSelector ? (
            <div className="mb-6">
              <NetworkSelector showSetDefaultCheckbox />
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

          {/* Registration closed message */}
          {isConnected && signupsDisabled && !hasInviteCode && (
            <div className="mb-4 p-4 rounded bg-warning/10 border border-warning/50 text-center">
              <svg className="w-8 h-8 text-warning mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m0 0v2m0-2h2m-2 0H10m2-10V5a2 2 0 00-2-2H8a2 2 0 00-2 2v2m8 0V5a2 2 0 012 2v0a2 2 0 01-2 2m-8 0h8" />
              </svg>
              <p className="text-text-primary font-medium mb-1">Registration is currently closed</p>
              <p className="text-text-muted text-sm">
                This server is invite-only. If you have an invite link, enter the code below.
              </p>
              <div className="mt-3">
                <Input
                  type="text"
                  label="Invite Code"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Enter your invite code"
                />
              </div>
            </div>
          )}

          {/* Invite notice */}
          {isConnected && signupsDisabled && hasInviteCode && (
            <div className="mb-4 p-3 rounded bg-success/10 border border-success/50 text-sm text-success">
              You&apos;ve been invited to join this server.
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 rounded bg-danger/10 border border-danger/50 text-danger text-sm">
              {error}
            </div>
          )}

          {!isRegistrationBlocked && (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                <Input
                  type="email"
                  label="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  error={fieldErrors.email}
                  required
                  autoComplete="email"
                  disabled={isFormDisabled}
                />

                <Input
                  type="text"
                  label="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  error={fieldErrors.username}
                  required
                  autoComplete="username"
                  disabled={isFormDisabled}
                />

                <Input
                  type="password"
                  label="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  error={fieldErrors.password}
                  required
                  autoComplete="new-password"
                  disabled={isFormDisabled}
                />

                <Input
                  type="password"
                  label="Confirm Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  error={fieldErrors.confirmPassword}
                  required
                  autoComplete="new-password"
                  disabled={isFormDisabled}
                />

                {/* Show invite code field if signups disabled and code came from URL */}
                {signupsDisabled && (
                  <Input
                    type="text"
                    label="Invite Code"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    placeholder="Enter your invite code"
                    disabled={isFormDisabled}
                  />
                )}

                <p className="text-xs text-text-muted">
                  By registering, you agree to sgChat&apos;s Terms of Service and Privacy Policy.
                </p>

                <Button
                  type="submit"
                  fullWidth
                  loading={loading}
                  disabled={isFormDisabled || !email || !username || !password || !confirmPassword}
                >
                  {isFormDisabled ? 'Connect to a server first' : 'Continue'}
                </Button>
              </form>

              <p className="mt-4 text-sm text-text-muted">
                Already have an account?{' '}
                <Link to="/login" className="text-text-link hover:underline">
                  Log In
                </Link>
              </p>
            </>
          )}

          {isRegistrationBlocked && (
            <p className="mt-4 text-sm text-text-muted text-center">
              Already have an account?{' '}
              <Link to="/login" className="text-text-link hover:underline">
                Log In
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
