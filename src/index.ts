// Mero.js - Pure JavaScript SDK for Calimero
// This will contain the pure JavaScript SDK without React dependencies

// Main SDK class
export { MeroJs, createMeroJs, TokenReuseError } from './mero-js';
export type { MeroJsConfig, TokenData } from './mero-js';

// JWT claim helpers + token_type constants (read-only, signature NOT verified)
export {
  decodeJwtPayload,
  expiresAtFromJwt,
  tokenTypeFromJwt,
  permissionsFromJwt,
  isRefreshTokenInAccessSlot,
  ACCESS_TOKEN_TYPE,
  REFRESH_TOKEN_TYPE,
} from './jwt';

// Cross-tab refresh coordination (Web Locks with Node-safe fallback)
export { withRefreshLock, getLockManager } from './refresh-lock';

// HTTP client module (Web Standards based)
export * from './http-client';

// Auth API client
export * from './auth-api';

// Admin API client
export * from './admin-api';

// Auth utilities
export { parseAuthCallback, buildAuthLoginUrl } from './auth';
export type { AuthCallbackResult, AuthLoginOptions } from './auth';

// Token store
export { MemoryTokenStore, LocalStorageTokenStore } from './token-store';
export type { TokenStore } from './token-store';

// RPC client
export { RpcClient, RpcError } from './rpc';
export type { MigrateMyEntriesSummary } from './rpc';
export type { ExecuteParams } from './rpc';

// Events (SSE / WebSocket)
export { SseClient, WsClient } from './events';
export type { SseEventData, WsEventData, AppVersionChangedEvent } from './events';

// Cloud client (enable-HA, disable-HA)
export * from './cloud';

// Member capability bitmask constants & helpers
export * from './capabilities';

// Utilities
