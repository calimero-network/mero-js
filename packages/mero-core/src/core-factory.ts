// Core factory for creating Mero instances with explicit dependencies
import { AuthApiClient } from './auth-api';
import { AdminApiClient } from './admin-api';
import { HttpClient } from './http-client/http-types';
import { TokenStorage } from './token-storage/types';

export interface CoreConfig {
  baseUrl: string;
  credentials?: {
    username: string;
    password: string;
  };
  timeoutMs?: number;
}

export interface CoreDependencies {
  httpClient: HttpClient;
  tokenStorage: TokenStorage;
}

export function createCore(config: CoreConfig, deps: CoreDependencies) {
  // Create API clients with the provided dependencies
  const authClient = new AuthApiClient(deps.httpClient);
  const adminClient = new AdminApiClient(deps.httpClient);

  return {
    auth: authClient,
    admin: adminClient,
    config,
  };
}
