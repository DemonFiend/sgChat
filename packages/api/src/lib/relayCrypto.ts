/**
 * Relay Crypto Utilities
 *
 * ECDH P-256 key exchange and HMAC authentication for relay↔Master communication.
 * Used during relay pairing and for authenticating internal relay API calls.
 */

import { createHmac, createHash, randomBytes } from 'crypto';

/**
 * Generate an ECDH P-256 key pair for a relay pairing session.
 * Returns base64-encoded public key and JWK private key.
 */
export async function generateECDHKeyPair(): Promise<{
  publicKey: string;
  privateKeyJwk: string;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );

  const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

  return {
    publicKey: Buffer.from(publicKeyRaw).toString('base64'),
    privateKeyJwk: JSON.stringify(privateKeyJwk),
  };
}

/**
 * Derive an ECDH shared secret from our private key and the relay's public key.
 * Returns hex-encoded 256-bit shared secret.
 */
export async function deriveSharedSecret(
  privateKeyJwk: string,
  theirPublicKeyBase64: string,
): Promise<string> {
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    JSON.parse(privateKeyJwk),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );

  const theirPublicKeyRaw = Buffer.from(theirPublicKeyBase64, 'base64');
  const theirPublicKey = await crypto.subtle.importKey(
    'raw',
    theirPublicKeyRaw,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: theirPublicKey },
    privateKey,
    256,
  );

  return Buffer.from(sharedBits).toString('hex');
}

/**
 * Generate a one-time pairing token containing relay metadata.
 * Returns { token: base64-encoded string, hash: SHA-256 hash for DB storage }.
 */
export function generatePairingToken(data: {
  relay_id: string;
  name: string;
  region: string;
  master_url: string;
  master_public_key: string;
  expires_at: string;
}): { token: string; hash: string; secret: string } {
  const secret = randomBytes(32).toString('hex');

  const payload = {
    relay_id: data.relay_id,
    name: data.name,
    region: data.region,
    master_url: data.master_url,
    master_public_key: data.master_public_key,
    pairing_secret: secret,
    expires_at: data.expires_at,
  };

  const token = Buffer.from(JSON.stringify(payload)).toString('base64');
  const hash = createHash('sha256').update(token).digest('hex');

  return { token, hash, secret };
}

/**
 * Hash a pairing token for comparison with stored hash.
 */
export function hashPairingToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Sign a payload with HMAC-SHA256 using a shared secret.
 */
export function signPayload(payload: string, sharedSecretHex: string): string {
  return createHmac('sha256', Buffer.from(sharedSecretHex, 'hex'))
    .update(payload)
    .digest('hex');
}

/**
 * Verify an HMAC-SHA256 signature (constant-time comparison).
 */
export function verifyHmacSignature(
  payload: string,
  signature: string,
  sharedSecretHex: string,
): boolean {
  const expected = signPayload(payload, sharedSecretHex);
  if (expected.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Encrypt a string using AES-256-GCM with the provided key (hex-encoded).
 * Returns a colon-delimited string: iv:ciphertext:tag (all base64).
 */
export async function encryptWithKey(plaintext: string, keyHex: string): Promise<string> {
  const keyBytes = Buffer.from(keyHex, 'hex');
  // Use first 32 bytes of shared secret as AES key
  const aesKeyBytes = keyBytes.slice(0, 32);
  const key = await crypto.subtle.importKey('raw', aesKeyBytes, { name: 'AES-GCM' }, false, [
    'encrypt',
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));

  return `${Buffer.from(iv).toString('base64')}:${Buffer.from(ct).toString('base64')}`;
}

/**
 * Decrypt a string encrypted with encryptWithKey.
 */
export async function decryptWithKey(encrypted: string, keyHex: string): Promise<string> {
  const [ivB64, ctB64] = encrypted.split(':');
  const keyBytes = Buffer.from(keyHex, 'hex');
  const aesKeyBytes = keyBytes.slice(0, 32);
  const key = await crypto.subtle.importKey('raw', aesKeyBytes, { name: 'AES-GCM' }, false, [
    'decrypt',
  ]);
  const iv = Buffer.from(ivB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(decrypted);
}

/**
 * Generate a trust certificate — a signed attestation that Master trusts this relay.
 */
export function generateTrustCertificate(data: {
  relay_id: string;
  name: string;
  region: string;
  issued_at: string;
  relay_public_key: string;
}, signingSecret: string): string {
  const payload = JSON.stringify(data);
  const signature = createHmac('sha256', signingSecret).update(payload).digest('hex');
  return Buffer.from(JSON.stringify({ payload: data, signature })).toString('base64');
}
