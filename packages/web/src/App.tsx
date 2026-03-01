import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router';
import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { useAuthStore } from '@/stores/auth';
import { useNetworkStore } from '@/stores/network';
import { socketService } from '@/lib/socket';
import { SessionExpiredOverlay } from '@/components/ui/SessionExpiredOverlay';

const LoginPage = lazy(() => import('@/features/auth/LoginPage').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('@/features/auth/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const ForgotPasswordPage = lazy(() => import('@/features/auth/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('@/features/auth/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })));
const MainLayout = lazy(() => import('@/layouts/MainLayout').then((m) => ({ default: m.MainLayout })));
const DMLayout = lazy(() => import('@/layouts/DMLayout').then((m) => ({ default: m.DMLayout })));

function LoadingScreen() {
  return (
    <div className="h-screen flex bg-bg-tertiary overflow-hidden">
      {/* Server list skeleton */}
      <div className="w-[72px] flex flex-col items-center gap-2 py-3 bg-bg-tertiary">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="w-12 h-12 rounded-2xl bg-bg-modifier-hover animate-pulse" />
        ))}
      </div>

      {/* Channel sidebar skeleton */}
      <div className="w-60 flex flex-col bg-bg-secondary">
        <div className="h-12 px-4 flex items-center border-b border-bg-tertiary">
          <div className="w-32 h-4 rounded bg-bg-modifier-hover animate-pulse" />
        </div>
        <div className="flex-1 p-3 space-y-3">
          <div className="w-24 h-3 rounded bg-bg-modifier-hover animate-pulse" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 px-2">
              <div className="w-4 h-4 rounded bg-bg-modifier-hover animate-pulse" />
              <div className="h-3 rounded bg-bg-modifier-hover animate-pulse" style={{ width: `${60 + i * 15}px` }} />
            </div>
          ))}
        </div>
        {/* User panel skeleton */}
        <div className="h-[52px] px-2 flex items-center gap-2 bg-bg-tertiary">
          <div className="w-8 h-8 rounded-full bg-bg-modifier-hover animate-pulse" />
          <div className="w-20 h-3 rounded bg-bg-modifier-hover animate-pulse" />
        </div>
      </div>

      {/* Main content skeleton */}
      <div className="flex-1 flex flex-col bg-bg-primary">
        <div className="h-12 px-4 flex items-center gap-3 border-b border-bg-tertiary">
          <div className="w-4 h-4 rounded bg-bg-modifier-hover animate-pulse" />
          <div className="w-28 h-4 rounded bg-bg-modifier-hover animate-pulse" />
        </div>
        <div className="flex-1 p-4 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="w-10 h-10 rounded-full bg-bg-modifier-hover animate-pulse shrink-0" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="flex gap-2">
                  <div className="w-24 h-3.5 rounded bg-bg-modifier-hover animate-pulse" />
                  <div className="w-10 h-2.5 rounded bg-bg-modifier-hover animate-pulse" />
                </div>
                <div className="h-3 rounded bg-bg-modifier-hover animate-pulse" style={{ width: `${40 + i * 10}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();
  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();
  if (isLoading) return <LoadingScreen />;
  if (isAuthenticated) return <Navigate to="/channels/@me" replace />;
  return <>{children}</>;
}

function RootLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [initialized, setInitialized] = useState(false);
  const { isAuthenticated, authError, checkAuth, attemptAutoLogin } = useAuthStore();
  const { currentUrl, testConnection, addOrUpdateNetwork, autoLogin, defaultNetwork, serverInfo } = useNetworkStore();

  useEffect(() => {
    const init = async () => {
      // Auto-connect to same-origin server
      const isSameOrigin = !currentUrl || currentUrl === window.location.origin || currentUrl === '/api';
      if (isSameOrigin) {
        const connected = await testConnection(window.location.origin);
        if (connected) {
          addOrUpdateNetwork(window.location.origin, {
            name: serverInfo?.name || 'sgChat Server',
            isDefault: true,
            lastConnected: new Date().toISOString(),
          });
        }
      }

      const isAuth = await checkAuth();
      if (isAuth) { setInitialized(true); return; }

      if (autoLogin) {
        const defaultNet = defaultNetwork();
        if (defaultNet) {
          const connected = await testConnection(defaultNet.url);
          if (connected) {
            const success = await attemptAutoLogin();
            if (success) navigate('/channels/@me', { replace: true });
          }
        }
      }
      setInitialized(true);
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Connect/disconnect socket based on auth state
  useEffect(() => {
    if (isAuthenticated) socketService.connect();
    else socketService.disconnect();
  }, [isAuthenticated]);

  if (!initialized) return <LoadingScreen />;

  return (
    <>
      {authError && <SessionExpiredOverlay />}
      <Suspense fallback={<LoadingScreen />}>
        {children}
      </Suspense>
    </>
  );
}

function AppRoutes() {
  return (
    <RootLayout>
      <Routes>
        <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
        <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
        <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
        <Route path="/reset-password" element={<PublicRoute><ResetPasswordPage /></PublicRoute>} />
        <Route path="/channels/@me" element={<ProtectedRoute><DMLayout /></ProtectedRoute>} />
        <Route path="/channels/:channelId" element={<ProtectedRoute><MainLayout /></ProtectedRoute>} />
        <Route path="/channels" element={<ProtectedRoute><MainLayout /></ProtectedRoute>} />
        <Route path="/" element={<Navigate to="/channels/@me" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </RootLayout>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
