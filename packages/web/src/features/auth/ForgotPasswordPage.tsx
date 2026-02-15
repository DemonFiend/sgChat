import { createSignal, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { Button, Input, NetworkSelector } from '@/components/ui';
import { api } from '@/api';
import { networkStore } from '@/stores/network';

export function ForgotPasswordPage() {
  const [email, setEmail] = createSignal('');
  const [error, setError] = createSignal('');
  const [success, setSuccess] = createSignal(false);
  const [loading, setLoading] = createSignal(false);

  // Check if form should be disabled (not connected to network)
  const isFormDisabled = () => networkStore.connectionStatus() !== 'connected';

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await api.post('/auth/forgot-password', { email: email() });
      setSuccess(true);
    } catch (err: any) {
      // Even on error, we show success to prevent email enumeration
      setSuccess(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="min-h-screen flex items-center justify-center bg-bg-tertiary p-4">
      <div class="w-full max-w-md">
        <div class="bg-bg-primary rounded-md shadow-high p-8">
          <div class="text-center mb-6">
            <h1 class="text-2xl font-bold text-text-primary mb-2">Forgot Password</h1>
            <p class="text-text-muted">Enter your email to receive a password reset link</p>
          </div>

          {/* Network Selector */}
          <div class="mb-6">
            <NetworkSelector />
          </div>

          <Show when={error()}>
            <div class="mb-4 p-3 rounded bg-danger/10 border border-danger/50 text-danger text-sm">
              {error()}
            </div>
          </Show>

          <Show when={success()}>
            <div class="mb-4 p-3 rounded bg-success/10 border border-success/50 text-success text-sm">
              <p class="font-medium">Check your email</p>
              <p class="mt-1 text-sm">
                If an account exists with that email, you'll receive a password reset link shortly.
              </p>
            </div>
          </Show>

          <Show when={!success()}>
            <form onSubmit={handleSubmit} class="space-y-4">
              <Input
                type="email"
                label="Email"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                required
                autocomplete="email"
                disabled={isFormDisabled()}
                placeholder="Enter your email address"
              />

              <Button
                type="submit"
                fullWidth
                loading={loading()}
                disabled={isFormDisabled() || !email()}
              >
                {isFormDisabled() ? 'Connect to a server first' : 'Send Reset Link'}
              </Button>
            </form>
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
