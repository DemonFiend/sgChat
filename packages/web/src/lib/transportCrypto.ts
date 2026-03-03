/**
 * Transport Encryption Module
 *
 * Handles ECDH P-256 key exchange with the server and provides
 * AES-256-GCM encrypt/decrypt functions for all API payloads.
 *
 * State is module-scoped (like access tokens) — each browser tab
 * gets its own crypto session with independent forward secrecy.
 */

import {
  CRYPTO_HKDF_INFO,
  CRYPTO_IV_BYTES,
  type EncryptedPayload,
  type CryptoExchangeResponse,
} from '@sgchat/shared';

// ── Module State ──────────────────────────────────────────────

let cryptoSessionId: string | null = null;
let aesKey: CryptoKey | null = null;
let sessionExpiresAt = 0;
let negotiationPromise: Promise<void> | null = null;

// ── Public API ────────────────────────────────────────────────

/**
 * Ensure a crypto session exists. If not, performs ECDH key exchange.
 * Deduplicates concurrent calls (same pattern as token refresh).
 */
export async function ensureCryptoSession(apiUrl: string): Promise<void> {
  // Already have a valid session (with 5-min buffer)
  if (aesKey && cryptoSessionId && Date.now() < sessionExpiresAt - 5 * 60 * 1000) {
    return;
  }

  // Dedup concurrent negotiations
  if (negotiationPromise) return negotiationPromise;

  negotiationPromise = negotiate(apiUrl).finally(() => {
    negotiationPromise = null;
  });

  return negotiationPromise;
}

/** Get the current crypto session ID (for X-Crypto-Session header) */
export function getCryptoSessionId(): string | null {
  return cryptoSessionId;
}

/** Check if we have an active crypto session */
export function hasCryptoSession(): boolean {
  return aesKey !== null && cryptoSessionId !== null && Date.now() < sessionExpiresAt;
}

/** Clear the crypto session (e.g., on logout or session expiry) */
export function clearCryptoSession(): void {
  cryptoSessionId = null;
  aesKey = null;
  sessionExpiresAt = 0;
}

/**
 * Encrypt a plaintext string for transport.
 * Throws if no crypto session is active.
 */
export async function encryptForTransport(plaintext: string): Promise<EncryptedPayload> {
  if (!aesKey) throw new Error('No crypto session');

  const iv = crypto.getRandomValues(new Uint8Array(CRYPTO_IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    new TextEncoder().encode(plaintext),
  );

  return {
    _encrypted: true,
    v: 1,
    ct: btoa(String.fromCharCode(...new Uint8Array(ct))),
    iv: btoa(String.fromCharCode(...new Uint8Array(iv))),
  };
}

/**
 * Decrypt an encrypted payload from the server.
 * Throws if no crypto session is active or decryption fails.
 */
export async function decryptFromTransport(encrypted: EncryptedPayload): Promise<string> {
  if (!aesKey) throw new Error('No crypto session');

  const ct = Uint8Array.from(atob(encrypted.ct), (c) => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(encrypted.iv), (c) => c.charCodeAt(0));

  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ct);
  return new TextDecoder().decode(plaintext);
}

// ── Private ───────────────────────────────────────────────────

async function negotiate(apiUrl: string): Promise<void> {
  // 1. Generate ephemeral ECDH P-256 keypair
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );

  // 2. Export client public key as base64
  const clientPubRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const clientPubB64 = btoa(String.fromCharCode(...new Uint8Array(clientPubRaw)));

  // 3. Key exchange with server (unencrypted)
  const response = await fetch(`${apiUrl}/api/crypto/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientPublicKey: clientPubB64 }),
  });

  if (!response.ok) {
    throw new Error(`Key exchange failed: ${response.status}`);
  }

  const { serverPublicKey, sessionId, expiresAt }: CryptoExchangeResponse = await response.json();

  // 4. Import server public key
  const serverPubBytes = Uint8Array.from(atob(serverPublicKey), (c) => c.charCodeAt(0));
  const serverPubKey = await crypto.subtle.importKey(
    'raw',
    serverPubBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  // 5. Derive shared bits
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: serverPubKey },
    keyPair.privateKey,
    256,
  );

  // 6. Import shared bits as HKDF key material
  const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);

  // 7. Derive AES-256-GCM key via HKDF
  aesKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(sessionId),
      info: new TextEncoder().encode(CRYPTO_HKDF_INFO),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );

  cryptoSessionId = sessionId;
  sessionExpiresAt = new Date(expiresAt).getTime();
}
