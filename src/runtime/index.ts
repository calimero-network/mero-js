// The mero-js runtime (`@calimero-network/mero-js/runtime`): everything a
// route layer sends through, and nothing that is a route.
//
// `Transport.request(method, path, options)` reaches one node route over the
// attested, sealed channel with the credential held now; the runtime handles
// attestation, sealing, the session and its refresh, `421 WRONG_NODE` moves,
// D70 retries, the `412 CONFIRM_REQUIRED` passkey step-up, error mapping and
// server-sent events. `CalimeroClient` (the package root) is the hand-written
// route layer on top; `client.transport` is its runtime, which a generated
// route layer can share.

export {
  DEFAULT_RETRY,
  NodeTransport,
  directoryTransport,
  newIdempotencyKey,
  queryString,
  refusal,
  retryDelayMs,
  routePath,
  sseFrames,
} from './transport.js';
export type {
  CalimeroSession,
  CloudEvent,
  CloudRetryOptions,
  DirectorySource,
  HttpMethod,
  NodeTransportOptions,
  QueryValue,
  RequestOptions,
  Transport,
} from './transport.js';

// Attestation: what a node must prove before anything is sealed to it.
export { claimedRelease, fetchAttestedKey, freshCollateral, MOCK_QUOTE_HEADER } from '../cloud-v2/attestation.js';
export type { AttestationDoc, CloudPolicy, CloudReleasePolicy } from '../cloud-v2/attestation.js';

// The node directory a cluster's node list is read from.
export { DEFAULT_DIRECTORY, DirectoryError } from '../cloud-v2/directory.js';
export type { DirectoryFailure } from '../cloud-v2/directory.js';

// Passkeys (WebAuthn) for the step-up and the ceremonies.
export { browserPasskey, b64url, fromB64url } from '../cloud-v2/passkey.js';
export type {
  AssertionJSON,
  PasskeyCreateOptions,
  PasskeyGetOptions,
  PasskeyProvider,
  PasskeyUserVerification,
  RegistrationJSON,
} from '../cloud-v2/passkey.js';

// A refusal as a typed error.
export * from '../cloud-v2/errors.js';

// The sealed channel and the quote and release checks under it.
export * from '../sealed/index.js';
