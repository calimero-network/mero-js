import { ResponseData, ErrorResponse } from '../types/api-response';
import { HttpClient, Transport, RequestOptions, ResponseParser } from './types';
import { combineSignals, createTimeoutSignal } from './signal-utils';

// Custom error class for HTTP errors
export class HTTPError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body?: string,
    public headers?: Headers,
  ) {
    super(`HTTP ${status} ${statusText}`);
    this.name = 'HTTPError';
  }
}

// Generic error response
const GENERIC_ERROR: ErrorResponse = {
  code: 500,
  message: 'Something went wrong',
};

// Helper function to safely extract text from response
async function safeText(res: Response): Promise<string | undefined> {
  try {
    return await res.text();
  } catch {
    return undefined;
  }
}

// Helper function to safely extract JSON from response
async function safeJson<T>(res: Response): Promise<T | undefined> {
  try {
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

// Helper function to convert Headers to Record<string, string>
function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

export class WebHttpClient implements HttpClient {
  private transport: Transport;
  private isRefreshing = false;
  private refreshPromise: Promise<void> | null = null;
  private failedQueue: Array<{
    resolve: (value: ResponseData<any>) => void;
    reject: (reason: Error) => void;
    path: string;
    init: RequestInit;
  }> = [];

  constructor(transport: Transport) {
    this.transport = {
      ...transport,
      baseUrl: transport.baseUrl.replace(/\/+$/, ''), // Remove trailing slashes
      timeoutMs: transport.timeoutMs ?? 30_000,
    };
  }

  private async makeRequest<T>(
    path: string,
    init: RequestOptions = {},
  ): Promise<ResponseData<T>> {
    // Use URL constructor for proper URL handling
    const url = new URL(path, this.transport.baseUrl).toString();

    // Merge headers using Headers API for proper case-insensitive handling
    const headers = new Headers(this.transport.defaultHeaders);
    if (init.headers) {
      new Headers(init.headers).forEach((v, k) => headers.set(k, v));
    }

    // Only add auth if caller didn't set it (case-insensitive check)
    if (this.transport.getAuthToken && !headers.has('authorization')) {
      try {
        const token = await this.transport.getAuthToken();
        if (token) {
          headers.set('authorization', `Bearer ${token}`);
        }
      } catch (error) {
        // If token retrieval fails, continue without auth
        console.warn('Failed to get auth token:', error);
      }
    }

    // Handle AbortSignal - combine user signal, default signal, and timeout
    const userSignal = init.signal || undefined; // Convert null to undefined
    const defaultSignal = this.transport.defaultAbortSignal;
    const timeoutMs = init.timeoutMs ?? this.transport.timeoutMs;

    // Create timeout signal
    const timeoutSignal = timeoutMs
      ? createTimeoutSignal(timeoutMs)
      : undefined;

    // Combine all signals
    const combinedSignal = combineSignals([
      defaultSignal,
      userSignal,
      timeoutSignal,
    ]);

    try {
      const response = await this.transport.fetch(url, {
        ...init,
        headers,
        signal: combinedSignal,
        credentials:
          init.credentials ?? this.transport.credentials,
      });

      // No need to clear timeout - AbortSignal handles cleanup

      // Handle HTTP errors by throwing HTTPError (for retry compatibility)
      if (!response.ok) {
        const text = await safeText(response);
        const authError = response.headers.get('x-auth-error');

        // Handle 401 errors with specific auth error types
        if (response.status === 401) {
          switch (authError) {
            case 'missing_token':
              throw new HTTPError(
                response.status,
                response.statusText,
                text,
                response.headers,
              );
            case 'token_expired':
              // Attempt token refresh
              try {
                return await this.handleTokenRefresh(path, init);
              } catch (refreshError) {
                throw new HTTPError(
                  response.status,
                  response.statusText,
                  text,
                  response.headers,
                );
              }
            case 'token_revoked':
              throw new HTTPError(
                response.status,
                response.statusText,
                text,
                response.headers,
              );
            case 'invalid_token':
              throw new HTTPError(
                response.status,
                response.statusText,
                text,
                response.headers,
              );
            default:
              throw new HTTPError(
                response.status,
                response.statusText,
                text,
                response.headers,
              );
          }
        }

        // Handle other HTTP errors by throwing HTTPError
        throw new HTTPError(
          response.status,
          response.statusText,
          text,
          response.headers,
        );
      }

      // Handle successful responses with enhanced parsing
      const parseMode = init.parse || this.detectParseMode(response);
      const data = await this.parseResponse<T>(response, parseMode);

      return {
        data,
        error: null,
      };
    } catch (error) {
      // No need to clear timeout - AbortSignal handles cleanup

      if (error instanceof HTTPError) {
        // Convert HTTPError back to ResponseData format for public API
        return {
          data: null,
          error: {
            code: error.status,
            message: error.message,
          },
        };
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return {
            data: null,
            error: {
              code: 408,
              message: 'Request timeout',
            },
          };
        }

        return {
          data: null,
          error: {
            code: 500,
            message: error.message || 'Network error',
          },
        };
      }

      return {
        data: null,
        error: GENERIC_ERROR,
      };
    }
  }

  private detectParseMode(response: Response): ResponseParser {
    const contentType =
      response.headers.get('content-type')?.toLowerCase() || '';

    if (contentType.includes('application/json')) {
      return 'json';
    }
    if (contentType.includes('text/')) {
      return 'text';
    }
    if (
      contentType.includes('application/octet-stream') ||
      contentType.includes('image/') ||
      contentType.includes('video/') ||
      contentType.includes('audio/')
    ) {
      return 'arrayBuffer';
    }

    // Default to JSON for most APIs
    return 'json';
  }

  private async parseResponse<T>(
    response: Response,
    parseMode: ResponseParser,
  ): Promise<T> {
    switch (parseMode) {
      case 'json':
        try {
          return (await response.json()) as T;
        } catch (error) {
          throw new Error(
            `Failed to parse JSON response: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      case 'text':
        return (await response.text()) as T;
      case 'blob':
        return (await response.blob()) as T;
      case 'arrayBuffer':
        return (await response.arrayBuffer()) as T;
      case 'response':
        return response as T;
      default:
        // Fallback to JSON with error handling
        try {
          return (await response.json()) as T;
        } catch {
          return (await response.text()) as T;
        }
    }
  }

  private async handleTokenRefresh<T>(
    path: string,
    init: RequestOptions,
  ): Promise<ResponseData<T>> {
    // If refresh is already in progress, wait for it and retry
    if (this.refreshPromise) {
      try {
        await this.refreshPromise;
        // Retry the original request after refresh completes
        return this.makeRequest<T>(path, init);
      } catch (error) {
        throw error;
      }
    }

    // If refresh is already in progress, queue this request
    if (this.isRefreshing) {
      return new Promise((resolve, reject) => {
        this.failedQueue.push({
          resolve,
          reject,
          path,
          init,
        });
      });
    }

    try {
      this.isRefreshing = true;

      // Create shared refresh promise
      this.refreshPromise = this.performTokenRefresh();

      // Wait for refresh to complete
      await this.refreshPromise;

      // Process queued requests only after successful refresh
      this.processQueue(null);

      // Retry original request
      return this.makeRequest<T>(path, init);
    } catch (error) {
      this.isRefreshing = false;
      this.refreshPromise = null;
      this.processQueue(error as Error);
      throw error;
    } finally {
      this.isRefreshing = false;
      this.refreshPromise = null;
    }
  }

  private async performTokenRefresh(): Promise<void> {
    // Get current tokens
    const currentToken = await this.transport.getAuthToken?.();
    if (!currentToken) {
      throw new Error('No current token available for refresh');
    }

    // Attempt to refresh token
    // Note: This is a simplified approach. In a real implementation,
    // you'd need to implement the actual token refresh logic
    // or inject an auth client that handles this

    // For now, we'll just simulate a successful refresh
    // In a full implementation, you'd call your auth service here
    // and update the token via onTokenRefresh callback
    
    // Simulate refresh delay
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  private processQueue(error: Error | null) {
    this.failedQueue.forEach(({ resolve, reject, path, init }) => {
      if (error) {
        reject(error);
      } else {
        // Retry the request
        this.makeRequest(path, init).then(resolve).catch(reject);
      }
    });
    this.failedQueue = [];
  }

  // HTTP method implementations
  async get<T>(
    path: string,
    init: RequestOptions = {},
  ): Promise<ResponseData<T>> {
    return this.makeRequest<T>(path, { ...init, method: 'GET' });
  }

  async post<T>(
    path: string,
    body?: unknown,
    init: RequestOptions = {},
  ): Promise<ResponseData<T>> {
    // Don't set Content-Type for FormData - let the browser handle it
    const headers =
      body instanceof FormData
        ? { ...(init.headers ?? {}) }
        : {
            'Content-Type': 'application/json',
            ...(init.headers ?? {}),
          };

    return this.makeRequest<T>(path, {
      ...init,
      method: 'POST',
      headers,
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });
  }

  async put<T>(
    path: string,
    body?: unknown,
    init: RequestOptions = {},
  ): Promise<ResponseData<T>> {
    const headers =
      body instanceof FormData
        ? { ...(init.headers ?? {}) }
        : {
            'Content-Type': 'application/json',
            ...(init.headers ?? {}),
          };

    return this.makeRequest<T>(path, {
      ...init,
      method: 'PUT',
      headers,
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });
  }

  async delete<T>(
    path: string,
    init: RequestOptions = {},
  ): Promise<ResponseData<T>> {
    return this.makeRequest<T>(path, { ...init, method: 'DELETE' });
  }

  async patch<T>(
    path: string,
    body?: unknown,
    init: RequestOptions = {},
  ): Promise<ResponseData<T>> {
    const headers =
      body instanceof FormData
        ? { ...(init.headers ?? {}) }
        : {
            'Content-Type': 'application/json',
            ...(init.headers ?? {}),
          };

    return this.makeRequest<T>(path, {
      ...init,
      method: 'PATCH',
      headers,
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });
  }

  async head<T>(
    path: string,
    init: RequestOptions = {},
  ): Promise<ResponseData<T>> {
    const res = await this.makeRequest(path, { ...init, method: 'HEAD', parse: 'response' });
    if (res.error) return res;
    const r = res.data as Response;
    const hdrs: Record<string, string> = {};
    r.headers.forEach((v, k) => hdrs[k] = v);
    return { data: { headers: hdrs, status: r.status } as T, error: null };
  }

  // Generic request method (alias for the private makeRequest method)
  async request<T>(
    path: string,
    init: RequestOptions = {},
  ): Promise<ResponseData<T>> {
    return this.makeRequest<T>(path, init);
  }
}
