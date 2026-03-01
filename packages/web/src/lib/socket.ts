import { io, Socket } from 'socket.io-client';
import { create } from 'zustand';
import { authStore } from '@/stores/auth';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

interface SocketState {
  connectionState: ConnectionState;
  reconnectAttempts: number;
}

export const useSocketStore = create<SocketState>(() => ({
  connectionState: 'disconnected',
  reconnectAttempts: 0,
}));

let socket: Socket | null = null;
let refreshRetryCount = 0;
const MAX_REFRESH_RETRIES = 3;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatInterval = 30000;
const pendingHandlers: Map<string, Set<(data: unknown) => void>> = new Map();

const startHeartbeat = () => {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (socket?.connected) socket.emit('gateway.heartbeat');
  }, heartbeatInterval);
};

const stopHeartbeat = () => {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
};

const registerPendingHandlers = () => {
  if (!socket) return;
  pendingHandlers.forEach((handlers, event) => {
    handlers.forEach((handler) => socket!.on(event, handler));
  });
};

function connect() {
  const token = authStore.getAccessToken();
  if (!token) { console.warn('Cannot connect socket: no auth token'); return; }
  if (socket?.connected) return;

  useSocketStore.setState({ connectionState: 'connecting' });

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

  registerPendingHandlers();

  socket.on('connect', () => {
    useSocketStore.setState({ connectionState: 'connected', reconnectAttempts: 0 });
    refreshRetryCount = 0;
  });

  socket.on('gateway.hello', (data: { heartbeat_interval: number; session_id: string }) => {
    heartbeatInterval = data.heartbeat_interval;
    startHeartbeat();
  });

  socket.on('gateway.heartbeat_ack', () => {});

  socket.on('disconnect', async (reason) => {
    useSocketStore.setState({ connectionState: 'disconnected' });
    stopHeartbeat();
    if (reason === 'io server disconnect') {
      if (refreshRetryCount >= MAX_REFRESH_RETRIES) { socket?.disconnect(); return; }
      refreshRetryCount++;
      try {
        const newToken = await authStore.refreshAccessToken();
        if (socket) { socket.auth = { token: newToken }; socket.connect(); }
      } catch { console.error('[Socket] Token refresh failed after server disconnect'); }
    }
  });

  socket.on('reconnect_attempt', (attempt: number) => {
    useSocketStore.setState({ connectionState: 'reconnecting', reconnectAttempts: attempt });
  });

  socket.on('connect_error', async (error) => {
    if (error.message === 'Invalid token' || error.message === 'jwt expired') {
      if (refreshRetryCount >= MAX_REFRESH_RETRIES) { socket?.disconnect(); return; }
      refreshRetryCount++;
      try {
        const newToken = await authStore.refreshAccessToken();
        if (socket) { socket.auth = { token: newToken }; socket.connect(); }
      } catch { console.error('[Socket] Token refresh failed on connect error'); }
    }
  });
}

function disconnect() {
  stopHeartbeat();
  socket?.disconnect();
  socket = null;
  useSocketStore.setState({ connectionState: 'disconnected' });
}

function emit<T = unknown>(event: string, data?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) { reject(new Error('Socket not connected')); return; }
    socket.emit(event, data, (response: T) => resolve(response));
  });
}

function on<T = unknown>(event: string, handler: (data: T) => void) {
  if (!pendingHandlers.has(event)) pendingHandlers.set(event, new Set());
  pendingHandlers.get(event)!.add(handler as (data: unknown) => void);
  if (socket) socket.on(event, handler);
}

function off(event: string, handler?: (data: unknown) => void) {
  if (handler && pendingHandlers.has(event)) {
    pendingHandlers.get(event)!.delete(handler);
    if (pendingHandlers.get(event)!.size === 0) pendingHandlers.delete(event);
  } else if (!handler) {
    pendingHandlers.delete(event);
  }
  if (socket) {
    if (handler) socket.off(event, handler);
    else socket.off(event);
  }
}

function getSocket() { return socket; }

export const socketService = { connect, disconnect, emit, on, off, getSocket };
