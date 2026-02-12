import { createSignal, onMount, onCleanup, Show } from 'solid-js';
import { authStore, type AuthErrorReason } from '@/stores/auth';

const REDIRECT_DELAY_SECONDS = 10;
const REDIRECT_URL = '/login';

/** Human-friendly messages for each error reason */
const ERROR_MESSAGES: Record<AuthErrorReason, { title: string; description: string }> = {
  session_expired: {
    title: 'Session Expired',
    description: 'Your session has ended. This can happen when the server restarts or your login expires.',
  },
  server_unreachable: {
    title: 'Connection Lost',
    description: 'Unable to reach the server. It may be restarting or temporarily unavailable.',
  },
  token_invalid: {
    title: 'Authentication Error',
    description: 'Your authentication is no longer valid. Please sign in again.',
  },
};

export function SessionExpiredOverlay() {
  const [countdown, setCountdown] = createSignal(REDIRECT_DELAY_SECONDS);
  const [isVisible, setIsVisible] = createSignal(false);
  let timer: ReturnType<typeof setInterval> | undefined;

  const reason = () => authStore.authError();

  const messages = () => {
    const r = reason();
    return r ? ERROR_MESSAGES[r] : ERROR_MESSAGES.session_expired;
  };

  // Fade in after a brief delay for smoothness
  onMount(() => {
    requestAnimationFrame(() => setIsVisible(true));
  });

  // Start countdown when the overlay appears
  onMount(() => {
    timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleRedirect();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  });

  onCleanup(() => {
    if (timer) clearInterval(timer);
  });

  const handleRedirect = () => {
    authStore.clearAuthError();
    // Navigate to login page
    window.location.href = REDIRECT_URL;
  };

  // Progress bar percentage (100% -> 0%)
  const progressPercent = () => (countdown() / REDIRECT_DELAY_SECONDS) * 100;

  return (
    <div
      class="fixed inset-0 z-[9999] flex items-center justify-center transition-opacity duration-500"
      classList={{ 'opacity-0': !isVisible(), 'opacity-100': isVisible() }}
      style={{ 'background-color': 'rgba(0, 0, 0, 0.85)', 'backdrop-filter': 'blur(8px)' }}
    >
      <div class="w-full max-w-md mx-4">
        {/* Card */}
        <div
          class="bg-bg-primary rounded-lg shadow-high overflow-hidden transition-transform duration-500"
          classList={{ 'scale-95': !isVisible(), 'scale-100': isVisible() }}
        >
          {/* Top accent bar */}
          <div class="h-1 bg-warning" />

          {/* Content */}
          <div class="p-8 text-center">
            {/* Icon */}
            <div class="mx-auto mb-6 w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center">
              <Show
                when={reason() === 'server_unreachable'}
                fallback={
                  <svg class="w-8 h-8 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m0 0v2m0-2h2m-2 0H10m9.364-7.364A9 9 0 1 0 5.636 16.364" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
                  </svg>
                }
              >
                {/* Cloud-off icon for server unreachable */}
                <svg class="w-8 h-8 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M18.364 5.636a9 9 0 0 1 0 12.728M5.636 18.364a9 9 0 0 1 0-12.728" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 3l18 18" />
                </svg>
              </Show>
            </div>

            {/* Title */}
            <h2 class="text-xl font-bold text-text-primary mb-2">
              {messages().title}
            </h2>

            {/* Description */}
            <p class="text-text-muted text-sm mb-6 leading-relaxed">
              {messages().description}
            </p>

            {/* Countdown */}
            <p class="text-text-secondary text-sm mb-4">
              Redirecting to login in{' '}
              <span class="font-semibold text-text-primary">{countdown()}</span>
              {countdown() === 1 ? ' second' : ' seconds'}...
            </p>

            {/* Progress bar */}
            <div class="w-full h-1.5 bg-bg-tertiary rounded-full overflow-hidden mb-6">
              <div
                class="h-full bg-warning rounded-full transition-all duration-1000 ease-linear"
                style={{ width: `${progressPercent()}%` }}
              />
            </div>

            {/* Action button */}
            <button
              onClick={handleRedirect}
              class="w-full py-2.5 px-4 rounded bg-accent hover:bg-accent-hover active:bg-accent-active text-white font-medium text-sm transition-colors duration-200 cursor-pointer"
            >
              Sign In Now
            </button>
          </div>
        </div>

        {/* Subtle branding */}
        <p class="text-center text-text-muted/50 text-xs mt-4">
          sgChat
        </p>
      </div>
    </div>
  );
}
