import { WebHttpClient } from './web-client';
import { Transport, HttpClient } from './http-types';

// Factory function to create HTTP client with sensible defaults
export function createHttpClient(transport: Transport): HttpClient {
  return new WebHttpClient(transport);
}

// Factory function for browser environments
export function createBrowserHttpClient(options: {
  baseUrl: string;
  getAuthToken?: () => Promise<string | undefined>;
  onTokenRefresh?: (newToken: string) => Promise<void>;
  /**
   * Callback to refresh the access token when a 401 error with 'token_expired' is detected.
   * Should return the new access token, or throw an error if refresh fails.
   * If provided, the client will automatically retry the request after a successful refresh.
   */
  refreshToken?: () => Promise<string>;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
  credentials?: RequestCredentials;
  defaultAbortSignal?: AbortSignal;
}): HttpClient {
  const transport: Transport = {
    // Wrap fetch in arrow function to prevent "Illegal invocation" error
    // This preserves the correct 'this' context when fetch is called
    fetch: (url: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(url, init),
    baseUrl: options.baseUrl,
    getAuthToken: options.getAuthToken,
    onTokenRefresh: options.onTokenRefresh,
    refreshToken: options.refreshToken,
    defaultHeaders: options.defaultHeaders,
    timeoutMs: options.timeoutMs,
    credentials: options.credentials, // No default credentials
    defaultAbortSignal: options.defaultAbortSignal,
  };

  return createHttpClient(transport);
}

// Factory function for Node.js environments
export function createNodeHttpClient(options: {
  baseUrl: string;
  fetch?: typeof fetch; // Allow injection of undici.fetch or other fetch implementations
  getAuthToken?: () => Promise<string | undefined>;
  onTokenRefresh?: (newToken: string) => Promise<void>;
  /**
   * Callback to refresh the access token when a 401 error with 'token_expired' is detected.
   * Should return the new access token, or throw an error if refresh fails.
   * If provided, the client will automatically retry the request after a successful refresh.
   */
  refreshToken?: () => Promise<string>;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
  credentials?: RequestCredentials;
  defaultAbortSignal?: AbortSignal;
}): HttpClient {
  // Use provided fetch or try to use global fetch (Node 18+)
  const fetchImpl = options.fetch ?? globalThis.fetch;

  if (!fetchImpl) {
    throw new Error(
      'No fetch implementation available. Please provide a fetch implementation ' +
        '(e.g., undici.fetch) or use Node.js 18+ which has native fetch support.',
    );
  }

  // Check if we're using the default globalThis.fetch to preserve context
  // When fetchImpl is globalThis.fetch, we must call it directly, not through a variable
  // Custom fetch implementations (like undici.fetch) can be called through the variable
  const isDefaultFetch = fetchImpl === globalThis.fetch;

  const transport: Transport = {
    // Wrap fetch in arrow function to prevent "Illegal invocation" error
    // For globalThis.fetch, call it directly to preserve 'this' context
    // For custom implementations, calling through the variable is safe
    fetch: isDefaultFetch
      ? (url: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(url, init)
      : (url: RequestInfo | URL, init?: RequestInit) => fetchImpl(url, init),
    baseUrl: options.baseUrl,
    getAuthToken: options.getAuthToken,
    onTokenRefresh: options.onTokenRefresh,
    refreshToken: options.refreshToken,
    defaultHeaders: options.defaultHeaders,
    timeoutMs: options.timeoutMs,
    credentials: options.credentials, // Node.js doesn't have default credentials
    defaultAbortSignal: options.defaultAbortSignal,
  };

  return createHttpClient(transport);
}

// Universal factory that works in both environments
export function createUniversalHttpClient(options: {
  baseUrl: string;
  fetch?: typeof fetch;
  getAuthToken?: () => Promise<string | undefined>;
  onTokenRefresh?: (newToken: string) => Promise<void>;
  /**
   * Callback to refresh the access token when a 401 error with 'token_expired' is detected.
   * Should return the new access token, or throw an error if refresh fails.
   * If provided, the client will automatically retry the request after a successful refresh.
   */
  refreshToken?: () => Promise<string>;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
  credentials?: RequestCredentials;
  defaultAbortSignal?: AbortSignal;
}): HttpClient {
  // Try to detect environment and use appropriate factory
  if (typeof window !== 'undefined') {
    // Browser environment
    return createBrowserHttpClient(options);
  } else {
    // Node.js environment
    return createNodeHttpClient(options);
  }
}
