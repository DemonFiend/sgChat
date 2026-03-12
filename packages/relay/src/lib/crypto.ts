import { createHmac } from 'crypto';

/**
 * Generate an ECDH P-256 key pair.
 * Returns base64-encoded public and private keys.
 */
export async function generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );

  const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

  return {
    publicKey: Buffer.from(publicKeyRaw).toString('base64'),
    privateKey: JSON.stringify(privateKeyJwk),
  };
}

/**
 * Derive a shared secret from our private key and their public key.
 * Returns hex-encoded shared secret.
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
 * Sign a request payload with HMAC-SHA256 using the shared secret.
 */
export function signPayload(payload: string, sharedSecretHex: string): string {
  return createHmac('sha256', Buffer.from(sharedSecretHex, 'hex'))
    .update(payload)
    .digest('hex');
}

/**
 * Verify an HMAC-SHA256 signature.
 */
export function verifySignature(
  payload: string,
  signature: string,
  sharedSecretHex: string,
): boolean {
  const expected = signPayload(payload, sharedSecretHex);
  if (expected.length !== signature.length) return false;
  // Constant-time comparison
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}
