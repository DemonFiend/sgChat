/**
 * Payload Encryption Types & Utilities
 *
 * Shared between server and all clients (web, desktop).
 * Provides the envelope format for AES-256-GCM encrypted payloads
 * and helpers for password pre-hash validation.
 */

// ── Encrypted Payload Envelope ────────────────────────────────

/** AES-256-GCM encrypted payload envelope */
export interface EncryptedPayload {
  _encrypted: true;
  /** Protocol version */
  v: 1;
  /** Base64-encoded AES-GCM ciphertext (includes appended 16-byte auth tag) */
  ct: string;
  /** Base64-encoded 12-byte initialization vector */
  iv: string;
}

/** Type guard: checks if a value is an encrypted payload */
export function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)._encrypted === true &&
    (value as Record<string, unknown>).v === 1 &&
    typeof (value as Record<string, unknown>).ct === 'string' &&
    typeof (value as Record<string, unknown>).iv === 'string'
  );
}

// ── Key Exchange ──────────────────────────────────────────────

/** Client → Server key exchange request */
export interface CryptoExchangeRequest {
  /** Base64-encoded ECDH P-256 public key (raw format, 65 bytes uncompressed) */
  clientPublicKey: string;
}

/** Server → Client key exchange response */
export interface CryptoExchangeResponse {
  /** Base64-encoded ECDH P-256 public key (raw format, 65 bytes uncompressed) */
  serverPublicKey: string;
  /** Session ID for X-Crypto-Session header */
  sessionId: string;
  /** ISO-8601 expiration timestamp */
  expiresAt: string;
}

// ── Password Pre-Hash Validation ──────────────────────────────

/** Matches sha256:<64 lowercase hex chars> */
export const SHA256_PASSWORD_REGEX = /^sha256:[a-f0-9]{64}$/;

/** Check if a password string is in the required pre-hashed format */
export function isPreHashedPassword(password: string): boolean {
  return SHA256_PASSWORD_REGEX.test(password);
}

// ── Exempt Endpoints ──────────────────────────────────────────

/** Routes that are never encrypted (health checks, key exchange, static files) */
export const CRYPTO_EXEMPT_ENDPOINTS = [
  '/health',
  '/api/health',
  '/api/version',
  '/api/crypto/exchange',
] as const;

// ── HKDF Info String ──────────────────────────────────────────

/** Domain separation string for HKDF key derivation */
export const CRYPTO_HKDF_INFO = 'sgchat-payload-encryption-v1';

/** AES key length in bits */
export const CRYPTO_AES_KEY_BITS = 256;

/** IV length in bytes for AES-GCM */
export const CRYPTO_IV_BYTES = 12;

/** Crypto session TTL in seconds (1 hour) */
export const CRYPTO_SESSION_TTL = 3600;

/** Maximum absolute session lifetime in seconds (4 hours) */
export const CRYPTO_SESSION_MAX_TTL = 14400;

// ── E2E Encryption (Client↔Client) ──────────────────────────

/** E2E device key bundle (public keys stored on server) */
export interface E2EDeviceKeyBundle {
  id: string;
  user_id: string;
  device_id: string;
  device_label: string | null;
  identity_key: string;
  signed_pre_key: string;
  signed_pre_key_signature: string;
  signed_pre_key_id: number;
  created_at: string;
  updated_at: string;
}

/** E2E one-time pre-key (consumed on first message to a device) */
export interface E2EOneTimePreKey {
  key_id: number;
  public_key: string;
}

/** Key bundle returned when fetching a user's keys (includes one consumed OTP key per device) */
export interface E2EKeyBundleResponse {
  device_id: string;
  device_label: string | null;
  identity_key: string;
  signed_pre_key: string;
  signed_pre_key_signature: string;
  signed_pre_key_id: number;
  one_time_pre_key: E2EOneTimePreKey | null;
}

/** Max one-time pre-keys per upload batch */
export const E2E_MAX_OTP_KEYS_PER_UPLOAD = 100;

/** Max devices per user */
export const E2E_MAX_DEVICES_PER_USER = 5;

/** Max encrypted content length (base64 ciphertext) */
export const E2E_MAX_ENCRYPTED_CONTENT_LENGTH = 32000;
