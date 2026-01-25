import { createBrowserHttpClient } from './http-client';
import { createAuthApiClient } from './api/auth';
import { createAdminApiClient } from './api/admin';
import { RpcClient } from './api/rpc';
import { WebSocketClient } from './api/ws';
import { SseClient } from './api/sse';
import type { AuthApiClient } from './api/auth';
import type { AdminApiClient } from './api/admin';
import type { HttpClient } from './http-client';
import type { WebSocketClientOptions } from './api/ws';
import type { SseClientOptions } from './api/sse';

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
  /**
   * Optional token storage for persistence across sessions.
   * If not provided, tokens are stored in-memory only.
   * 
   * @example Browser localStorage
   * ```typescript
   * const mero = new MeroJs({
   *   baseUrl: 'http://localhost:3000',
   *   tokenStorage: {
   *     async get() {
   *       const data = localStorage.getItem('mero-token');
   *       return data ? JSON.parse(data) : null;
   *     },
   *     async set(token) {
   *       localStorage.setItem('mero-token', JSON.stringify(token));
   *     },
   *     async clear() {
   *       localStorage.removeItem('mero-token');
   *     },
   *   },
   * });
   * ```
   * 
   * @example React Native AsyncStorage
   * ```typescript
   * import AsyncStorage from '@react-native-async-storage/async-storage';
   * 
   * const mero = new MeroJs({
   *   baseUrl: 'http://localhost:3000',
   *   tokenStorage: {
   *     async get() {
   *       const data = await AsyncStorage.getItem('mero-token');
   *       return data ? JSON.parse(data) : null;
   *     },
   *     async set(token) {
   *       await AsyncStorage.setItem('mero-token', JSON.stringify(token));
   *     },
   *     async clear() {
   *       await AsyncStorage.removeItem('mero-token');
   *     },
   *   },
   * });
   * ```
   */
  tokenStorage?: TokenStorage;
}

/**
 * Interface for custom token storage implementations.
 * Allows persistence of tokens across sessions in any environment.
 */
export interface TokenStorage {
  /** Get the stored token data */
  get(): Promise<TokenData | null>;
  /** Store the token data */
  set(token: TokenData): Promise<void>;
  /** Clear the stored token data */
  clear(): Promise<void>;
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
  private rpcClient: RpcClient;
  private tokenData: TokenData | null = null;
  private refreshPromise: Promise<TokenData> | null = null;
  private tokenStorage: TokenStorage | null = null;

  constructor(config: MeroJsConfig) {
    this.config = {
      timeoutMs: 10000,
      ...config,
    };

    this.tokenStorage = config.tokenStorage || null;

    // Create HTTP client with token management
    // For Tauri, explicitly set credentials to 'omit' to avoid network errors
    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    
    // Determine auth base URL and whether we need separate HTTP clients
    const authBaseUrl = this.config.authBaseUrl ?? this.config.baseUrl;
    const isEmbedded = authBaseUrl === this.config.baseUrl;
    
    // Create admin HTTP client (always uses baseUrl) with automatic 401 refresh
    this.httpClient = createBrowserHttpClient({
      baseUrl: this.config.baseUrl,
      getAuthToken: async () => {
        const token = await this.getValidToken();
        return token?.access_token || '';
      },
      // Wire up automatic token refresh on 401
      refreshToken: async () => {
        const refreshed = await this.performTokenRefresh();
        return refreshed.access_token;
      },
      onTokenRefresh: async (_newToken: string) => {
        // Token is already updated in performTokenRefresh, but we need
        // to ensure storage is updated if provided
        if (this.tokenData && this.tokenStorage) {
          await this.tokenStorage.set(this.tokenData);
        }
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
          // Wire up automatic token refresh on 401
          refreshToken: async () => {
            const refreshed = await this.performTokenRefresh();
            return refreshed.access_token;
          },
          onTokenRefresh: async (_newToken: string) => {
            if (this.tokenData && this.tokenStorage) {
              await this.tokenStorage.set(this.tokenData);
            }
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
    
    // Create RPC client for executing queries/mutations
    this.rpcClient = new RpcClient(this.httpClient);

    // Token management is in-memory by default, or uses provided storage
  }

  /**
   * Initialize the SDK by loading tokens from storage (if provided).
   * Call this after construction if using tokenStorage.
   * 
   * @example
   * ```typescript
   * const mero = new MeroJs({ baseUrl: '...', tokenStorage: myStorage });
   * await mero.init(); // Load stored tokens
   * 
   * if (!mero.isAuthenticated()) {
   *   await mero.authenticate({ username: '...', password: '...' });
   * }
   * ```
   */
  async init(): Promise<void> {
    if (this.tokenStorage) {
      const storedToken = await this.tokenStorage.get();
      if (storedToken) {
        this.tokenData = storedToken;
      }
    }
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
   * Get the RPC client for executing queries and mutations
   *
   * @example
   * ```typescript
   * // Execute a query
   * const result = await meroJs.rpc.query(
   *   'context-id',
   *   'get',
   *   { key: 'myKey' },
   *   'ed25519:executor-public-key'
   * );
   *
   * // Execute a mutation
   * await meroJs.rpc.mutate(
   *   'context-id',
   *   'set',
   *   { key: 'myKey', value: 'myValue' },
   *   'ed25519:executor-public-key'
   * );
   *
   * // Or use the generic execute method
   * const result = await meroJs.rpc.execute({
   *   contextId: 'context-id',
   *   method: 'set',
   *   args: { key: 'myKey', value: 'myValue' },
   *   executorPublicKey: 'ed25519:...',
   * });
   * ```
   */
  get rpc(): RpcClient {
    return this.rpcClient;
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

      // Persist to storage if provided
      if (this.tokenStorage) {
        await this.tokenStorage.set(this.tokenData);
      }

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
   * Get a valid token, refreshing if necessary.
   * This is called automatically by the HTTP client.
   * 
   * Note: The HTTP client also handles 401 errors with automatic refresh,
   * so this preemptive check is an optimization to avoid unnecessary 401s.
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
   * Refresh the access token using the refresh token.
   * Called automatically when token is about to expire or on 401.
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
   * Perform the actual token refresh.
   * This is exposed separately for the HTTP client's 401 handler.
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

      // Persist to storage if provided
      if (this.tokenStorage) {
        await this.tokenStorage.set(this.tokenData);
      }

      return this.tokenData;
    } catch (error) {
      // If refresh fails, clear the token and require re-authentication
      await this.clearToken();
      throw new Error(
        `Token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Clear the current token from memory and storage
   */
  public async clearToken(): Promise<void> {
    this.tokenData = null;
    if (this.tokenStorage) {
      await this.tokenStorage.clear();
    }
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

  /**
   * Create a WebSocket client for real-time event subscriptions
   *
   * @param options - Optional WebSocket client options to override defaults
   * @returns A new WebSocketClient instance
   *
   * @example
   * ```typescript
   * const ws = meroJs.createWebSocket();
   * await ws.connect();
   *
   * ws.onEvent((event) => {
   *   console.log('Received event:', event);
   * });
   *
   * await ws.subscribe(['context-id-1', 'context-id-2']);
   *
   * // Later...
   * ws.disconnect();
   * ```
   */
  public createWebSocket(
    options?: Partial<Omit<WebSocketClientOptions, 'baseUrl' | 'getAuthToken'>>,
  ): WebSocketClient {
    return new WebSocketClient({
      baseUrl: this.config.baseUrl,
      getAuthToken: async () => this.tokenData?.access_token || null,
      ...options,
    });
  }

  /**
   * Create an SSE client for server-sent event streaming
   *
   * @param options - Optional SSE client options to override defaults
   * @returns A new SseClient instance
   *
   * @example
   * ```typescript
   * const sse = meroJs.createSse();
   * const sessionId = await sse.connect();
   *
   * sse.onEvent((event) => {
   *   console.log('Received event:', event);
   * });
   *
   * await sse.subscribe(['context-id-1', 'context-id-2']);
   *
   * // Get session info
   * const session = await sse.getSession();
   *
   * // Later...
   * sse.disconnect();
   * ```
   */
  public createSse(
    options?: Partial<Omit<SseClientOptions, 'baseUrl' | 'httpClient' | 'getAuthToken'>>,
  ): SseClient {
    return new SseClient({
      baseUrl: this.config.baseUrl,
      httpClient: this.httpClient,
      getAuthToken: async () => this.tokenData?.access_token || null,
      ...options,
    });
  }
}

/**
 * Create a new MeroJs SDK instance
 */
export function createMeroJs(config: MeroJsConfig): MeroJs {
  return new MeroJs(config);
}
