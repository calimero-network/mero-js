import { HttpClient } from '../../http-client';
import { AdminApiClient } from './client';

export function createAdminApiClient(
  httpClient: HttpClient,
): AdminApiClient {
  return new AdminApiClient(httpClient);
}
