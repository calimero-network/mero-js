import { HttpClient } from '../../http-client';
import * as types from './types';
import { unwrap, type ApiResponseWrapper } from '../utils';

export interface AuthApiClientConfig {
  /**
   * Base URL for auth endpoints.
   * - Embedded mode: Use same base URL as admin API (e.g., 'http://localhost:8080')
   * - Proxied mode: Use external auth service URL (e.g., 'https://auth.example.com')
   */
  baseUrl: string;
  /**
   * Whether auth is embedded (uses /auth/ paths) or proxied (external service).
   * If not specified, will be auto-detected based on baseUrl.
   */
  embedded?: boolean;
}

export class AuthApiClient {
  private embedded: boolean;

  constructor(
    private httpClient: HttpClient,
    config: AuthApiClientConfig,
  ) {
    // Auto-detect embedded mode if not specified
    // Embedded: baseUrl matches admin API base URL (or not specified, default to embedded)
    // Proxied: baseUrl is different (external service)
    this.embedded = config.embedded ?? true; // Default to embedded
  }

  private getAuthPath(path: string): string {
    if (this.embedded) {
      // Embedded mode: use /auth/ prefix (relative to HttpClient's baseUrl)
      return `/auth${path}`;
    }
    // Proxied mode: paths are relative to the external auth service
    // The HttpClient should have the external baseUrl set
    return path;
  }

  // Public endpoints
  async getLogin(): Promise<string> {
    return this.httpClient.get<string>(this.getAuthPath('/login'), {
      parse: 'text',
    });
  }

  async getChallenge(): Promise<types.AuthChallengeResponse> {
    return unwrap(
      this.httpClient.get<ApiResponseWrapper<types.AuthChallengeResponse>>(
        this.getAuthPath('/challenge'),
      ),
    );
  }

  async getToken(
    request: types.AuthTokenRequest,
  ): Promise<types.AuthTokenResponse> {
    return unwrap(
      this.httpClient.post<ApiResponseWrapper<types.AuthTokenResponse>>(
        this.getAuthPath('/token'),
        request,
      ),
    );
  }

  async refreshToken(
    request: types.RefreshTokenRequest,
  ): Promise<types.AuthTokenResponse> {
    return unwrap(
      this.httpClient.post<ApiResponseWrapper<types.AuthTokenResponse>>(
        this.getAuthPath('/refresh'),
        request,
      ),
    );
  }

  async getProviders(): Promise<types.AuthProvidersResponse> {
    return unwrap(
      this.httpClient.get<ApiResponseWrapper<types.AuthProvidersResponse>>(
        this.getAuthPath('/providers'),
      ),
    );
  }

  async getIdentity(): Promise<types.AuthIdentityResponse> {
    return unwrap(
      this.httpClient.get<ApiResponseWrapper<types.AuthIdentityResponse>>(
        this.getAuthPath('/identity'),
      ),
    );
  }

  async validateToken(
    request: types.TokenValidationRequest,
  ): Promise<types.TokenValidationResponse> {
    return unwrap(
      this.httpClient.post<ApiResponseWrapper<types.TokenValidationResponse>>(
        this.getAuthPath('/validate'),
        request,
      ),
    );
  }

  async validateTokenGet(token: string): Promise<types.TokenValidationResponse> {
    return unwrap(
      this.httpClient.get<ApiResponseWrapper<types.TokenValidationResponse>>(
        this.getAuthPath('/validate'),
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      ),
    );
  }

  async getHealth(): Promise<types.HealthResponse> {
    return unwrap(
      this.httpClient.get<ApiResponseWrapper<types.HealthResponse>>(
        this.getAuthPath('/health'),
      ),
    );
  }

  async getCallback(callbackUrl?: string): Promise<string> {
    const params = callbackUrl
      ? `?callback-url=${encodeURIComponent(callbackUrl)}`
      : '';
    return this.httpClient.get<string>(
      this.getAuthPath(`/callback${params}`),
      {
        parse: 'text',
      },
    );
  }

  // Protected endpoints (require JWT token)
  async revokeToken(): Promise<types.RevokeTokenResponse> {
    return unwrap(
      this.httpClient.post<ApiResponseWrapper<types.RevokeTokenResponse>>(
        this.getAuthPath('/admin/revoke'),
        {},
      ),
    );
  }

  async listRootKeys(): Promise<types.ListRootKeysResponse> {
    return unwrap(
      this.httpClient.get<ApiResponseWrapper<types.ListRootKeysResponse>>(
        this.getAuthPath('/admin/keys'),
      ),
    );
  }

  async createRootKey(
    request: types.CreateRootKeyRequest,
  ): Promise<types.CreateRootKeyResponse> {
    return unwrap(
      this.httpClient.post<ApiResponseWrapper<types.CreateRootKeyResponse>>(
        this.getAuthPath('/admin/keys'),
        request,
      ),
    );
  }

  async deleteRootKey(keyId: string): Promise<types.DeleteRootKeyResponse> {
    return unwrap(
      this.httpClient.delete<ApiResponseWrapper<types.DeleteRootKeyResponse>>(
        this.getAuthPath(`/admin/keys/${keyId}`),
      ),
    );
  }

  async listClientKeys(): Promise<types.ListClientKeysResponse> {
    return unwrap(
      this.httpClient.get<ApiResponseWrapper<types.ListClientKeysResponse>>(
        this.getAuthPath('/admin/keys/clients'),
      ),
    );
  }

  async generateClientKey(
    request: types.GenerateClientKeyRequest,
  ): Promise<types.GenerateClientKeyResponse> {
    return unwrap(
      this.httpClient.post<ApiResponseWrapper<types.GenerateClientKeyResponse>>(
        this.getAuthPath('/admin/client-key'),
        request,
      ),
    );
  }

  async deleteClientKey(
    keyId: string,
    clientId: string,
  ): Promise<types.DeleteClientKeyResponse> {
    return unwrap(
      this.httpClient.delete<ApiResponseWrapper<types.DeleteClientKeyResponse>>(
        this.getAuthPath(`/admin/keys/${keyId}/clients/${clientId}`),
      ),
    );
  }

  async getKeyPermissions(
    keyId: string,
  ): Promise<types.GetKeyPermissionsResponse> {
    return unwrap(
      this.httpClient.get<ApiResponseWrapper<types.GetKeyPermissionsResponse>>(
        this.getAuthPath(`/admin/keys/${keyId}/permissions`),
      ),
    );
  }

  async updateKeyPermissions(
    keyId: string,
    request: types.UpdateKeyPermissionsRequest,
  ): Promise<types.UpdateKeyPermissionsResponse> {
    return unwrap(
      this.httpClient.put<ApiResponseWrapper<types.UpdateKeyPermissionsResponse>>(
        this.getAuthPath(`/admin/keys/${keyId}/permissions`),
        request,
      ),
    );
  }

  async getProtectedIdentity(): Promise<types.AuthIdentityResponse> {
    return unwrap(
      this.httpClient.get<ApiResponseWrapper<types.AuthIdentityResponse>>(
        this.getAuthPath('/admin/identity'),
      ),
    );
  }

  async getMetrics(): Promise<types.AuthMetricsResponse> {
    return unwrap(
      this.httpClient.get<ApiResponseWrapper<types.AuthMetricsResponse>>(
        this.getAuthPath('/admin/metrics'),
      ),
    );
  }
}
