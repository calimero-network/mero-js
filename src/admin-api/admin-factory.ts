import { AdminApiClient } from './admin-client';
import { AdminApiClientConfig } from './admin-types';
import { HttpClient } from '../http-client';

/**
 * Build an AdminApiClient over an already-configured HttpClient. This is the
 * only supported factory: `MeroJs` owns the transport (auth, refresh, timeouts)
 * and passes it in. The old `createBrowser/Node/AdminApiClient` helpers were
 * removed — they wired a stub client that threw on every call.
 */
export function createAdminApiClientFromHttpClient(
  httpClient: HttpClient,
  _config: AdminApiClientConfig,
): AdminApiClient {
  return new AdminApiClient(httpClient);
}
