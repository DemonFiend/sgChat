import { Component, type ReactNode, type ErrorInfo, useState, useEffect } from 'react';
import { useDevModeStore } from '@/stores/devMode';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

function CopyErrorButton({ error, componentStack }: { error: Error; componentStack: string | null }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const parts = [error.message];
    if (error.stack) parts.push(error.stack);
    if (componentStack) parts.push('Component Stack:' + componentStack);
    const text = parts.join('\n\n');

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Fallback: prompt
      window.prompt('Copy error:', text);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className="px-6 py-2.5 rounded bg-bg-secondary hover:bg-bg-modifier-hover text-text-primary font-medium text-sm transition-colors"
    >
      {copied ? 'Copied!' : 'Copy Error'}
    </button>
  );
}

function ErrorDetails({ error, componentStack }: { error: Error; componentStack: string | null }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="w-full text-left mt-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-text-muted hover:text-text-primary transition-colors flex items-center gap-1"
      >
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
        </svg>
        Stack Trace
      </button>
      {expanded && (
        <pre className="mt-2 p-3 bg-black/30 rounded text-xs text-text-muted overflow-auto max-h-64 whitespace-pre-wrap break-words">
          {error.stack || error.message}
          {componentStack && (
            <>
              {'\n\nComponent Stack:'}
              {componentStack}
            </>
          )}
        </pre>
      )}
    </div>
  );
}

/** Wrapper that reads devMode store reactively for use inside class component render */
function DevModeGate({ error, componentStack }: { error: Error; componentStack: string | null }) {
  const devMode = useDevModeStore((s) => s.enabled);
  if (!devMode) return null;
  return (
    <>
      <ErrorDetails error={error} componentStack={componentStack} />
      <div className="mt-3">
        <CopyErrorButton error={error} componentStack={componentStack} />
      </div>
    </>
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, info.componentStack);
    this.setState({ componentStack: info.componentStack || null });
  }

  render() {
    if (this.state.hasError) {
      const { error, componentStack } = this.state;
      return (
        <div className="h-screen flex items-center justify-center bg-bg-primary text-text-primary">
          <div className="max-w-lg mx-4 text-center">
            <div className="mx-auto mb-6 w-16 h-16 rounded-full bg-danger/10 flex items-center justify-center">
              <svg className="w-8 h-8 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold mb-2">Something went wrong</h2>
            <p className="text-text-muted text-sm mb-4">
              {error?.message || 'An unexpected error occurred.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2.5 rounded bg-accent hover:bg-accent-hover text-white font-medium text-sm transition-colors"
            >
              Reload Page
            </button>
            {error && <DevModeGate error={error} componentStack={componentStack} />}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
