import { HttpClient } from '../../http-client';
import { AuthApiClient, AuthApiClientConfig } from './client';

export function createAuthApiClient(
  httpClient: HttpClient,
  config: AuthApiClientConfig,
): AuthApiClient {
  return new AuthApiClient(httpClient, config);
}
