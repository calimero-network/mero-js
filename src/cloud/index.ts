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
export { connectCloud, connectCloudWithAccount } from './connect.js';
export type {
  ConnectCloudOptions,
  ConnectCloudWithAccountOptions,
  CloudConnection,
} from './connect.js';
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

// Getting this app's device key certified by a wallet on another origin — the
// redirect that keeps the account root out of the app's reach.
export {
  deviceEnrolmentUrl,
  beginDeviceEnrolment,
  readEnrolmentCallback,
  completeDeviceEnrolment,
  callbackIsForeign,
} from './enrol-redirect.js';
export type {
  DeviceEnrolmentOptions,
  DeviceEnrolmentCallback,
  CompleteDeviceEnrolmentOptions,
  EnrolledDevice,
} from './enrol-redirect.js';
