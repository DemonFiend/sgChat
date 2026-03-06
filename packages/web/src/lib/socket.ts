import { io, Socket } from 'socket.io-client';
import { create } from 'zustand';
import { authStore } from '@/stores/auth';
import { isEncryptedPayload, isVersionCompatible } from '@sgchat/shared';
import {
  getCryptoSessionId,
  hasCryptoSession,
  encryptForTransport,
  decryptFromTransport,
} from '@/lib/transportCrypto';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

interface VersionMismatch {
  serverVersion: string;
  minClientVersion: string;
}

interface SocketState {
  connectionState: ConnectionState;
  reconnectAttempts: number;
  versionMismatch: VersionMismatch | null;
}

export const useSocketStore = create<SocketState>(() => ({
  connectionState: 'disconnected',
  reconnectAttempts: 0,
  versionMismatch: null,
}));

let socket: Socket | null = null;
let refreshRetryCount = 0;
const MAX_REFRESH_RETRIES = 3;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatInterval = 30000;
let gatewaySessionId: string | null = null;
let lastSequences: Record<string, number> = {};
const pendingHandlers: Map<string, Set<(data: unknown) => void>> = new Map();

// Maps original handler → wrapped handler for proper cleanup
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handlerWrapperMap = new WeakMap<(...args: any[]) => any, (...args: any[]) => any>();

const startHeartbeat = () => {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (socket?.connected) socket.emit('gateway.heartbeat');
  }, heartbeatInterval);
};

const stopHeartbeat = () => {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
};

const registerPendingHandlers = () => {
  if (!socket) return;
  pendingHandlers.forEach((handlers, event) => {
    handlers.forEach((handler) => socket!.on(event, handler));
  });
};

function connect() {
  const token = authStore.getAccessToken();
  if (!token) {
    console.warn('Cannot connect socket: no auth token');
    return;
  }
  if (socket?.connected) return;

  useSocketStore.setState({ connectionState: 'connecting' });

  const wsUrl = import.meta.env.VITE_WS_URL || undefined;
  const cryptoSessionId = getCryptoSessionId();

  socket = io(wsUrl, {
    auth: { token, cryptoSessionId },
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

  socket.on('gateway.hello', (data: {
    heartbeat_interval: number;
    session_id: string;
    server_version?: string;
    protocol_version?: number;
    min_client_version?: string;
  }) => {
    heartbeatInterval = data.heartbeat_interval;
    gatewaySessionId = data.session_id;
    startHeartbeat();

    // Check client-server version compatibility
    if (data.min_client_version && data.server_version) {
      const clientVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
      if (!isVersionCompatible(clientVersion, data.min_client_version)) {
        useSocketStore.setState({
          versionMismatch: {
            serverVersion: data.server_version,
            minClientVersion: data.min_client_version,
          },
        });
      }
    }
  });

  socket.on('gateway.ready', (data: { sequences?: Record<string, number> }) => {
    lastSequences = data.sequences || {};
  });

  socket.on('gateway.resumed', (data: { session_id?: string; missed_events?: any[]; sequences?: Record<string, number> }) => {
    gatewaySessionId = data.session_id || gatewaySessionId;
    lastSequences = data.sequences || lastSequences;
    // Replay missed events as named events so existing handlers process them
    if (Array.isArray(data.missed_events)) {
      for (const envelope of data.missed_events) {
        if (envelope.resource_id) {
          lastSequences[envelope.resource_id] = envelope.sequence;
        }
        // Re-emit as named event for existing socketService.on() handlers
        socket?.emit(envelope.type, envelope.payload);
      }
    }
  });

  socket.on('gateway.resume_failed', (data: { reason: string; message?: string }) => {
    console.warn('[Socket] Gateway resume failed:', data.reason, data.message);
    gatewaySessionId = null;
    lastSequences = {};
  });

  socket.on('gateway.heartbeat_ack', () => {});

  socket.on('disconnect', async (reason) => {
    useSocketStore.setState({ connectionState: 'disconnected' });
    stopHeartbeat();

    // Attempt session resume on reconnect (unless client-initiated disconnect)
    if (reason !== 'io client disconnect' && gatewaySessionId) {
      socket?.once('connect', () => {
        socket?.emit('gateway.resume', {
          session_id: gatewaySessionId,
          last_sequences: lastSequences,
        });
      });
    }

    if (reason === 'io server disconnect') {
      if (refreshRetryCount >= MAX_REFRESH_RETRIES) {
        socket?.disconnect();
        return;
      }
      refreshRetryCount++;
      try {
        const newToken = await authStore.refreshAccessToken();
        if (socket) {
          socket.auth = { token: newToken, cryptoSessionId: getCryptoSessionId() };
          socket.connect();
        }
      } catch {
        console.error('[Socket] Token refresh failed after server disconnect');
      }
    }
  });

  socket.on('reconnect_attempt', (attempt: number) => {
    useSocketStore.setState({ connectionState: 'reconnecting', reconnectAttempts: attempt });
  });

  socket.on('connect_error', async (error) => {
    if (error.message === 'Invalid token' || error.message === 'jwt expired') {
      if (refreshRetryCount >= MAX_REFRESH_RETRIES) {
        socket?.disconnect();
        return;
      }
      refreshRetryCount++;
      try {
        const newToken = await authStore.refreshAccessToken();
        if (socket) {
          socket.auth = { token: newToken, cryptoSessionId: getCryptoSessionId() };
          socket.connect();
        }
      } catch {
        console.error('[Socket] Token refresh failed on connect error');
      }
    }
  });
}

function disconnect() {
  stopHeartbeat();
  socket?.disconnect();
  socket = null;
  gatewaySessionId = null;
  lastSequences = {};
  useSocketStore.setState({ connectionState: 'disconnected' });
}

async function emit<T = unknown>(event: string, data?: unknown): Promise<T> {
  // eslint-disable-next-line no-async-promise-executor
  return new Promise(async (resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error('Socket not connected'));
      return;
    }

    let payload = data;
    if (data !== undefined && hasCryptoSession()) {
      try {
        payload = await encryptForTransport(JSON.stringify(data));
      } catch {
        // Fallback to unencrypted
      }
    }

    socket.emit(event, payload, (response: T) => resolve(response));
  });
}

function on<T = unknown>(event: string, handler: (data: T) => void) {
  // Wrap handler to auto-decrypt incoming encrypted payloads
  const wrappedHandler = async (data: unknown) => {
    if (isEncryptedPayload(data)) {
      try {
        const plaintext = await decryptFromTransport(data);
        handler(JSON.parse(plaintext) as T);
      } catch {
        // If decryption fails, pass raw data
        handler(data as T);
      }
    } else {
      handler(data as T);
    }
  };

  handlerWrapperMap.set(handler, wrappedHandler);

  if (!pendingHandlers.has(event)) pendingHandlers.set(event, new Set());
  pendingHandlers.get(event)!.add(wrappedHandler as (data: unknown) => void);
  if (socket) socket.on(event, wrappedHandler as any);
}

function off(event: string, handler?: (data: unknown) => void) {
  if (handler) {
    // Find the wrapped handler for proper cleanup
    const wrapped = handlerWrapperMap.get(handler) || handler;
    handlerWrapperMap.delete(handler);

    if (pendingHandlers.has(event)) {
      pendingHandlers.get(event)!.delete(wrapped as (data: unknown) => void);
      if (pendingHandlers.get(event)!.size === 0) pendingHandlers.delete(event);
    }
    if (socket) socket.off(event, wrapped as any);
  } else {
    pendingHandlers.delete(event);
    if (socket) socket.off(event);
  }
}

function getSocket() {
  return socket;
}

export const socketService = { connect, disconnect, emit, on, off, getSocket };
