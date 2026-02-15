import { createSignal, onMount, Show } from 'solid-js';
import { A, useSearchParams, useNavigate } from '@solidjs/router';
import { Button, Input, NetworkSelector } from '@/components/ui';
import { api } from '@/api';
import { networkStore } from '@/stores/network';
import { hashPasswordForTransit } from '@/lib/crypto';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [password, setPassword] = createSignal('');
  const [confirmPassword, setConfirmPassword] = createSignal('');
  const [error, setError] = createSignal('');
  const [success, setSuccess] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [validating, setValidating] = createSignal(true);
  const [tokenValid, setTokenValid] = createSignal(false);

  const token = () => searchParams.token || '';

  // Check if form should be disabled (not connected to network)
  const isFormDisabled = () => networkStore.connectionStatus() !== 'connected';

  // Validate token on mount
  onMount(async () => {
    if (!token()) {
      setValidating(false);
      setError('No reset token provided');
      return;
    }

    // Wait for network connection
    const checkNetwork = () => {
      if (networkStore.connectionStatus() === 'connected') {
        validateToken();
      } else {
        setTimeout(checkNetwork, 500);
      }
    };
    checkNetwork();
  });

  const validateToken = async () => {
    try {
      const response = await api.get<{ valid: boolean; message?: string }>(
        `/auth/verify-reset-token?token=${encodeURIComponent(token())}`
      );
      setTokenValid(response.valid);
      if (!response.valid) {
        setError(response.message || 'Invalid or expired token');
      }
    } catch (err) {
      setError('Failed to validate reset token');
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError('');

    if (password() !== confirmPassword()) {
      setError('Passwords do not match');
      return;
    }

    if (password().length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      // Hash password client-side before sending
      const hashedPassword = await hashPasswordForTransit(password());

      await api.post('/auth/reset-password', {
        token: token(),
        password: hashedPassword,
      });

      setSuccess(true);
      
      // Redirect to login after 3 seconds
      setTimeout(() => {
        navigate('/login');
      }, 3000);
    } catch (err: any) {
      setError(err?.message || 'Failed to reset password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="min-h-screen flex items-center justify-center bg-bg-tertiary p-4">
      <div class="w-full max-w-md">
        <div class="bg-bg-primary rounded-md shadow-high p-8">
          <div class="text-center mb-6">
            <h1 class="text-2xl font-bold text-text-primary mb-2">Reset Password</h1>
            <p class="text-text-muted">Enter your new password</p>
          </div>

          {/* Network Selector */}
          <div class="mb-6">
            <NetworkSelector />
          </div>

          <Show when={validating()}>
            <div class="flex items-center justify-center py-8">
              <div class="w-8 h-8 border-4 border-brand-primary border-t-transparent rounded-full animate-spin" />
              <span class="ml-3 text-text-muted">Validating reset token...</span>
            </div>
          </Show>

          <Show when={!validating() && error() && !tokenValid()}>
            <div class="mb-4 p-4 rounded bg-danger/10 border border-danger/50 text-danger">
              <p class="font-medium">Unable to reset password</p>
              <p class="mt-1 text-sm">{error()}</p>
              <p class="mt-3">
                <A href="/forgot-password" class="text-text-link hover:underline">
                  Request a new reset link
                </A>
              </p>
            </div>
          </Show>

          <Show when={!validating() && tokenValid() && !success()}>
            <Show when={error()}>
              <div class="mb-4 p-3 rounded bg-danger/10 border border-danger/50 text-danger text-sm">
                {error()}
              </div>
            </Show>

            <form onSubmit={handleSubmit} class="space-y-4">
              <Input
                type="password"
                label="New Password"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                required
                autocomplete="new-password"
                disabled={isFormDisabled()}
                placeholder="Enter new password"
              />

              <Input
                type="password"
                label="Confirm Password"
                value={confirmPassword()}
                onInput={(e) => setConfirmPassword(e.currentTarget.value)}
                required
                autocomplete="new-password"
                disabled={isFormDisabled()}
                placeholder="Confirm new password"
              />

              <Button
                type="submit"
                fullWidth
                loading={loading()}
                disabled={isFormDisabled() || !password() || !confirmPassword()}
              >
                {isFormDisabled() ? 'Connect to a server first' : 'Reset Password'}
              </Button>
            </form>
          </Show>

          <Show when={success()}>
            <div class="mb-4 p-4 rounded bg-success/10 border border-success/50 text-success">
              <p class="font-medium">Password reset successful!</p>
              <p class="mt-1 text-sm">
                You can now log in with your new password. Redirecting to login...
              </p>
            </div>
          </Show>

          <p class="mt-4 text-sm text-text-muted text-center">
            <A href="/login" class="text-text-link hover:underline">
              Back to Login
            </A>
          </p>
        </div>
      </div>
    </div>
  );
}
