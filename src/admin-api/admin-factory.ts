import { AdminApiClient } from './admin-client.js';
import { AdminApiClientConfig } from './admin-types.js';
import {
  HttpClient,
  createBrowserHttpClient,
  createNodeHttpClient,
  createUniversalHttpClient,
} from '../http-client/index.js';

// Factory functions for creating Admin API clients

/** Admin client over a browser HTTP transport (global `fetch`). */
export function createBrowserAdminApiClient(
  config: AdminApiClientConfig,
): AdminApiClient {
  return new AdminApiClient(createBrowserHttpClient(config));
}

/** Admin client over a Node HTTP transport (Node 18+ `fetch`). */
export function createNodeAdminApiClient(
  config: AdminApiClientConfig,
): AdminApiClient {
  return new AdminApiClient(createNodeHttpClient(config));
}

/** Admin client over whichever transport suits the current runtime. */
export function createAdminApiClient(
  config: AdminApiClientConfig,
): AdminApiClient {
  return new AdminApiClient(createUniversalHttpClient(config));
}

/**
 * Admin client over a caller-supplied HTTP client — use this to share one
 * transport (and its token handling) with the other API clients.
 */
export function createAdminApiClientFromHttpClient(
  httpClient: HttpClient,
  _config: AdminApiClientConfig,
): AdminApiClient {
  return new AdminApiClient(httpClient);
}
