/**
 * Encrypted Socket Emit Helper
 *
 * Drop-in replacement for `io.to(room).emit(event, payload)` that
 * transparently encrypts payloads for sockets with active crypto sessions.
 */

import { Server as SocketIOServer } from 'socket.io';
import { encryptPayload } from '../plugins/cryptoPayload.js';

/**
 * Emit an event to all sockets in a room with per-socket encryption.
 * Sockets with `cryptoKeyHex` get an encrypted payload; others get plaintext.
 */
export async function emitEncrypted(
  io: SocketIOServer | undefined,
  room: string,
  event: string,
  payload: unknown,
): Promise<void> {
  if (!io) return;

  const sockets = await io.in(room).fetchSockets();
  for (const s of sockets) {
    if (s.data.cryptoKeyHex) {
      try {
        const encrypted = await encryptPayload(JSON.stringify(payload), s.data.cryptoKeyHex);
        s.emit(event, encrypted);
      } catch {
        s.emit(event, payload); // Fallback to unencrypted on error
      }
    } else {
      s.emit(event, payload);
    }
  }
}

/**
 * Emit an event to a single socket with encryption if available.
 */
export async function emitToSocket(
  io: SocketIOServer | undefined,
  socketRoom: string,
  event: string,
  payload: unknown,
): Promise<void> {
  // For user-targeted events (user:<id> rooms), same per-socket logic applies
  return emitEncrypted(io, socketRoom, event, payload);
}
