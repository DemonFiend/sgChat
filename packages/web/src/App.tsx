import { Router, Route, Navigate, useNavigate } from '@solidjs/router';
import { Show, lazy, Suspense, onMount, createEffect, createSignal, JSX } from 'solid-js';
import { authStore } from '@/stores/auth';
import { networkStore } from '@/stores/network';
import { socketService } from '@/lib/socket';

// Lazy load pages for code splitting
const LoginPage = lazy(() => import('@/features/auth/LoginPage').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('@/features/auth/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const MainLayout = lazy(() => import('@/layouts/MainLayout').then((m) => ({ default: m.MainLayout })));

function LoadingScreen() {
  return (
    <div class="min-h-screen flex items-center justify-center bg-bg-tertiary">
      <div class="flex flex-col items-center gap-4">
        <div class="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin" />
        <p class="text-text-muted">Loading...</p>
      </div>
    </div>
  );
}

function ProtectedRoute(props: { children: JSX.Element }) {
  const state = authStore.state;
  return (
    <Show when={!state().isLoading} fallback={<LoadingScreen />}>
      <Show when={state().isAuthenticated} fallback={<Navigate href="/login" />}>
        {props.children}
      </Show>
    </Show>
  );
}

function PublicRoute(props: { children: JSX.Element }) {
  const state = authStore.state;
  return (
    <Show when={!state().isLoading} fallback={<LoadingScreen />}>
      <Show when={!state().isAuthenticated} fallback={<Navigate href="/channels/@me" />}>
        {props.children}
      </Show>
    </Show>
  );
}

// Root layout handles auth initialization and provides router context
function RootLayout(props: { children?: JSX.Element }) {
  const navigate = useNavigate();
  const [initialized, setInitialized] = createSignal(false);

  onMount(async () => {
    // First, try normal auth check (refresh token via httpOnly cookie)
    const isAuthenticated = await authStore.checkAuth();
    
    if (isAuthenticated) {
      setInitialized(true);
      return;
    }

    // If not authenticated and auto-login is enabled with a default network, try auto-login
    if (networkStore.autoLogin() && networkStore.defaultNetwork()) {
      const defaultNet = networkStore.defaultNetwork()!;
      
      // Connect to the default network
      const connected = await networkStore.testConnection(defaultNet.url);
      
      if (connected) {
        // Attempt auto-login with stored credentials
        const success = await authStore.attemptAutoLogin();
        
        if (success) {
          navigate('/channels/@me', { replace: true });
        }
      }
    }
    
    setInitialized(true);
  });

  // Connect socket when authenticated
  createEffect(() => {
    if (authStore.state().isAuthenticated) {
      socketService.connect();
    } else {
      socketService.disconnect();
    }
  });

  return (
    <Show when={initialized()} fallback={<LoadingScreen />}>
      <Suspense fallback={<LoadingScreen />}>
        {props.children}
      </Suspense>
    </Show>
  );
}

export function App() {
  return (
    <Router root={RootLayout}>
      <Route path="/login" component={() => (
        <PublicRoute>
          <LoginPage />
        </PublicRoute>
      )} />
      
      <Route path="/register" component={() => (
        <PublicRoute>
          <RegisterPage />
        </PublicRoute>
      )} />

      {/* DM route - must come before :channelId to avoid @me being captured as channelId */}
      <Route path="/channels/@me" component={() => (
        <ProtectedRoute>
          <MainLayout />
        </ProtectedRoute>
      )} />

      {/* Channel route with named parameter */}
      <Route path="/channels/:channelId" component={() => (
        <ProtectedRoute>
          <MainLayout />
        </ProtectedRoute>
      )} />

      {/* Base channels route - will auto-navigate to first channel */}
      <Route path="/channels" component={() => (
        <ProtectedRoute>
          <MainLayout />
        </ProtectedRoute>
      )} />

      <Route path="/" component={() => <Navigate href="/channels/@me" />} />
      <Route path="*" component={() => <Navigate href="/login" />} />
    </Router>
  );
}
