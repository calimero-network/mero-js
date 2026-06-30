// HTTP client types and interfaces
export * from './http-types';
export * from './api-response';

// Auth error wire contract (token_expired / token_reuse classification)
export {
  AUTH_ERROR_HEADER,
  AUTH_ERROR_TOKEN_EXPIRED,
  AUTH_ERROR_TOKEN_REUSE,
  isRefreshReuseError,
} from './auth-errors';

// Web Standards HTTP client implementation
export { WebHttpClient, HTTPError } from './web-client';

// Factory functions for easy client creation
export {
  createHttpClient,
  createBrowserHttpClient,
  createNodeHttpClient,
  createUniversalHttpClient,
} from './http-factory';

// Retry functionality
export { withRetry, createRetryableMethod } from './retry';
export type { RetryOptions } from './retry';

// Signal utilities
export { combineSignals, createTimeoutSignal } from './signal-utils';
