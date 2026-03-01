import { authStore } from '@/stores/auth';
import { networkStore, getEffectiveUrl } from '@/stores/network';

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

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, baseUrl } = options;
  const apiUrl = getApiUrl(baseUrl);
  if (!apiUrl) throw new ApiError('No network selected', 0);

  if (authStore.authError()) throw new ApiError('Session expired', 401);

  let token = authStore.getAccessToken();
  if (!token && authStore.state().isAuthenticated) {
    try { token = await authStore.refreshAccessToken(); }
    catch { throw new ApiError('Session expired', 401); }
  }

  const requestHeaders: Record<string, string> = { ...headers };
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  if (token) requestHeaders['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${apiUrl}${endpoint}`, {
    method, headers: requestHeaders, credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 && token) {
    if (authStore.authError()) throw new ApiError('Session expired', 401);
    try {
      const newToken = await authStore.refreshAccessToken();
      requestHeaders['Authorization'] = `Bearer ${newToken}`;
      const retryResponse = await fetch(`${apiUrl}${endpoint}`, {
        method, headers: requestHeaders, credentials: 'include',
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!retryResponse.ok) {
        const error = await retryResponse.json().catch(() => ({}));
        throw new ApiError(error.message || 'Request failed', retryResponse.status, error);
      }
      return retryResponse.json();
    } catch { throw new ApiError('Session expired', 401); }
  }

  if (response.status === 304) return null as T;
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ApiError(error.message || 'Request failed', response.status, error);
  }
  if (response.status === 204) return {} as T;
  return response.json();
}

async function uploadFile<T>(endpoint: string, file: File, fieldName: string = 'file'): Promise<T> {
  const apiUrl = getApiUrl();
  if (!apiUrl) throw new ApiError('No network selected', 0);
  if (authStore.authError()) throw new ApiError('Session expired', 401);

  let token = authStore.getAccessToken();
  if (!token && authStore.state().isAuthenticated) {
    try { token = await authStore.refreshAccessToken(); }
    catch { throw new ApiError('Session expired', 401); }
  }

  const formData = new FormData();
  formData.append(fieldName, file);

  const requestHeaders: Record<string, string> = {};
  if (token) requestHeaders['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${apiUrl}${endpoint}`, {
    method: 'POST', headers: requestHeaders, credentials: 'include', body: formData,
  });

  if (response.status === 401 && token) {
    if (authStore.authError()) throw new ApiError('Session expired', 401);
    try {
      const newToken = await authStore.refreshAccessToken();
      requestHeaders['Authorization'] = `Bearer ${newToken}`;
      const retryResponse = await fetch(`${apiUrl}${endpoint}`, {
        method: 'POST', headers: requestHeaders, credentials: 'include', body: formData,
      });
      if (!retryResponse.ok) {
        const error = await retryResponse.json().catch(() => ({}));
        throw new ApiError(error.message || 'Upload failed', retryResponse.status, error);
      }
      return retryResponse.json();
    } catch { throw new ApiError('Session expired', 401); }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ApiError(error.message || 'Upload failed', response.status, error);
  }
  return response.json();
}

interface GetOptions {
  baseUrl?: string;
  headers?: Record<string, string>;
}

export const api = {
  get: <T>(endpoint: string, options?: string | GetOptions) => {
    if (typeof options === 'string') return request<T>(endpoint, { method: 'GET', baseUrl: options });
    return request<T>(endpoint, { method: 'GET', baseUrl: options?.baseUrl, headers: options?.headers });
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
