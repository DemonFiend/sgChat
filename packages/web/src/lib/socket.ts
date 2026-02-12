import { io, Socket } from 'socket.io-client';
import { createSignal, createRoot } from 'solid-js';
import { authStore } from '@/stores/auth';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

function createSocketService() {
  const [connectionState, setConnectionState] = createSignal<ConnectionState>('disconnected');
  const [reconnectAttempts, setReconnectAttempts] = createSignal(0);
  
  let socket: Socket | null = null;
  
  // Queue of pending event handlers to register when socket connects
  const pendingHandlers: Map<string, Set<(data: unknown) => void>> = new Map();

  const registerPendingHandlers = () => {
    if (!socket) return;
    pendingHandlers.forEach((handlers, event) => {
      handlers.forEach(handler => {
        socket!.on(event, handler);
      });
    });
  };

  const connect = () => {
    const token = authStore.getAccessToken();
    if (!token) {
      console.warn('Cannot connect socket: no auth token');
      return;
    }

    if (socket?.connected) {
      return;
    }

    setConnectionState('connecting');

    // When VITE_WS_URL is empty/unset, connect to the same origin (production)
    const wsUrl = import.meta.env.VITE_WS_URL || undefined;

    socket = io(wsUrl, {
      auth: { token },
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: Infinity,
    });

    // Register any pending handlers
    registerPendingHandlers();

    socket.on('connect', () => {
      setConnectionState('connected');
      setReconnectAttempts(0);
      console.log('[Socket] Connected');
    });

    socket.on('disconnect', async (reason) => {
      setConnectionState('disconnected');
      console.log('[Socket] Disconnected:', reason);

      // Server disconnected us - likely token expired
      if (reason === 'io server disconnect') {
        try {
          const newToken = await authStore.refreshAccessToken();
          if (socket) {
            socket.auth = { token: newToken };
            socket.connect();
          }
        } catch {
          // Refresh failed -- the auth store's refreshAccessToken already
          // triggers the auth error overlay, so we just log here.
          console.error('[Socket] Token refresh failed after server disconnect');
        }
      }
    });

    socket.on('reconnect_attempt', (attempt) => {
      setConnectionState('reconnecting');
      setReconnectAttempts(attempt);
    });

    socket.on('connect_error', async (error) => {
      console.error('[Socket] Connection error:', error.message);

      if (error.message === 'Invalid token' || error.message === 'jwt expired') {
        try {
          const newToken = await authStore.refreshAccessToken();
          if (socket) {
            socket.auth = { token: newToken };
            socket.connect();
          }
        } catch {
          // Refresh failed -- the auth store's refreshAccessToken already
          // triggers the auth error overlay, so we just log here.
          console.error('[Socket] Token refresh failed on connect error');
        }
      }
    });
  };

  const disconnect = () => {
    socket?.disconnect();
    socket = null;
    setConnectionState('disconnected');
  };

  const emit = <T = unknown>(event: string, data?: unknown): Promise<T> => {
    return new Promise((resolve, reject) => {
      if (!socket?.connected) {
        reject(new Error('Socket not connected'));
        return;
      }

      socket.emit(event, data, (response: T) => {
        resolve(response);
      });
    });
  };

  const on = <T = unknown>(event: string, handler: (data: T) => void) => {
    // Add to pending handlers
    if (!pendingHandlers.has(event)) {
      pendingHandlers.set(event, new Set());
    }
    pendingHandlers.get(event)!.add(handler as (data: unknown) => void);
    
    // If socket exists, also register immediately
    if (socket) {
      socket.on(event, handler);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const off = (event: string, handler?: (data: any) => void) => {
    // Remove from pending handlers
    if (handler && pendingHandlers.has(event)) {
      pendingHandlers.get(event)!.delete(handler as (data: unknown) => void);
      if (pendingHandlers.get(event)!.size === 0) {
        pendingHandlers.delete(event);
      }
    } else if (!handler) {
      pendingHandlers.delete(event);
    }
    
    // If socket exists, also unregister
    if (socket) {
      if (handler) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        socket.off(event, handler as any);
      } else {
        socket.off(event);
      }
    }
  };

  const getSocket = () => socket;

  return {
    connectionState,
    reconnectAttempts,
    connect,
    disconnect,
    emit,
    on,
    off,
    getSocket,
  };
}

export const socketService = createRoot(createSocketService);
