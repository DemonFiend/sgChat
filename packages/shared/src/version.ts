/**
 * Version utilities for client-server compatibility.
 */

/** Protocol version — only incremented for breaking gateway changes */
export const PROTOCOL_VERSION = 1;

/** Minimum client version accepted by the server (start permissive) */
export const MIN_CLIENT_VERSION = '0.0.0';

/**
 * Compare two semver strings. Returns -1, 0, or 1.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

/**
 * Check if a client version meets the minimum required version.
 */
export function isVersionCompatible(clientVersion: string, minRequired: string): boolean {
  return compareVersions(clientVersion, minRequired) >= 0;
}
