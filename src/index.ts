// Mero.js - Pure JavaScript SDK for Calimero
// This will contain the pure JavaScript SDK without React dependencies

// Main SDK class
export { MeroJs, createMeroJs } from "./mero-js.js";
export type { MeroJsConfig, TokenData } from "./mero-js.js";

// HTTP client module (Web Standards based)
export * from "./http-client/index.js";

// Auth API client
export * from "./auth-api/index.js";

// Admin API client
export * from "./admin-api/index.js";

// What a failed request means — kind, retryable, the node's own words
export * from "./errors/index.js";

// Auth utilities
export { parseAuthCallback, buildAuthLoginUrl } from "./auth/index.js";
export type { AuthCallbackResult, AuthLoginOptions } from "./auth/index.js";

// Token store
export {
  MemoryTokenStore,
  LocalStorageTokenStore,
} from "./token-store/index.js";
export type { TokenStore } from "./token-store/index.js";

// RPC client
export { RpcClient, RpcError } from "./rpc/index.js";
export type { MigrateMyEntriesSummary } from "./rpc/index.js";
export type { ExecuteParams } from "./rpc/index.js";

// Events (SSE / WebSocket)
export { SseClient, WsClient } from "./events/index.js";
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
} from "./events/index.js";

// Ephemeral presence (cursors / typing / online)
export { EphemeralClient, jsonCodec } from "./ephemeral/index.js";
export type { Codec, EphemeralEntry } from "./ephemeral/index.js";

// Cloud client — namespaces, relays, HA, and the cloud sign-in path
export * from "./cloud/index.js";

// Sealed transport — requests encrypted to a TEE node's attested key
export * from "./sealed/index.js";

// Relay client — write through delegated execution, holding only a signing key
export * from "./relay/index.js";

// Warrant signing — mint the author's consent for a relay to run one intent
export {
  signWarrant,
  intentHash,
  signCreationWarrant,
  parseCreationWarrant,
  creationInitHash,
  signGovernanceWarrant,
  parseGovernanceWarrant,
  governanceOpHash,
  memberAddedOp,
  memberRemovedOp,
  memberLeftOp,
  memberRoleSetOp,
  groupCreatedOp,
  groupReparentedOp,
  groupDeletedOp,
  namespaceCreatedOp,
  defaultCapabilitiesSetOp,
  foundedNamespaceId,
} from "./warrant/index.js";
// Who signs — a key's capability, separated from its material, so a
// non-extractable key can be used wherever a hex secret could.
export { signerFromSecret, signerFromCryptoKey } from "./signer/index.js";
export type { Signer } from "./signer/index.js";
// Account roots — mint one with a recovery phrase, or prove you hold one
export {
  generateAccountRoot,
  accountRootFromPhrase,
  accountRootFromSecret,
  signAccountLink,
  signAccountLogin,
} from "./account/index.js";
export type {
  AccountRoot,
  RecoverableAccountRoot,
  AccountLinkInput,
  AccountLoginInput,
} from "./account/index.js";
export {
  signDeviceCert,
  mintDeviceId,
  deviceCertPayload,
  accountForRoot,
} from "./device-cert/index.js";
export type { DeviceCertInput } from "./device-cert/index.js";
export {
  signMemberJoinOp,
  encodeSignedInvitation,
  SIGNED_NAMESPACE_OP_SCHEMA_VERSION,
} from "./namespace-op/index.js";
export type { SignMemberJoinInput } from "./namespace-op/index.js";
export type {
  WarrantInput,
  CreationWarrantInput,
  CreationWarrantFields,
  SignedCreationWarrant,
  GovernanceWarrantInput,
  GovernanceWarrantFields,
  GovernanceOp,
  GovernanceOpKind,
  GovernanceMemberRole,
  GroupCreatedInput,
  NamespaceCreatedInput,
} from "./warrant/index.js";

// Login-statement signing — the device's half of a password-free session
export {
  requestBodyHash,
  signRequest,
  callerProof,
  createProofSigner,
} from "./request/index.js";
export type {
  CallerProofInput,
  ProofRequest,
  ProofSignerOptions,
} from "./request/index.js";
export type { RequestSigInput } from "./request/index.js";
export { signLoginStatement } from "./login/index.js";
export type { Audience, LoginStatementInput } from "./login/index.js";
export { login, generateSessionKey } from "./login/index.js";
export type {
  LoginConfig,
  DelegatedSession,
  SessionKeyPair,
} from "./login/index.js";

// Member capability bitmask constants & helpers
export * from "./capabilities.js";

// Utilities
export {
  DEFAULT_LOCAL_NODE_PORTS,
  localNodeUrl,
  nodeEndpoint,
  probeNodeHealth,
  discoverLocalNodes,
} from "./nodeDiscovery.js";
export type { DiscoverLocalNodesOptions } from "./nodeDiscovery.js";
