import { authStore } from '@/stores/auth';
import { networkStore, getEffectiveUrl } from '@/stores/network';

type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions {
  method?: RequestMethod;
  body?: unknown;
  headers?: Record<string, string>;
  // Allow overriding the base URL for specific requests (e.g., auth before network is set)
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
  // Priority: explicit baseUrl > current network > default /api
  if (baseUrl) return getEffectiveUrl(baseUrl);
  
  const currentUrl = networkStore.currentUrl();
  return getEffectiveUrl(currentUrl);
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, baseUrl } = options;

  const apiUrl = getApiUrl(baseUrl);
  if (!apiUrl) {
    throw new ApiError('No network selected', 0);
  }

  // Get access token, refresh if needed
  let token = authStore.getAccessToken();
  if (!token && authStore.state().isAuthenticated) {
    try {
      token = await authStore.refreshAccessToken();
    } catch {
      // Redirect to login handled by auth store
      throw new ApiError('Session expired', 401);
    }
  }

  const requestHeaders: Record<string, string> = {
    ...headers,
  };

  // Only set Content-Type for requests with a body
  if (body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  if (token) {
    requestHeaders['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${apiUrl}${endpoint}`, {
    method,
    headers: requestHeaders,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Handle 401 - try refresh once
  if (response.status === 401 && token) {
    try {
      const newToken = await authStore.refreshAccessToken();
      requestHeaders['Authorization'] = `Bearer ${newToken}`;
      
      const retryResponse = await fetch(`${apiUrl}${endpoint}`, {
        method,
        headers: requestHeaders,
        credentials: 'include',
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if (!retryResponse.ok) {
        const error = await retryResponse.json().catch(() => ({}));
        throw new ApiError(error.message || 'Request failed', retryResponse.status, error);
      }

      return retryResponse.json();
    } catch {
      // refreshAccessToken already triggers authError in the auth store,
      // so the SessionExpiredOverlay will appear automatically.
      throw new ApiError('Session expired', 401);
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ApiError(error.message || 'Request failed', response.status, error);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

/**
 * Upload a file using multipart/form-data
 */
async function uploadFile<T>(endpoint: string, file: File, fieldName: string = 'file'): Promise<T> {
  const apiUrl = getApiUrl();
  if (!apiUrl) {
    throw new ApiError('No network selected', 0);
  }

  // Get access token, refresh if needed
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
  if (token) {
    requestHeaders['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${apiUrl}${endpoint}`, {
    method: 'POST',
    headers: requestHeaders,
    credentials: 'include',
    body: formData,
  });

  // Handle 401 - try refresh once
  if (response.status === 401 && token) {
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
        throw new ApiError(error.message || 'Upload failed', retryResponse.status, error);
      }

      return retryResponse.json();
    } catch {
      throw new ApiError('Session expired', 401);
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ApiError(error.message || 'Upload failed', response.status, error);
  }

  return response.json();
}

// Convenience methods
export const api = {
  get: <T>(endpoint: string, baseUrl?: string) => 
    request<T>(endpoint, { method: 'GET', baseUrl }),
  
  post: <T>(endpoint: string, body?: unknown, baseUrl?: string) =>
    request<T>(endpoint, { method: 'POST', body, baseUrl }),
  
  put: <T>(endpoint: string, body?: unknown, baseUrl?: string) =>
    request<T>(endpoint, { method: 'PUT', body, baseUrl }),
  
  patch: <T>(endpoint: string, body?: unknown, baseUrl?: string) =>
    request<T>(endpoint, { method: 'PATCH', body, baseUrl }),
  
  delete: <T>(endpoint: string, baseUrl?: string) => 
    request<T>(endpoint, { method: 'DELETE', baseUrl }),

  /**
   * Upload a file using multipart/form-data
   */
  upload: <T>(endpoint: string, file: File, fieldName?: string) =>
    uploadFile<T>(endpoint, file, fieldName),
};

export { ApiError };
