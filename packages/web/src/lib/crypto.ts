/**
 * Credential encryption utilities using Web Crypto API
 * Uses AES-GCM for authenticated encryption
 * Includes client-side password hashing so plaintext passwords never appear in network requests
 */

const STORAGE_KEY = 'sgchat-encryption-key';
const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // Recommended for AES-GCM

/**
 * Hash a password client-side using SHA-256 before sending to the server.
 * This ensures the plaintext password never appears in network requests,
 * browser DevTools, or server logs. The server then applies argon2 on top
 * of this hash for storage.
 * 
 * Format: "sha256:<hex-encoded hash>" so the server can identify pre-hashed passwords.
 */
export async function hashPasswordForTransit(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${hashHex}`;
}

export interface EncryptedCredential {
  ciphertext: string; // Base64-encoded encrypted password
  iv: string; // Base64-encoded initialization vector
  version: number; // For future migration support
}

/**
 * Get or create the encryption key
 * Key is stored in localStorage and persists across sessions
 */
async function getEncryptionKey(): Promise<CryptoKey> {
  const storedKey = localStorage.getItem(STORAGE_KEY);

  if (storedKey) {
    try {
      const keyBuffer = Uint8Array.from(atob(storedKey), (c) => c.charCodeAt(0));
      return await crypto.subtle.importKey(
        'raw',
        keyBuffer,
        { name: ALGORITHM, length: KEY_LENGTH },
        true,
        ['encrypt', 'decrypt']
      );
    } catch {
      // Key corrupted, generate new one
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  // Generate new key
  const key = await crypto.subtle.generateKey(
    { name: ALGORITHM, length: KEY_LENGTH },
    true, // extractable for storage
    ['encrypt', 'decrypt']
  );

  // Store for future use
  const exportedKey = await crypto.subtle.exportKey('raw', key);
  const keyBase64 = btoa(String.fromCharCode(...new Uint8Array(exportedKey)));
  localStorage.setItem(STORAGE_KEY, keyBase64);

  return key;
}

/**
 * Encrypt a password for secure storage
 */
export async function encryptPassword(password: string): Promise<EncryptedCredential> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoder = new TextEncoder();

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoder.encode(password)
  );

  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    iv: btoa(String.fromCharCode(...new Uint8Array(iv))),
    version: 1,
  };
}

/**
 * Decrypt a stored password
 * Throws if decryption fails (corrupted data or wrong key)
 */
export async function decryptPassword(encrypted: EncryptedCredential): Promise<string> {
  const key = await getEncryptionKey();
  const ciphertext = Uint8Array.from(atob(encrypted.ciphertext), (c) => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(encrypted.iv), (c) => c.charCodeAt(0));

  const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext);

  return new TextDecoder().decode(decrypted);
}

/**
 * Clear the encryption key (invalidates all stored credentials)
 * Use with caution - all "Remember me" data becomes unreadable
 */
export function clearEncryptionKey(): void {
  localStorage.removeItem(STORAGE_KEY);
}
