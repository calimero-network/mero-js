import { Transport, HttpClient } from './types';
export declare function createHttpClient(transport: Transport): HttpClient;
export declare function createBrowserHttpClient(options: {
  baseUrl: string;
  getAuthToken?: () => Promise<string | undefined>;
  onTokenRefresh?: (newToken: string) => Promise<void>;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
  credentials?: RequestCredentials;
  defaultAbortSignal?: AbortSignal;
}): HttpClient;
export declare function createNodeHttpClient(options: {
  baseUrl: string;
  fetch?: typeof fetch;
  getAuthToken?: () => Promise<string | undefined>;
  onTokenRefresh?: (newToken: string) => Promise<void>;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
  credentials?: RequestCredentials;
  defaultAbortSignal?: AbortSignal;
}): HttpClient;
export declare function createUniversalHttpClient(options: {
  baseUrl: string;
  fetch?: typeof fetch;
  getAuthToken?: () => Promise<string | undefined>;
  onTokenRefresh?: (newToken: string) => Promise<void>;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
  credentials?: RequestCredentials;
  defaultAbortSignal?: AbortSignal;
}): HttpClient;
//# sourceMappingURL=factory.d.ts.map
