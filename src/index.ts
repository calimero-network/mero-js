// Mero.js - Pure JavaScript SDK for Calimero
// This will contain the pure JavaScript SDK without React dependencies

// Main SDK class
export { MeroJs, createMeroJs } from './mero-js';
export type { MeroJsConfig, TokenData } from './mero-js';

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
export type { ExecuteParams } from './rpc';

// Events (SSE / WebSocket)
export { SseClient, WsClient } from './events';
export type { SseEventData, WsEventData } from './events';

// Utilities
