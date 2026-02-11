import { createSignal, Show } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { Button, Input, NetworkSelector } from '@/components/ui';
import { authStore } from '@/stores/auth';
import { networkStore } from '@/stores/network';

export function RegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = createSignal('');
  const [username, setUsername] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [confirmPassword, setConfirmPassword] = createSignal('');
  const [error, setError] = createSignal('');
  const [fieldErrors, setFieldErrors] = createSignal<Record<string, string>>({});
  const [loading, setLoading] = createSignal(false);

  // Check if form should be disabled (not connected to network)
  const isFormDisabled = () => networkStore.connectionStatus() !== 'connected';

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!email().includes('@')) {
      errors.email = 'Please enter a valid email';
    }

    if (username().length < 2 || username().length > 32) {
      errors.username = 'Username must be between 2 and 32 characters';
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username())) {
      errors.username = 'Username can only contain letters, numbers, and underscores';
    }

    if (password().length < 8) {
      errors.password = 'Password must be at least 8 characters';
    }

    if (password() !== confirmPassword()) {
      errors.confirmPassword = 'Passwords do not match';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError('');

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      await authStore.register(email(), username(), password());
      navigate('/channels/@me');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="min-h-screen flex items-center justify-center bg-bg-tertiary p-4">
      <div class="w-full max-w-md">
        <div class="bg-bg-primary rounded-md shadow-high p-8">
          <div class="text-center mb-6">
            <h1 class="text-2xl font-bold text-text-primary mb-2">Create an account</h1>
          </div>

          {/* Network Selector */}
          <div class="mb-6">
            <NetworkSelector
              showSetDefaultCheckbox={true}
            />
          </div>

          <Show when={error()}>
            <div class="mb-4 p-3 rounded bg-danger/10 border border-danger/50 text-danger text-sm">
              {error()}
            </div>
          </Show>

          <form onSubmit={handleSubmit} class="space-y-4">
            <Input
              type="email"
              label="Email"
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              error={fieldErrors().email}
              required
              autocomplete="email"
              disabled={isFormDisabled()}
            />

            <Input
              type="text"
              label="Username"
              value={username()}
              onInput={(e) => setUsername(e.currentTarget.value)}
              error={fieldErrors().username}
              required
              autocomplete="username"
              disabled={isFormDisabled()}
            />

            <Input
              type="password"
              label="Password"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              error={fieldErrors().password}
              required
              autocomplete="new-password"
              disabled={isFormDisabled()}
            />

            <Input
              type="password"
              label="Confirm Password"
              value={confirmPassword()}
              onInput={(e) => setConfirmPassword(e.currentTarget.value)}
              error={fieldErrors().confirmPassword}
              required
              autocomplete="new-password"
              disabled={isFormDisabled()}
            />

            <p class="text-xs text-text-muted">
              By registering, you agree to sgChat's Terms of Service and Privacy Policy.
            </p>

            <Button
              type="submit"
              fullWidth
              loading={loading()}
              disabled={isFormDisabled() || !email() || !username() || !password() || !confirmPassword()}
            >
              {isFormDisabled() ? 'Connect to a server first' : 'Continue'}
            </Button>
          </form>

          <p class="mt-4 text-sm text-text-muted">
            Already have an account?{' '}
            <A href="/login" class="text-text-link hover:underline">
              Log In
            </A>
          </p>
        </div>
      </div>
    </div>
  );
}
