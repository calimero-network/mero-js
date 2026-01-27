// Export admin API
export * as AdminApi from './admin';
export { AdminApiClient, createAdminApiClient } from './admin';

// Export auth API
export * as AuthApi from './auth';
export { AuthApiClient, createAuthApiClient } from './auth';

// Export RPC API (JSON-RPC for executing queries/mutations)
export * as RpcApi from './rpc';
export { RpcClient, JsonRpcError } from './rpc';
export type {
  ExecuteParams,
  ExecuteResult,
  ExecutionRequest,
  JsonRpcRequest,
  JsonRpcResponse,
} from './rpc';

// Export WebSocket client (real-time event subscriptions)
export * as WsApi from './ws';
export { WebSocketClient } from './ws';
export type {
  WebSocketClientOptions,
  WebSocketEvent,
  WebSocketRequest,
  WebSocketResponse,
} from './ws';

// Export SSE client (Server-Sent Events for real-time streaming)
export * as SseApi from './sse';
export { SseClient } from './sse';
export type {
  SseClientOptions,
  SseEvent,
  SseSubscriptionRequest,
  SseSubscriptionResponse,
} from './sse';

// Export shared utilities
export * from './utils';
