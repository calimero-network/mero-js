import { createBrowserHttpClient } from './http-client';
import { createAuthApiClient } from './api/auth';
import { createAdminApiClient } from './api/admin';
import type { AuthApiClient } from './api/auth';
import type { AdminApiClient } from './api/admin';
import type { HttpClient } from './http-client';

export interface MeroJsConfig {
  /** Base URL for the Calimero node */
  baseUrl: string;
  /** Auth service base URL (for proxied mode). If not specified, uses baseUrl (embedded mode) */
  authBaseUrl?: string;
  /** Initial credentials for authentication */
  credentials?: {
    username: string;
    password: string;
  };
  /** Custom HTTP client timeout in milliseconds */
  timeoutMs?: number;
  /** Request credentials mode for fetch (omit, same-origin, include) */
  requestCredentials?: RequestCredentials;
}

export interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

/**
 * Main MeroJs SDK class that manages all API clients and authentication
 */
export class MeroJs {
  private config: MeroJsConfig;
  private httpClient: HttpClient;
  private authClient: AuthApiClient;
  private adminClient: AdminApiClient;
  private tokenData: TokenData | null = null;
  private refreshPromise: Promise<TokenData> | null = null;

  constructor(config: MeroJsConfig) {
    this.config = {
      timeoutMs: 10000,
      ...config,
    };

    // Create HTTP client with token management
    // For Tauri, explicitly set credentials to 'omit' to avoid network errors
    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    
    // Determine auth base URL and whether we need separate HTTP clients
    const authBaseUrl = this.config.authBaseUrl ?? this.config.baseUrl;
    const isEmbedded = authBaseUrl === this.config.baseUrl;
    
    // Create admin HTTP client (always uses baseUrl)
    this.httpClient = createBrowserHttpClient({
      baseUrl: this.config.baseUrl,
      getAuthToken: async () => {
        const token = await this.getValidToken();
        return token?.access_token || '';
      },
      timeoutMs: this.config.timeoutMs,
      credentials: this.config.requestCredentials ?? (isTauri ? 'omit' : undefined),
    });

    // Create auth HTTP client (uses authBaseUrl when different from baseUrl)
    // When authBaseUrl differs, we need a separate client to route requests correctly
    const authHttpClient = isEmbedded
      ? this.httpClient // Reuse admin client when URLs match (embedded mode)
      : createBrowserHttpClient({
          baseUrl: authBaseUrl,
          getAuthToken: async () => {
            const token = await this.getValidToken();
            return token?.access_token || '';
          },
          timeoutMs: this.config.timeoutMs,
          credentials: this.config.requestCredentials ?? (isTauri ? 'omit' : undefined),
        });

    // Create API clients
    this.authClient = createAuthApiClient(authHttpClient, {
      baseUrl: authBaseUrl,
      embedded: isEmbedded,
    });

    this.adminClient = createAdminApiClient(this.httpClient);

    // Token management is in-memory only
  }

  /**
   * Get the Auth API client
   */
  get auth(): AuthApiClient {
    return this.authClient;
  }

  /**
   * Get the Admin API client
   */
  get admin(): AdminApiClient {
    return this.adminClient;
  }

  /**
   * Authenticate with the provided credentials
   * This will create the root key on first use
   */
  async authenticate(credentials?: {
    username: string;
    password: string;
  }): Promise<TokenData> {
    const creds = credentials || this.config.credentials;
    if (!creds) {
      throw new Error('No credentials provided for authentication');
    }

    try {
      // Note: Auth API expects snake_case, not camelCase (despite OpenAPI spec showing camelCase)
      const requestBody = {
        auth_method: 'user_password' as const,
        public_key: creds.username,
        client_name: 'mero-js-sdk',
        permissions: ['admin'],
        timestamp: Math.floor(Date.now() / 1000),
        provider_data: {
          username: creds.username,
          password: creds.password,
        },
      };

      const response = await this.authClient.getToken(requestBody);

      this.tokenData = {
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        expires_at: Date.now() + response.expires_in * 1000,
      };

      return this.tokenData;
    } catch (error: unknown) {
      // Include HTTP error details if available
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const httpStatus =
        error && typeof error === 'object' && 'status' in error
          ? `HTTP ${String(error.status)}`
          : '';
      const httpStatusText =
        error && typeof error === 'object' && 'statusText' in error
          ? ` ${String(error.statusText)}`
          : '';
      const bodyText =
        error && typeof error === 'object' && 'bodyText' in error
          ? `: ${String(error.bodyText)}`
          : '';

      throw new Error(
        `Authentication failed: ${httpStatus}${httpStatusText}${bodyText || errorMessage}`,
      );
    }
  }

  /**
   * Get a valid token, refreshing if necessary
   */
  private async getValidToken(): Promise<TokenData | null> {
    if (!this.tokenData) {
      return null;
    }

    // Check if token is expired (with 5 minute buffer)
    const bufferTime = 5 * 60 * 1000; // 5 minutes
    if (Date.now() >= this.tokenData.expires_at - bufferTime) {
      return await this.refreshToken();
    }

    return this.tokenData;
  }

  /**
   * Refresh the access token using the refresh token
   */
  private async refreshToken(): Promise<TokenData> {
    if (!this.tokenData?.refresh_token) {
      throw new Error('No refresh token available');
    }

    // Prevent multiple simultaneous refresh attempts
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.performTokenRefresh();

    try {
      const newToken = await this.refreshPromise;
      return newToken;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Perform the actual token refresh
   */
  private async performTokenRefresh(): Promise<TokenData> {
    if (!this.tokenData?.refresh_token) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await this.authClient.refreshToken({
        refresh_token: this.tokenData.refresh_token,
      });

      this.tokenData = {
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        expires_at: Date.now() + response.expires_in * 1000,
      };

      return this.tokenData;
    } catch (error) {
      // If refresh fails, clear the token and require re-authentication
      this.clearToken();
      throw new Error(
        `Token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Clear the current token
   */
  public clearToken(): void {
    this.tokenData = null;
  }

  /**
   * Check if the SDK is authenticated
   */
  public isAuthenticated(): boolean {
    return this.tokenData !== null;
  }

  /**
   * Get the current token data (for debugging)
   */
  public getTokenData(): TokenData | null {
    return this.tokenData;
  }
}

/**
 * Create a new MeroJs SDK instance
 */
export function createMeroJs(config: MeroJsConfig): MeroJs {
  return new MeroJs(config);
}
