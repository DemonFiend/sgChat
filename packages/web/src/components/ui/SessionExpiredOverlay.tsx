import { useState, useEffect, useCallback, useRef } from 'react';
import { clsx } from 'clsx';
import { useAuthStore, type AuthErrorReason } from '@/stores/auth';

const REDIRECT_DELAY_SECONDS = 10;
const REDIRECT_URL = '/login';

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
  const [countdown, setCountdown] = useState(REDIRECT_DELAY_SECONDS);
  const [isVisible, setIsVisible] = useState(false);
  const authError = useAuthStore((s) => s.authError);
  const clearAuthError = useAuthStore((s) => s.clearAuthError);

  const messages = authError ? ERROR_MESSAGES[authError] : ERROR_MESSAGES.session_expired;
  const progressPercent = (countdown / REDIRECT_DELAY_SECONDS) * 100;

  // Stable ref so handleRedirect never changes
  const clearAuthErrorRef = useRef(clearAuthError);
  clearAuthErrorRef.current = clearAuthError;

  const handleRedirect = useCallback(() => {
    clearAuthErrorRef.current();
    window.location.href = REDIRECT_URL;
  }, []);

  // Fade in after a brief delay
  useEffect(() => {
    requestAnimationFrame(() => setIsVisible(true));
  }, []);

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleRedirect();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [handleRedirect]);

  return (
    <div
      className={clsx(
        'fixed inset-0 z-[9999] flex items-center justify-center transition-opacity duration-500',
        isVisible ? 'opacity-100' : 'opacity-0'
      )}
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.85)', backdropFilter: 'blur(8px)' }}
    >
      <div className="w-full max-w-md mx-4">
        {/* Card */}
        <div
          className={clsx(
            'bg-bg-primary rounded-lg shadow-high overflow-hidden transition-transform duration-500',
            isVisible ? 'scale-100' : 'scale-95'
          )}
        >
          {/* Top accent bar */}
          <div className="h-1 bg-warning" />

          {/* Content */}
          <div className="p-8 text-center">
            {/* Icon */}
            <div className="mx-auto mb-6 w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center">
              {authError === 'server_unreachable' ? (
                <svg className="w-8 h-8 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 0 1 0 12.728M5.636 18.364a9 9 0 0 1 0-12.728" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
                </svg>
              ) : (
                <svg className="w-8 h-8 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m0 0v2m0-2h2m-2 0H10m9.364-7.364A9 9 0 1 0 5.636 16.364" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
                </svg>
              )}
            </div>

            {/* Title */}
            <h2 className="text-xl font-bold text-text-primary mb-2">
              {messages.title}
            </h2>

            {/* Description */}
            <p className="text-text-muted text-sm mb-6 leading-relaxed">
              {messages.description}
            </p>

            {/* Countdown */}
            <p className="text-text-secondary text-sm mb-4">
              Redirecting to login in{' '}
              <span className="font-semibold text-text-primary">{countdown}</span>
              {countdown === 1 ? ' second' : ' seconds'}...
            </p>

            {/* Progress bar */}
            <div className="w-full h-1.5 bg-bg-tertiary rounded-full overflow-hidden mb-6">
              <div
                className="h-full bg-warning rounded-full transition-all duration-1000 ease-linear"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* Action button */}
            <button
              onClick={handleRedirect}
              className="w-full py-2.5 px-4 rounded bg-accent hover:bg-accent-hover active:bg-accent-active text-white font-medium text-sm transition-colors duration-200 cursor-pointer"
            >
              Sign In Now
            </button>
          </div>
        </div>

        {/* Subtle branding */}
        <p className="text-center text-text-muted/50 text-xs mt-4">
          sgChat
        </p>
      </div>
    </div>
  );
}
