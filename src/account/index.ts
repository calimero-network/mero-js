// Account roots — minting one, restoring it from a phrase, and proving you hold it.
export {
  generateAccountRoot,
  accountRootFromPhrase,
  accountRootFromSecret,
  createAccountRootSigner,
  accountRootSignerFromPhrase,
  signAccountLink,
  signAccountLogin,
} from './account.js';
export type {
  AccountRoot,
  RecoverableAccountRoot,
  AccountRootSigner,
  NewAccountRootSigner,
  AccountLinkInput,
  AccountLoginInput,
} from './account.js';
export { resolveRoot } from './account.js';
export type { RootSource } from './account.js';
export { resolveRootPair } from './account.js';
export type { ResolvedRoot } from './account.js';

// The delegated account layer — an account that writes through a hosted relay
// (or a node) with no node of its own: its session, the relay it learnt and
// attested, founding and creating contexts under warrants, admin over the same
// `AdminApiClient` shape on both transports, and joining from an invitation.
// Framework-free: mero-react re-exports these under the same names.
export type { DelegatedCredential, DelegatedSession as DelegatedAccountSession, RelayMap, RelayNodeKeyAttempt } from './session.js';
export {
  readDelegatedSession,
  saveDelegatedSession,
  clearDelegatedSession,
  readDelegatedCredential,
  saveDelegatedCredential,
  clearDelegatedCredential,
  persistedNonces,
  markContextNonceSpent,
  pinRelayNodeKey,
  readPinnedRelayNodeKey,
  attemptRelayNodeKey,
  resolveRelayNodeKey,
  learnRelayNodeKey,
  RELAY_NODE_KEY_RETRY_MS,
  forgetMethodKinds,
  forgetRelaySealing,
  relayTransportFetch,
  buildDelegatedClient,
  readRelayMap,
  rememberRelay,
  relayForContext,
  carryExecutorAccount,
  knownRelays,
  listDelegatedContexts,
  listDelegatedNamespaces,
} from './session.js';
export { resolveRelayFromInvitation, normaliseAccount } from './relay-from-invitation.js';
export type {
  RelayResolutionStep,
  RelayResolutionFailure,
  ResolvedInvitationRelay,
  ResolveRelayResult,
  ResolveRelayFromInvitationInput,
} from './relay-from-invitation.js';
export { joinWithNode } from './join-with-node.js';
export type {
  JoinWithNodeInput,
  JoinWithNodeResult,
  JoinWithNodeSuccess,
  JoinWithNodeFailure,
  JoinWithNodeStep,
} from './join-with-node.js';
export { bootstrapFromInvitation } from './bootstrap-from-invitation.js';
export type {
  BootstrapStep,
  BootstrapResult,
  BootstrapSuccess,
  BootstrapFailure,
  BootstrapFromInvitationInput,
} from './bootstrap-from-invitation.js';
export { joinAsAccount } from './join-as-account.js';
export {
  createDelegatedContext,
  createDelegatedPrivateContext,
  foundDelegatedNamespace,
  delegatedGovernance,
  latestPublishedVersion,
  HA_ACCOUNT_NOT_LINKED_MESSAGE,
  HA_REFUSAL_MESSAGES,
} from './create-context.js';
export type { CreateDelegatedContextRequest, FoundedDelegatedNamespace } from './create-context.js';
export { governGroup, governRoot, namespaceOfGroup, rememberGroupNamespace } from './govern.js';
export {
  applicationIdForBundle,
  fetchRegistryBundles,
  resolveApplicationIdFromRegistry,
  selectLatestBundle,
} from './application-id.js';
export type { RegistryBundle, ResolvedApplication } from './application-id.js';
export {
  createAccountAdmin,
  InvitationNotClaimableError,
  NoRelayError,
  NotForAccountError,
} from './account-admin.js';
export type { AccountAdminDeps } from './account-admin.js';
export { createNodeAdmin } from './node-admin.js';
export type { NodeAdminDeps } from './node-admin.js';
