import { authStore } from '@/stores/auth';
import { networkStore, getEffectiveUrl } from '@/stores/network';
import { isEncryptedPayload, CRYPTO_EXEMPT_ENDPOINTS } from '@sgchat/shared';
import {
  ensureCryptoSession,
  encryptForTransport,
  decryptFromTransport,
  getCryptoSessionId,
  hasCryptoSession,
  clearCryptoSession,
} from '@/lib/transportCrypto';

type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions {
  method?: RequestMethod;
  body?: unknown;
  headers?: Record<string, string>;
  baseUrl?: string;
}

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function getApiUrl(baseUrl?: string): string {
  if (baseUrl) return getEffectiveUrl(baseUrl);
  const currentUrl = networkStore.currentUrl();
  return getEffectiveUrl(currentUrl);
}

function isExemptEndpoint(endpoint: string): boolean {
  return CRYPTO_EXEMPT_ENDPOINTS.some(
    (exempt) => endpoint === exempt || endpoint.startsWith(exempt + '/'),
  );
}

/** Decrypt a response body if it is encrypted, otherwise return as-is */
async function maybeDecryptResponse(data: unknown): Promise<unknown> {
  if (isEncryptedPayload(data)) {
    try {
      const plaintext = await decryptFromTransport(data);
      return JSON.parse(plaintext);
    } catch {
      // If decryption fails, return raw data
      return data;
    }
  }
  return data;
}

/** Prepare request body — encrypt if crypto session is active */
async function prepareBody(
  body: unknown | undefined,
  isExempt: boolean,
): Promise<string | undefined> {
  if (body === undefined) return undefined;

  if (!isExempt && hasCryptoSession()) {
    try {
      const encrypted = await encryptForTransport(JSON.stringify(body));
      return JSON.stringify(encrypted);
    } catch {
      // Fallback to unencrypted
    }
  }

  return JSON.stringify(body);
}

async function request<T>(
  endpoint: string,
  options: RequestOptions = {},
  _retryCount = 0,
): Promise<T> {
  const { method = 'GET', body, headers = {}, baseUrl } = options;
  const apiUrl = getApiUrl(baseUrl);
  if (!apiUrl) throw new ApiError('No network selected', 0);

  if (authStore.authError()) throw new ApiError('Session expired', 401);

  const isExempt = isExemptEndpoint(endpoint);

  // Ensure crypto session (skip for exempt endpoints)
  if (!isExempt) {
    try {
      await ensureCryptoSession(apiUrl);
    } catch {
      // Key exchange failed — fall back to unencrypted
    }
  }

  let token = authStore.getAccessToken();
  if (!token && authStore.state().isAuthenticated) {
    try {
      token = await authStore.refreshAccessToken();
    } catch {
      throw new ApiError('Session expired', 401);
    }
  }

  const requestHeaders: Record<string, string> = { ...headers };
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  if (token) requestHeaders['Authorization'] = `Bearer ${token}`;

  // Add crypto session header
  const cryptoSession = getCryptoSessionId();
  if (cryptoSession && !isExempt) {
    requestHeaders['X-Crypto-Session'] = cryptoSession;
  }

  const finalBody = await prepareBody(body, isExempt);

  const response = await fetch(`${apiUrl}${endpoint}`, {
    method,
    headers: requestHeaders,
    credentials: 'include',
    body: finalBody,
  });

  // Handle crypto session expiry — re-negotiate once
  if (response.status === 401) {
    const errorBody = await response.json().catch(() => ({}));
    if ((errorBody as any).code === 'CRYPTO_SESSION_EXPIRED' && _retryCount === 0) {
      clearCryptoSession();
      return request<T>(endpoint, options, 1);
    }

    // Normal 401 — try token refresh
    if (token) {
      if (authStore.authError()) throw new ApiError('Session expired', 401);
      try {
        const newToken = await authStore.refreshAccessToken();
        requestHeaders['Authorization'] = `Bearer ${newToken}`;
        const retryResponse = await fetch(`${apiUrl}${endpoint}`, {
          method,
          headers: requestHeaders,
          credentials: 'include',
          body: finalBody,
        });
        if (!retryResponse.ok) {
          const error = await retryResponse.json().catch(() => ({}));
          throw new ApiError(
            (error as any).message || 'Request failed',
            retryResponse.status,
            error,
          );
        }
        const retryData = await retryResponse.json();
        return (await maybeDecryptResponse(retryData)) as T;
      } catch {
        throw new ApiError('Session expired', 401);
      }
    }

    throw new ApiError(
      (errorBody as any).message || 'Unauthorized',
      401,
      errorBody,
    );
  }

  if (response.status === 304) return null as T;
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ApiError((error as any).message || 'Request failed', response.status, error);
  }
  if (response.status === 204) return {} as T;

  const responseData = await response.json();
  return (await maybeDecryptResponse(responseData)) as T;
}

async function uploadFile<T>(
  endpoint: string,
  file: File,
  fieldName: string = 'file',
): Promise<T> {
  const apiUrl = getApiUrl();
  if (!apiUrl) throw new ApiError('No network selected', 0);
  if (authStore.authError()) throw new ApiError('Session expired', 401);

  let token = authStore.getAccessToken();
  if (!token && authStore.state().isAuthenticated) {
    try {
      token = await authStore.refreshAccessToken();
    } catch {
      throw new ApiError('Session expired', 401);
    }
  }

  const formData = new FormData();
  formData.append(fieldName, file);

  const requestHeaders: Record<string, string> = {};
  if (token) requestHeaders['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${apiUrl}${endpoint}`, {
    method: 'POST',
    headers: requestHeaders,
    credentials: 'include',
    body: formData,
  });

  if (response.status === 401 && token) {
    if (authStore.authError()) throw new ApiError('Session expired', 401);
    try {
      const newToken = await authStore.refreshAccessToken();
      requestHeaders['Authorization'] = `Bearer ${newToken}`;
      const retryResponse = await fetch(`${apiUrl}${endpoint}`, {
        method: 'POST',
        headers: requestHeaders,
        credentials: 'include',
        body: formData,
      });
      if (!retryResponse.ok) {
        const error = await retryResponse.json().catch(() => ({}));
        throw new ApiError(
          (error as any).message || 'Upload failed',
          retryResponse.status,
          error,
        );
      }
      return retryResponse.json();
    } catch {
      throw new ApiError('Session expired', 401);
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ApiError((error as any).message || 'Upload failed', response.status, error);
  }
  return response.json();
}

interface GetOptions {
  baseUrl?: string;
  headers?: Record<string, string>;
}

export const api = {
  get: <T>(endpoint: string, options?: string | GetOptions) => {
    if (typeof options === 'string')
      return request<T>(endpoint, { method: 'GET', baseUrl: options });
    return request<T>(endpoint, {
      method: 'GET',
      baseUrl: options?.baseUrl,
      headers: options?.headers,
    });
  },
  post: <T>(endpoint: string, body?: unknown, baseUrl?: string) =>
    request<T>(endpoint, { method: 'POST', body, baseUrl }),
  put: <T>(endpoint: string, body?: unknown, baseUrl?: string) =>
    request<T>(endpoint, { method: 'PUT', body, baseUrl }),
  patch: <T>(endpoint: string, body?: unknown, baseUrl?: string) =>
    request<T>(endpoint, { method: 'PATCH', body, baseUrl }),
  delete: <T>(endpoint: string, baseUrl?: string) =>
    request<T>(endpoint, { method: 'DELETE', baseUrl }),
  upload: <T>(endpoint: string, file: File, fieldName?: string) =>
    uploadFile<T>(endpoint, file, fieldName),
};

export { ApiError };
