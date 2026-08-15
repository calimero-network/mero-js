// Mero.js - Pure JavaScript SDK for Calimero
// This will contain the pure JavaScript SDK without React dependencies

// Main SDK class
export { MeroJs, createMeroJs } from './mero-js.js';
export type { MeroJsConfig, TokenData } from './mero-js.js';

// HTTP client module (Web Standards based)
export * from './http-client/index.js';

// Auth API client
export * from './auth-api/index.js';

// Admin API client
export * from './admin-api/index.js';

// Auth utilities
export { parseAuthCallback, buildAuthLoginUrl } from './auth/index.js';
export type { AuthCallbackResult, AuthLoginOptions } from './auth/index.js';

// Token store
export { MemoryTokenStore, LocalStorageTokenStore } from './token-store/index.js';
export type { TokenStore } from './token-store/index.js';

// RPC client
export { RpcClient, RpcError } from './rpc/index.js';
export type { MigrateMyEntriesSummary } from './rpc/index.js';
export type { ExecuteParams } from './rpc/index.js';

// Events (SSE / WebSocket)
export { SseClient, WsClient } from './events/index.js';
export type {
  SseEventData,
  WsEventData,
  AppVersionChangedEvent,
  GroupMembershipEventData,
  GroupMigrationEventData,
  MigrationStartedData,
  MigrationProgressData,
  CascadeProgressData,
  MigrationCompletedData,
} from './events/index.js';

// Ephemeral presence (cursors / typing / online)
export { EphemeralClient, jsonCodec } from './ephemeral/index.js';
export type { Codec, EphemeralEntry } from './ephemeral/index.js';

// Cloud client (enable-HA, disable-HA)
export * from './cloud/index.js';

// Member capability bitmask constants & helpers
export * from './capabilities.js';

// Utilities
export {
  DEFAULT_LOCAL_NODE_PORTS,
  localNodeUrl,
  nodeEndpoint,
  probeNodeHealth,
  discoverLocalNodes,
} from './nodeDiscovery.js';
export type { DiscoverLocalNodesOptions } from './nodeDiscovery.js';
