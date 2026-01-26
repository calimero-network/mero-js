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
    // IMPORTANT: Auth client does NOT have refreshToken wired up to prevent infinite loops
    // when the refresh endpoint itself returns 401
    const authHttpClient = createBrowserHttpClient({
      baseUrl: authBaseUrl,
      getAuthToken: async () => {
        const token = await this.getValidToken();
        return token?.access_token || '';
      },
      // NO refreshToken callback - auth endpoints handle their own auth
      // Wiring refreshToken here would cause infinite loops when refresh fails
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
    console.log('[mero-js] init() called, tokenStorage:', this.tokenStorage ? 'EXISTS' : 'NULL');
    if (this.tokenStorage) {
      const storedToken = await this.tokenStorage.get();
      console.log('[mero-js] init() storedToken:', storedToken ? 'LOADED' : 'NULL');
      if (storedToken) {
        this.tokenData = storedToken;
        console.log('[mero-js] init() tokenData set, expires_at:', storedToken.expires_at);
      }
    } else {
      console.log('[mero-js] init() no tokenStorage configured');
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

      // Extract expiry from JWT (more reliable than response.expires_in)
      let expiresAt: number;
      try {
        const payload = JSON.parse(atob(response.access_token.split('.')[1]));
        expiresAt = payload.exp * 1000; // JWT exp is in seconds, convert to ms
        console.log('[mero-js] Extracted exp from JWT:', payload.exp, '-> expires_at:', expiresAt);
      } catch (e) {
        // Fallback to response.expires_in if JWT parsing fails
        expiresAt = Date.now() + (response.expires_in || 3600) * 1000;
        console.warn('[mero-js] Failed to parse JWT, using expires_in fallback:', expiresAt);
      }

      this.tokenData = {
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        expires_at: expiresAt,
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
    console.log('[mero-js] getValidToken called, tokenData:', this.tokenData ? 'EXISTS' : 'NULL');
    if (!this.tokenData) {
      console.log('[mero-js] No tokenData, returning null');
      return null;
    }

    // Check if token is actually expired
    const now = Date.now();
    const expiresAt = this.tokenData.expires_at;
    const isExpired = now >= expiresAt;
    console.log('[mero-js] Token check: now=', now, 'expires_at=', expiresAt, 'isExpired=', isExpired);
    
    if (isExpired) {
      console.log('[mero-js] Token expired, attempting preemptive refresh');
      return await this.refreshToken();
    }

    console.log('[mero-js] Token valid, returning tokenData');
    return this.tokenData;
  }

  /**
   * Refresh the access token using the refresh token.
   * Called automatically when token is about to expire or on 401.
   * 
   * @deprecated Use performTokenRefresh instead - this is kept for compatibility
   */
  private async refreshToken(): Promise<TokenData> {
    return this.performTokenRefresh();
  }

  /**
   * Perform the actual token refresh.
   * This is used by both preemptive refresh and HTTP client's 401 handler.
   * 
   * Uses a shared promise to prevent multiple simultaneous refresh attempts,
   * even when called from multiple sources (preemptive check, HTTP 401 handler, etc.)
   */
  private async performTokenRefresh(): Promise<TokenData> {
    // Prevent multiple simultaneous refresh attempts
    // This is critical for avoiding 100+ refresh requests when multiple 401s come in
    if (this.refreshPromise) {
      console.log('[mero-js] Refresh already in progress, waiting for existing promise');
      return this.refreshPromise;
    }

    console.log('[mero-js] Starting new refresh attempt');
    this.refreshPromise = this.doTokenRefresh();

    try {
      const newToken = await this.refreshPromise;
      return newToken;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Internal: Actually perform the refresh request.
   * Called only from performTokenRefresh() which manages the deduplication.
   */
  private async doTokenRefresh(): Promise<TokenData> {
    console.log('[mero-js doTokenRefresh] STARTING refresh...');
    console.log('[mero-js doTokenRefresh] tokenData exists:', !!this.tokenData);
    console.log('[mero-js doTokenRefresh] access_token exists:', !!this.tokenData?.access_token);
    console.log('[mero-js doTokenRefresh] refresh_token exists:', !!this.tokenData?.refresh_token);
    
    if (!this.tokenData?.refresh_token) {
      throw new Error('No refresh token available');
    }
    
    if (!this.tokenData?.access_token) {
      throw new Error('No access token available for refresh (server requires both tokens)');
    }

    try {
      // Server requires BOTH access_token and refresh_token (snake_case)
      const refreshPayload = {
        access_token: this.tokenData.access_token,
        refresh_token: this.tokenData.refresh_token,
      };
      console.log('[mero-js doTokenRefresh] Payload keys:', Object.keys(refreshPayload));
      console.log('[mero-js doTokenRefresh] access_token length:', refreshPayload.access_token?.length);
      console.log('[mero-js doTokenRefresh] refresh_token length:', refreshPayload.refresh_token?.length);
      const response = await this.authClient.refreshToken(refreshPayload);

      // Extract expiry from JWT (more reliable than response.expires_in)
      let expiresAt: number;
      try {
        const payload = JSON.parse(atob(response.access_token.split('.')[1]));
        expiresAt = payload.exp * 1000; // JWT exp is in seconds, convert to ms
        console.log('[mero-js] Extracted exp from JWT:', payload.exp, '-> expires_at:', expiresAt);
      } catch (e) {
        // Fallback to response.expires_in if JWT parsing fails
        expiresAt = Date.now() + (response.expires_in || 3600) * 1000;
        console.warn('[mero-js] Failed to parse JWT, using expires_in fallback:', expiresAt);
      }

      this.tokenData = {
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        expires_at: expiresAt,
      };

      // Persist to storage if provided
      if (this.tokenStorage) {
        await this.tokenStorage.set(this.tokenData);
      }

      return this.tokenData;
    } catch (error) {
      console.error('[mero-js] Token refresh failed:', error);
      
      // Check if it's an HTTP error with status code
      const httpError = error as { status?: number; body?: string; message?: string };
      const status = httpError?.status;
      const errorBody = httpError?.body || httpError?.message || '';
      
      if (status) {
        console.error('[mero-js] Refresh error status:', status);
        console.error('[mero-js] Refresh error body:', errorBody);
      }
      
      // Special case: server says "Access token still valid"
      // This means the token IS valid but some other endpoint returned 401
      // Don't clear tokens, don't retry - something else is wrong
      if (errorBody.includes('still valid') || errorBody.includes('token valid')) {
        console.warn('[mero-js] Server says token is still valid - NOT clearing tokens');
        console.warn('[mero-js] This usually means the 401 came from a different issue (wrong endpoint, missing header, etc.)');
        // Create a special error that the HTTP client won't retry
        const tokenValidError = new Error('Token is valid but request failed. Check Authorization header.');
        (tokenValidError as any).tokenStillValid = true;
        throw tokenValidError;
      }
      
      // On ANY 4XX error, tokens are invalid - clear them and require re-auth
      // This handles: 400 (bad request), 401 (unauthorized), 403 (forbidden), etc.
      if (status && status >= 400 && status < 500) {
        console.warn('[mero-js] Refresh failed with 4XX - clearing tokens, user must re-authenticate');
        await this.clearToken();
        throw new Error(`Session expired. Please log in again. (${status})`);
      }
      
      // On 5XX errors, don't clear tokens - might be transient server issue
      // User can retry later
      if (status && status >= 500) {
        console.warn('[mero-js] Refresh failed with 5XX - server error, keeping tokens');
        throw new Error(`Server error during refresh. Please try again later. (${status})`);
      }
      
      // Unknown error - clear tokens to be safe
      console.warn('[mero-js] Refresh failed with unknown error - clearing tokens');
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
   * Manually set the token data.
   * Use this when handling authentication externally (e.g., OAuth flows).
   * 
   * @param tokenData - The token data to set, or null to clear
   * @example
   * ```typescript
   * // After receiving tokens from external auth flow
   * await meroJs.setToken({
   *   access_token: 'eyJ...',
   *   refresh_token: 'eyJ...',
   *   expires_at: Date.now() + 3600000,
   * });
   * ```
   */
  public async setToken(tokenData: TokenData | null): Promise<void> {
    this.tokenData = tokenData;
    if (this.tokenStorage) {
      if (tokenData) {
        await this.tokenStorage.set(tokenData);
      } else {
        await this.tokenStorage.clear();
      }
    }
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
