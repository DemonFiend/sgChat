import { createSignal, Show } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { Button, Input, NetworkSelector } from '@/components/ui';
import { authStore } from '@/stores/auth';
import { networkStore } from '@/stores/network';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [rememberMe, setRememberMe] = createSignal(false);
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);

  // Check if form should be disabled (not connected to network)
  const isFormDisabled = () => networkStore.connectionStatus() !== 'connected';

  // Check if there are saved credentials for the current network
  const hasSavedCredentials = () => {
    const url = networkStore.currentUrl();
    if (!url) return false;
    const accounts = networkStore.getAccountsForNetwork(url);
    return accounts.some((a) => a.rememberMe && a.encryptedPassword && !networkStore.isCredentialExpired(a));
  };

  // Pre-fill email when network is ready
  const handleNetworkReady = (url: string) => {
    const accounts = networkStore.getAccountsForNetwork(url);
    if (accounts.length > 0) {
      setEmail(accounts[0].email);
      // If account has saved credentials, enable remember me
      if (accounts[0].rememberMe && accounts[0].encryptedPassword) {
        setRememberMe(true);
      }
    }
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await authStore.loginWithRememberMe(email(), password(), rememberMe());
      navigate('/channels/@me');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="min-h-screen flex items-center justify-center bg-bg-tertiary p-4">
      <div class="w-full max-w-md">
        <div class="bg-bg-primary rounded-md shadow-high p-8">
          <div class="text-center mb-6">
            <h1 class="text-2xl font-bold text-text-primary mb-2">Welcome back!</h1>
            <p class="text-text-muted">We're so excited to see you again!</p>
          </div>

          {/* Network Selector */}
          <div class="mb-6">
            <NetworkSelector
              onNetworkReady={handleNetworkReady}
              showAutoLoginToggle={true}
              showSetDefaultCheckbox={true}
            />
          </div>

          <Show when={error()}>
            <div class="mb-4 p-3 rounded bg-danger/10 border border-danger/50 text-danger text-sm">
              {error()}
            </div>
          </Show>

          <Show when={hasSavedCredentials() && !error()}>
            <div class="mb-4 p-3 rounded bg-success/10 border border-success/50 text-success text-sm">
              Saved login available for this account
            </div>
          </Show>

          <form onSubmit={handleSubmit} class="space-y-4">
            <Input
              type="email"
              label="Email"
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              required
              autocomplete="email"
              disabled={isFormDisabled()}
            />

            <Input
              type="password"
              label="Password"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              required
              autocomplete="current-password"
              disabled={isFormDisabled()}
            />

            <label class="flex items-center gap-2 text-sm text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={rememberMe()}
                onChange={(e) => setRememberMe(e.currentTarget.checked)}
                disabled={isFormDisabled()}
                class="w-4 h-4 rounded border-border-primary bg-bg-secondary text-accent-primary focus:ring-accent-primary focus:ring-offset-0"
              />
              Remember me
            </label>

            <Button
              type="submit"
              fullWidth
              loading={loading()}
              disabled={isFormDisabled() || !email() || !password()}
            >
              {isFormDisabled() ? 'Connect to a server first' : 'Log In'}
            </Button>
          </form>

          <div class="mt-4 flex justify-between items-center text-sm text-text-muted">
            <A href="/forgot-password" class="text-text-link hover:underline">
              Forgot your password?
            </A>
            <span>
              Need an account?{' '}
              <A href="/register" class="text-text-link hover:underline">
                Register
              </A>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
