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

// Transport — one client, two write paths, chosen at construction (node by default)
export {
  MeroClient,
  createMeroClient,
  RelayTransport,
  // A relay is a node: given its signing key, a relay-transport client
  // subscribes over the same `/sse` and `/ws` a node client uses.
  RelayObserver,
  defaultAudience,
} from './transport/index.js';
export type {
  MeroClientConfig,
  NodeTransportConfig,
  RelayTransportConfig,
  RelayObserveConfig,
  ExecuteTransport,
  ExecuteResult,
  TransportKind,
} from './transport/index.js';

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
export { EphemeralClient, jsonCodec, subscribePresence } from "./ephemeral/index.js";
export { RelayPresenceClient } from "./presence/relay-presence.js";
export { presenceStatementBytes, stateHash, PRESENCE_DOMAIN } from "./presence/statement.js";
export type { Codec, EphemeralEntry } from "./ephemeral/index.js";

// Cloud client — namespaces, relays, HA, and the cloud sign-in path
export * from "./cloud/index.js";

// Sealed transport — requests encrypted to a TEE node's attested key
export * from "./sealed/index.js";

// Relay client — write through delegated execution, holding only a signing key
export * from "./relay/index.js";

// Request proofs — a caller's identity on the request itself, no session needed
export * from "./request-proof/index.js";

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
  createdSubgroupId,
  subgroupCreation,
  groupReparentedOp,
  groupDeletedOp,
  memberCapabilitySetOp,
  contextDetachedOp,
  subgroupVisibilitySetOp,
  groupMetadataSetOp,
  memberMetadataSetOp,
  contextMetadataSetOp,
  contextCapabilityGrantedOp,
  contextCapabilityRevokedOp,
  memberJoinedOpenOp,
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
} from "./account/index.js";
export type {
  AccountRoot,
  RecoverableAccountRoot,
  AccountRootSigner,
  NewAccountRootSigner,
  AccountLinkInput,
  AccountLoginInput,
  RootSource,
  ResolvedRoot,
} from "./account/index.js";
export {
  signDeviceCert,
  mintDeviceId,
  deviceCertPayload,
  accountForRoot,
  accountForRootPublicKey,
  parseDeviceCredential,
  verifyDeviceCredential,
} from "./device-cert/index.js";
export type { DeviceCertInput, DeviceCredential } from "./device-cert/index.js";
// A device's scope — signed by the root beside its certificate, and what a relay
// needs with it to bind the device of an account that has no node.
export { signDeviceScope, deviceScopePayload } from "./device-cert/index.js";
export type { DeviceScopeInput } from "./device-cert/index.js";
// Invitations minted off-node, signed by a bound device key.
export {
  signGroupInvitation,
  encodeGroupInvitation,
  groupInvitationHash,
  defaultAdmitters,
  MAX_INVITATION_VALIDITY_SECS,
  INVITED_ROLE,
} from "./invitation/index.js";
export type { GroupInvitationInput } from "./invitation/index.js";
export {
  signMemberJoinOp,
  encodeSignedInvitation,
  SIGNED_NAMESPACE_OP_SCHEMA_VERSION,
} from "./namespace-op/index.js";
export type { SignMemberJoinInput } from "./namespace-op/index.js";
export {
  OWNER_OP_KIND,
  transferOwnershipOp,
  groupDeleteOp,
  adminChangedOp,
  teeAuthoringPolicyOp,
  teeAdmissionPolicyOp,
  teeReleaseAdmissionPolicyOp,
  ownerOpDigest,
  ownerOpSigningPayload,
  signOwnerOpProof,
  rootGuardedOpBytes,
} from "./owner-op/index.js";
export type {
  OwnerOp,
  OwnerOpKind,
  OwnerOpPlane,
  OwnerOpProofInput,
  TeeAdmissionPolicyOpInput,
  TeeReleaseAdmissionPolicyOpInput,
} from "./owner-op/index.js";
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
  SubgroupCreation,
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

// A relay's node key, learned from its TEE attestation rather than pasted in.
export { attestRelayNodeKey, attestKeyBinding, reportDataOf } from "./relay-attestation/index.js";
export type { AttestedNodeKey, AttestRelayNodeKeyOptions } from "./relay-attestation/index.js";
