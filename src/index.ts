// Mero.js - Pure JavaScript SDK for Calimero
// This will contain the pure JavaScript SDK without React dependencies

// Main SDK class
export { MeroJs, createMeroJs } from './mero-js';
export type { MeroJsConfig, TokenData, TokenStorage } from './mero-js';

// HTTP client module (Web Standards based)
export * from './http-client';

// API clients (clean implementation based on OpenAPI spec)
export * from './api';

// Re-export RPC types for convenience
export { RpcClient, JsonRpcError } from './api/rpc';
export type { ExecuteParams, ExecuteResult } from './api/rpc';

// Re-export SSE and WebSocket clients
export { SseClient } from './api/sse';
export type { SseEvent, SseClientOptions } from './api/sse';
export { WebSocketClient } from './api/ws';
export type { WebSocketEvent, WebSocketClientOptions } from './api/ws';
