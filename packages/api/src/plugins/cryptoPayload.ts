/**
 * Crypto Payload Plugin
 *
 * Fastify plugin that transparently encrypts/decrypts JSON payloads
 * for clients with an active crypto session.
 *
 * - preHandler: decrypts request body if it matches EncryptedPayload format
 * - onSend: encrypts response body if the request was encrypted
 */

import { FastifyPluginAsync } from 'fastify';
import { redis } from '../lib/redis.js';
import { isEncryptedPayload, CRYPTO_EXEMPT_ENDPOINTS, CRYPTO_IV_BYTES } from '@sgchat/shared';
import type { EncryptedPayload } from '@sgchat/shared';

/** Decrypt an EncryptedPayload using the session's AES-256-GCM key */
async function decryptPayload(encrypted: EncryptedPayload, keyHex: string): Promise<string> {
  const keyBytes = Buffer.from(keyHex, 'hex');
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [
    'decrypt',
  ]);
  const iv = Buffer.from(encrypted.iv, 'base64');
  const ct = Buffer.from(encrypted.ct, 'base64');
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(decrypted);
}

/** Encrypt a plaintext string into an EncryptedPayload using AES-256-GCM */
async function encryptPayload(plaintext: string, keyHex: string): Promise<EncryptedPayload> {
  const keyBytes = Buffer.from(keyHex, 'hex');
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [
    'encrypt',
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(CRYPTO_IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    _encrypted: true,
    v: 1,
    ct: Buffer.from(ct).toString('base64'),
    iv: Buffer.from(iv).toString('base64'),
  };
}

// Exported for use by socket encryption
export { encryptPayload, decryptPayload };

function isExemptRoute(url: string): boolean {
  const path = url.split('?')[0];
  return CRYPTO_EXEMPT_ENDPOINTS.some(
    (exempt) => path === exempt || path.startsWith(exempt + '/'),
  );
}

export const cryptoPayloadPlugin: FastifyPluginAsync = async (fastify) => {
  // ── Decrypt incoming requests ─────────────────────────────────
  fastify.addHook('preHandler', async (request, reply) => {
    // Skip if no body or not an object
    if (!request.body || typeof request.body !== 'object') return;

    // Skip if not an encrypted payload
    if (!isEncryptedPayload(request.body)) return;

    // Skip exempt routes
    if (isExemptRoute(request.url)) return;

    // Skip multipart requests
    const contentType = request.headers['content-type'];
    if (contentType && contentType.includes('multipart/form-data')) return;

    // Require X-Crypto-Session header
    const sessionId = request.headers['x-crypto-session'] as string;
    if (!sessionId) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'X-Crypto-Session header required for encrypted payloads',
      });
    }

    // Look up crypto session
    const session = await redis.getCryptoSession(sessionId);
    if (!session) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Crypto Session Expired',
        message: 'Encryption session not found or expired. Re-negotiate.',
        code: 'CRYPTO_SESSION_EXPIRED',
      });
    }

    // Decrypt
    try {
      const decrypted = await decryptPayload(request.body as EncryptedPayload, session.keyHex);
      request.body = JSON.parse(decrypted);
      request.cryptoSessionId = sessionId;
    } catch (err) {
      fastify.log.warn({ err }, 'Failed to decrypt request payload');
      return reply.status(400).send({
        statusCode: 400,
        error: 'Decryption Failed',
        message: 'Failed to decrypt request payload',
      });
    }

    // Refresh session TTL
    await redis.refreshCryptoSession(sessionId).catch(() => {});
  });

  // ── Encrypt outgoing responses ────────────────────────────────
  fastify.addHook('onSend', async (request, _reply, payload) => {
    // Only encrypt if the request was encrypted
    if (!request.cryptoSessionId) return payload;

    // Skip non-string payloads (binary, stream, etc.)
    if (typeof payload !== 'string') return payload;

    // Skip empty/null responses
    if (!payload || payload === 'null' || payload === '{}') return payload;

    // Look up session key
    const session = await redis.getCryptoSession(request.cryptoSessionId);
    if (!session) return payload; // Session expired mid-request; send unencrypted

    try {
      const encrypted = await encryptPayload(payload, session.keyHex);
      return JSON.stringify(encrypted);
    } catch {
      // Fallback to unencrypted on error
      return payload;
    }
  });
};
