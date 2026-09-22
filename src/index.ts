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

// Cloud client — namespaces, relays, HA, and the cloud sign-in path
export * from './cloud/index.js';

// Relay client — write through delegated execution, holding only a signing key
export * from './relay/index.js';

// Warrant signing — mint the author's consent for a relay to run one intent
// Who signs — pass a `Signer` anywhere a `deviceSecret`/`rootSecret` is taken,
// so a key that cannot be exported to hex can still be used.
export { signerFromSecret, signerFromCryptoKey } from './signer/index.js';
export type { Signer } from './signer/index.js';

export { signWarrant, intentHash } from './warrant/index.js';
// Account roots — mint one with a recovery phrase, or prove you hold one
export {
  generateAccountRoot,
  accountRootFromPhrase,
  accountRootFromSecret,
  createAccountRootSigner,
  accountRootSignerFromPhrase,
  signAccountLink,
  signAccountLogin,
  // The two forms a root may be held in, and what resolves either. Exported
  // because `RootSource` is already the parameter type of every cloud entry
  // point that takes a root — a consumer writing a wrapper around one could
  // name it in a signature only by re-declaring it.
  resolveRoot,
  resolveRootPair,
} from './account/index.js';
export type {
  AccountRoot,
  RecoverableAccountRoot,
  AccountRootSigner,
  NewAccountRootSigner,
  AccountLinkInput,
  AccountLoginInput,
  RootSource,
  ResolvedRoot,
} from './account/index.js';
export {
  signDeviceCert,
  mintDeviceId,
  deviceCertPayload,
  accountForRoot,
  accountForRootPublicKey,
  parseDeviceCredential,
  verifyDeviceCredential,
} from './device-cert/index.js';
export type { DeviceCertInput, DeviceCredential } from './device-cert/index.js';
export {
  signMemberJoinOp,
  encodeSignedInvitation,
  SIGNED_NAMESPACE_OP_SCHEMA_VERSION,
} from './namespace-op/index.js';
export type { SignMemberJoinInput } from './namespace-op/index.js';
export type { WarrantInput } from './warrant/index.js';

// Login-statement signing — the device's half of a password-free session
export { signLoginStatement } from './login/index.js';
export type { Audience, LoginStatementInput } from './login/index.js';
export { login, generateSessionKey } from './login/index.js';
export type {
  LoginConfig,
  DelegatedSession,
  SessionKeyPair,
} from './login/index.js';

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
