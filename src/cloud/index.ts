export { CloudClient } from './cloud-client.js';
export type {
  CloudClientConfig,
  CloudSession,
  CloudNamespace,
  CloudRelay,
  CloudAccountRelay,
  CloudNamespaceNode,
  CloudNamespaceRouting,
  CloudMachine,
  CloudMachineNamespace,
  CloudLinkedAccount,
  CloudLinkedAccounts,
  CloudAccountLink,
  AccountLinkChallenge,
  AccountLinkProof,
  AccountLinkHandoff,
  AccountLinkCallback,
  AccountLoginChallenge,
  AccountLoginProof,
  EnableHAOptions,
  DisableHAOptions,
} from './cloud-client.js';
export { connectCloud } from './connect.js';
export type { ConnectCloudOptions, CloudConnection } from './connect.js';
export { signRoutingChallenge, routingProofHeaders } from './routing-proof.js';
export type {
  RoutingCredential,
  DiscoveryChallenge,
  RoutingChallenge,
  RoutingProofHeaders,
} from './routing-proof.js';

// Linking an account to a cloud login from a browser — the redirect half the
// cloud's consent screen expects an app to implement.
export {
  cloudLinkUrl,
  beginCloudLink,
  readCloudLinkCallback,
  completeCloudLink,
} from './link-redirect.js';
export type {
  BeginCloudLinkOptions,
  CloudLinkCallback,
  CompleteCloudLinkOptions,
} from './link-redirect.js';
