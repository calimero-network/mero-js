import { createBrowserHttpClient, createNodeHttpClient } from './http-client';
import { createAuthApiClientFromHttpClient } from './auth-api';
import { createAdminApiClientFromHttpClient } from './admin-api';
import {
  createDefaultTokenStorage,
  createTokenStorage,
  type TokenStorage,
  type TokenStorageConfig,
} from './token-storage';
import type { AuthApiClient } from './auth-api';
import type { AdminApiClient } from './admin-api';
import type { HttpClient } from './http-client';

export interface MeroJsConfig {
  /** Base URL for the Calimero node */
  baseUrl: string;
  /** Initial credentials for authentication */
  credentials?: {
    username: string;
    password: string;
  };
  /** Custom HTTP client timeout in milliseconds */
  timeoutMs?: number;
  /** Token storage configuration */
  tokenStorage?: {
    type?: 'memory' | 'localStorage' | 'file';
    config?: TokenStorageConfig;
  };
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
  private tokenStorage: TokenStorage;
  private refreshPromise: Promise<TokenData> | null = null;

  constructor(config: MeroJsConfig) {
    this.config = {
      timeoutMs: 10000,
      ...config,
    };

    // Initialize token storage
    if (config.tokenStorage?.type) {
      this.tokenStorage = createTokenStorage(
        config.tokenStorage.type,
        config.tokenStorage.config,
      );
    } else {
      this.tokenStorage = createDefaultTokenStorage(
        config.tokenStorage?.config,
      );
    }

    // Create HTTP client with token management
    // Use appropriate HTTP client based on environment
    const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
    this.httpClient = isNode 
      ? createNodeHttpClient({
          baseUrl: this.config.baseUrl,
          getAuthToken: async () => {
            const token = await this.tokenStorage.getToken();
            return token?.access_token || '';
          },
          timeoutMs: this.config.timeoutMs,
        })
      : createBrowserHttpClient({
          baseUrl: this.config.baseUrl,
          getAuthToken: async () => {
            const token = await this.tokenStorage.getToken();
            return token?.access_token || '';
          },
          timeoutMs: this.config.timeoutMs,
        });

    // Create API clients
    this.authClient = createAuthApiClientFromHttpClient(this.httpClient, {
      baseUrl: this.config.baseUrl,
      timeoutMs: this.config.timeoutMs,
    });

    this.adminClient = createAdminApiClientFromHttpClient(this.httpClient, {
      baseUrl: this.config.baseUrl,
      timeoutMs: this.config.timeoutMs,
    });

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
      const requestBody = {
        auth_method: 'user_password',
        public_key: creds.username,
        client_name: 'mero-js-sdk',
        permissions: ['admin'],
        timestamp: Math.floor(Date.now() / 1000),
        provider_data: {
          username: creds.username,
          password: creds.password,
        },
      };

      // Create a temporary HTTP client with no auth for the initial token request
      const tempIsNode = typeof process !== 'undefined' && process.versions && process.versions.node;
      const tempHttpClient = tempIsNode 
        ? createNodeHttpClient({
            baseUrl: this.config.baseUrl,
            timeoutMs: this.config.timeoutMs,
          })
        : createBrowserHttpClient({
            baseUrl: this.config.baseUrl,
            timeoutMs: this.config.timeoutMs,
          });
      
      const tempAuthClient = createAuthApiClientFromHttpClient(tempHttpClient, {
        baseUrl: this.config.baseUrl,
        timeoutMs: this.config.timeoutMs,
      });
      
      const response = await tempAuthClient.generateTokens(requestBody);

      const tokenData = {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token,
        expires_at: Date.now() + 24 * 60 * 60 * 1000, // Default to 24 hours
      };

      await this.tokenStorage.setToken(tokenData);
      return tokenData;
    } catch (error) {
      throw new Error(
        `Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Get a valid token, refreshing if necessary
   */
  private async getValidToken(): Promise<TokenData | null> {
    const tokenData = await this.tokenStorage.getToken();
    if (!tokenData) {
      return null;
    }

    // Check if token is expired (with 5 minute buffer)
    const bufferTime = 5 * 60 * 1000; // 5 minutes
    if (Date.now() >= tokenData.expires_at - bufferTime) {
      return await this.refreshToken();
    }

    return tokenData;
  }

  /**
   * Refresh the access token using the refresh token
   */
  private async refreshToken(): Promise<TokenData> {
    const tokenData = await this.tokenStorage.getToken();
    if (!tokenData?.refresh_token) {
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
    try {
      const tokenData = await this.tokenStorage.getToken();
      const response = await this.authClient.refreshToken({
        access_token: tokenData!.access_token,
        refresh_token: tokenData!.refresh_token,
      });

      const newTokenData = {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token,
        expires_at: Date.now() + 24 * 60 * 60 * 1000, // Default to 24 hours
      };

      await this.tokenStorage.setToken(newTokenData);
      return newTokenData;
    } catch (error) {
      // If refresh fails, clear the token and require re-authentication
      await this.clearToken();
      throw new Error(
        `Token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Clear the current token
   */
  public async clearToken(): Promise<void> {
    await this.tokenStorage.clearToken();
  }

  /**
   * Check if the SDK is authenticated
   */
  public async isAuthenticated(): Promise<boolean> {
    const tokenData = await this.tokenStorage.getToken();
    return tokenData !== null;
  }

  /**
   * Get the current token data (for debugging)
   */
  public async getTokenData(): Promise<TokenData | null> {
    return await this.tokenStorage.getToken();
  }
}

/**
 * Create a new MeroJs SDK instance
 */
export function createMeroJs(config: MeroJsConfig): MeroJs {
  return new MeroJs(config);
}
