// The generated route layer: core's OpenAPI document as one method per
// operation (`createRoutes`, `client.orgs.get({ org })`), over a typed
// `openapi-fetch` client on the runtime's sealed transport (`createApiClient`,
// low level), and the middleware that answers the node's step-up (`412`) and
// operator (`428`) challenges.

export {
  API_BASE_URL,
  createApiClient,
  idempotencyKeys,
  refusalOf,
  transportFetch,
  unwrap,
} from './client.js';
export type { ApiClient, ApiClientOptions, ApiPaths, ApiResult, ApiTransport, Middleware } from './client.js';
export { operatorSignature, passkeyConfirm, promptFailure, stepUp, userVerificationOf } from './step-up.js';
export type {
  ConfirmCallback,
  ConfirmChallenge,
  OperatorProof,
  OperatorProofCallback,
  OperatorStatement,
  PasskeyConfirmOptions,
} from './step-up.js';
export { route } from './operation.js';
export type { CallOptions, RawBody, RouteShape } from './operation.js';
export { createRoutes } from '../generated/methods.js';
export type {
  AppsRoutes,
  AuthRoutes,
  ConsentRoutes,
  DeploymentsRoutes,
  OpsRoutes,
  OrgsRoutes,
  PackagesRoutes,
  PublicRoutes,
  Routes,
} from '../generated/methods.js';
export type { components as ApiComponents, operations as ApiOperations } from '../generated/api.js';
