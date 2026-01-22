// ErrorResponse import removed as it's not used
import {
  HttpClient,
  Transport,
  RequestOptions,
  ResponseParser,
} from './http-types';
import { combineSignals, createTimeoutSignal } from './signal-utils';

// Custom error class for HTTP errors
export class HTTPError extends Error {
  name = 'HTTPError' as const;

  constructor(
    public status: number,
    public statusText: string,
    public url: string,
    public headers: Headers,
    public bodyText?: string, // cap at ~64KB
  ) {
    super(`HTTP ${status} ${statusText}`);
  }

  toJSON(): {
    status: number;
    statusText: string;
    url: string;
    headers: Record<string, string>;
    bodyText?: string;
  } {
    return {
      status: this.status,
      statusText: this.statusText,
      url: this.url,
      headers: headersToRecord(this.headers),
      bodyText: this.bodyText,
    };
  }
}

// Helper function to convert Headers to Record
function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

// Web Standards HTTP client implementation
export class WebHttpClient implements HttpClient {
  // Cache for concurrent refresh token calls to prevent race conditions
  private refreshTokenPromise: Promise<string> | null = null;
  // Track request start time for timeout calculation on retries
  private requestStartTime: number | null = null;
  
  constructor(private transport: Transport) {}

  async get<T>(path: string, init?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...init, method: 'GET' });
  }

  async post<T>(
    path: string,
    body?: unknown,
    init?: RequestOptions,
  ): Promise<T> {
    return this.request<T>(path, {
      ...init,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
  }

  async put<T>(
    path: string,
    body?: unknown,
    init?: RequestOptions,
  ): Promise<T> {
    return this.request<T>(path, {
      ...init,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
  }

  async delete<T>(path: string, init?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...init, method: 'DELETE' });
  }

  async patch<T>(
    path: string,
    body?: unknown,
    init?: RequestOptions,
  ): Promise<T> {
    return this.request<T>(path, {
      ...init,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
  }

  async head(
    path: string,
    init?: RequestOptions,
  ): Promise<{ headers: Record<string, string>; status: number }> {
    const response = await this.makeRequest<Response>(path, {
      ...init,
      method: 'HEAD',
      parse: 'response',
    });
    return {
      headers: headersToRecord(response.headers),
      status: response.status,
    };
  }

  async request<T>(path: string, init?: RequestOptions): Promise<T> {
    return this.makeRequest<T>(path, init);
  }

  private async makeRequest<T>(
    path: string,
    init?: RequestOptions,
    retryCount = 0,
  ): Promise<T> {
    // Maximum retry attempts to prevent infinite loops
    const MAX_RETRY_ATTEMPTS = 1;
    const url = this.buildUrl(path);
    
    // Track request start time for timeout calculation (only on first attempt)
    if (retryCount === 0) {
      this.requestStartTime = Date.now();
    }
    // Note: Tauri proxy script now handles AbortSignal, so we can use full RequestInit
    // Removed Tauri-specific minimal path - proxy script handles AbortSignal properly
    const signal = this.createAbortSignal(init);
    const headers = await this.buildHeaders(init?.headers);
    let headersObj: Record<string, string>;
    if (headers instanceof Headers) {
      headersObj = {};
      headers.forEach((value, key) => {
        headersObj[key] = value;
      });
    } else {
      headersObj = headers;
    }
    
    const requestInit: RequestInit = {
      method: init?.method || 'GET',
      headers: headersObj,
    };
    
    // Check if body is a stream (ReadableStream) that can't be reused
    // Note: Blob is reusable, so it's not included here
    const isStreamBody = init?.body instanceof ReadableStream ||
                        (typeof init?.body === 'object' && init?.body !== null && 'getReader' in init.body && !(init.body instanceof Blob));
    
    if (init?.body !== undefined && !isStreamBody) {
      requestInit.body = init.body;
    } else if (init?.body !== undefined && isStreamBody && retryCount === 0) {
      // Only include stream body on first attempt - can't retry with streams
      requestInit.body = init.body;
    }
    
    // For retries, calculate remaining timeout to prevent timeout reset
    // Track elapsed time and use remaining timeout for retry
    let retrySignal: AbortSignal | undefined;
    if (retryCount > 0 && this.requestStartTime !== null) {
      const elapsed = Date.now() - this.requestStartTime;
      const timeoutMs = init?.timeoutMs || this.transport.timeoutMs;
      if (timeoutMs) {
        const remaining = Math.max(0, timeoutMs - elapsed);
        // Create signal with remaining timeout, preserving user's signal
        retrySignal = this.createAbortSignal({ ...init, timeoutMs: remaining });
      } else {
        // No timeout, just preserve user's signal
        retrySignal = this.createAbortSignal(init);
      }
    } else {
      retrySignal = signal;
    }
    
    if (retrySignal) {
      requestInit.signal = retrySignal;
    }
    
    if (this.transport.credentials !== undefined) {
      requestInit.credentials = this.transport.credentials;
    }
    
    if (init?.mode !== undefined) {
      requestInit.mode = init.mode;
    }
    if (init?.cache !== undefined) {
      requestInit.cache = init.cache;
    }
    if (init?.redirect !== undefined) {
      requestInit.redirect = init.redirect;
    }
    if (init?.referrer !== undefined) {
      requestInit.referrer = init.referrer;
    }
    if (init?.referrerPolicy !== undefined) {
      requestInit.referrerPolicy = init.referrerPolicy;
    }
    if (init?.integrity !== undefined) {
      requestInit.integrity = init.integrity;
    }
    if (init?.keepalive !== undefined) {
      requestInit.keepalive = init.keepalive;
    }

    try {
      const response = await this.transport.fetch(url, requestInit);

      if (!response.ok) {
        const bodyText = await this.getBodyText(response);
        const httpError = new HTTPError(
          response.status,
          response.statusText,
          url,
          response.headers,
          bodyText,
        );

        // Handle 401 with token_expired - attempt automatic token refresh
        // Don't retry if user aborted the request
        const userAborted = init?.signal?.aborted === true;
        if (
          response.status === 401 &&
          this.transport.refreshToken &&
          response.headers.get('x-auth-error') === 'token_expired' &&
          retryCount < MAX_RETRY_ATTEMPTS &&
          !isStreamBody && // Can't retry with stream bodies
          !userAborted // Don't retry if user aborted
        ) {
          try {
            // Use cached refresh promise if one is in progress (prevents race conditions)
            let refreshPromise = this.refreshTokenPromise;
            if (!refreshPromise) {
              refreshPromise = this.transport.refreshToken();
              this.refreshTokenPromise = refreshPromise;
            }
            
            // Attempt to refresh the token
            const newToken = await refreshPromise;
            
            // Clear the cache after refresh completes
            this.refreshTokenPromise = null;
            
            // Validate token - must be non-empty
            if (!newToken || newToken.trim() === '') {
              throw new Error('Refresh token returned empty token');
            }
            
            // onTokenRefresh is required when refreshToken is provided
            // Without it, the new token cannot be stored and getAuthToken() will return the old token
            if (!this.transport.onTokenRefresh) {
              throw new Error(
                'onTokenRefresh callback is required when refreshToken is provided. ' +
                'The callback must update the token storage so getAuthToken() returns the new token.'
              );
            }
            
            // Update token via callback
            // If this throws, it's an onTokenRefresh error (not a refreshToken error)
            // We'll catch it separately to preserve it
            try {
              await this.transport.onTokenRefresh(newToken);
            } catch (onTokenRefreshError) {
              // Errors from onTokenRefresh callback should be preserved (don't mask as 401)
              // This helps developers debug token storage issues
              throw onTokenRefreshError;
            }
            
            // Retry the request with the new token (increment retry count)
            // Preserve user's abort signal in retry
            return this.makeRequest<T>(path, init, retryCount + 1);
          } catch (refreshError) {
            // Clear the cache on error
            this.refreshTokenPromise = null;
            // Configuration errors (missing onTokenRefresh) should be thrown as-is
            if (refreshError instanceof Error && refreshError.message.includes('onTokenRefresh')) {
              throw refreshError;
            }
            // Errors from onTokenRefresh callback are already thrown above, so if we get here,
            // it's either a refreshToken() failure or empty token - throw original 401
            // This matches the PR description: "If refresh fails, throws the original 401 error"
            throw httpError;
          }
        }

        throw httpError;
      }

      return this.parseResponse<T>(response, init?.parse);
    } catch (error) {
      if (error instanceof HTTPError) {
        throw error;
      }
      // Preserve configuration errors (like missing onTokenRefresh)
      if (error instanceof Error && error.message.includes('onTokenRefresh')) {
        throw error;
      }
      throw new HTTPError(
        0,
        'Network Error',
        url,
        new Headers(),
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  private buildUrl(path: string): string {
    // Handle absolute URLs
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }

    // Handle baseUrl with path
    const baseUrl = this.transport.baseUrl;
    if (path.startsWith('/')) {
      // If path starts with /, combine with baseUrl
      const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
      return `${base}${path}`;
    } else {
      // If path doesn't start with /, append to baseUrl
      const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
      return `${base}${path}`;
    }
  }

  private createAbortSignal(init?: RequestOptions): AbortSignal | undefined {
    const signals: AbortSignal[] = [];

    if (this.transport.defaultAbortSignal) {
      signals.push(this.transport.defaultAbortSignal);
    }

    if (init?.signal) {
      signals.push(init.signal);
    }

    const timeoutMs = init?.timeoutMs || this.transport.timeoutMs;
    if (timeoutMs) {
      signals.push(createTimeoutSignal(timeoutMs));
    }

    return signals.length > 0 ? combineSignals(signals) : undefined;
  }

  private async buildHeaders(
    initHeaders?: HeadersInit,
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      ...this.transport.defaultHeaders,
    };

    // Add auth token if available and not empty
    if (this.transport.getAuthToken) {
      try {
        const token = await this.transport.getAuthToken();
        if (token && token.trim() !== '') {
          headers.Authorization = `Bearer ${token}`;
        }
      } catch (error) {
        // Ignore auth token errors
      }
    }

    // Add init headers
    if (initHeaders) {
      if (initHeaders instanceof Headers) {
        initHeaders.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(initHeaders)) {
        initHeaders.forEach(([key, value]) => {
          headers[key] = value;
        });
      } else {
        Object.assign(headers, initHeaders);
      }
    }

    return headers;
  }

  private async parseResponse<T>(
    response: Response,
    parse?: ResponseParser,
  ): Promise<T> {
    switch (parse) {
      case 'text':
        return (await response.text()) as T;
      case 'blob':
        return (await response.blob()) as T;
      case 'arrayBuffer':
        return (await response.arrayBuffer()) as T;
      case 'response':
        return response as T;
      case 'json':
      default:
        return await response.json();
    }
  }

  private async getBodyText(response: Response): Promise<string> {
    try {
      const text = await response.text();
      return text.length > 65536 ? text.slice(0, 65536) + '...' : text;
    } catch {
      return '';
    }
  }
}
