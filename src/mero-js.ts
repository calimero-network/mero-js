import { createBrowserHttpClient, isRefreshReuseError } from './http-client';
import { createAuthApiClientFromHttpClient } from './auth-api';
import { createAdminApiClientFromHttpClient } from './admin-api';
import type { AuthApiClient } from './auth-api';
import type { AdminApiClient } from './admin-api';
import type { HttpClient } from './http-client';
import type { TokenStore } from './token-store';
import { parseAuthCallback, buildAuthLoginUrl } from './auth';
import type { AuthCallbackResult, AuthLoginOptions } from './auth';
import { RpcClient } from './rpc';
import { SseClient } from './events/sse';
import { WsClient } from './events/ws';
import {
  expiresAtFromJwt,
  permissionsFromJwt,
  isRefreshTokenInAccessSlot,
} from './jwt';
import { withRefreshLock } from './refresh-lock';

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
  /** Request credentials mode for fetch (omit, same-origin, include) */
  requestCredentials?: RequestCredentials;
  /** Optional token store for persistence */
  tokenStore?: TokenStore;
}

export interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

/**
 * Terminal error thrown when the node reports refresh-token REUSE (a consumed /
 * rotated refresh token was replayed). On this error the SDK has already cleared
 * its tokens and the token family is revoked server-side — the caller must force
 * a fresh interactive authentication. Distinguishable via `instanceof` (and by
 * `name === 'TokenReuseError'` across module/bundle boundaries).
 */
export class TokenReuseError extends Error {
  name = 'TokenReuseError' as const;

  constructor(message = 'Refresh token reuse detected; re-authentication required') {
    super(message);
  }
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
  private tokenStore: TokenStore | null;
  /** Cross-tab Web Locks name; same node URL => same lock across tabs. */
  private readonly refreshLockName: string;
  private rpcClient: RpcClient | null = null;
  private sseClient: SseClient | null = null;
  private wsClient: WsClient | null = null;
  private wsWarned = false;

  constructor(config: MeroJsConfig) {
    this.config = {
      timeoutMs: 10000,
      ...config,
    };

    this.tokenStore = config.tokenStore ?? null;
    this.refreshLockName = `mero-js:token-refresh:${this.config.baseUrl}`;

    // Restore tokens from store if available
    if (this.tokenStore) {
      this.tokenData = this.tokenStore.getTokens();
    }

    // Create HTTP client with token management
    // For Tauri, explicitly set credentials to 'omit' to avoid network errors
    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    this.httpClient = createBrowserHttpClient({
      baseUrl: this.config.baseUrl,
      getAuthToken: async () => {
        const token = await this.getValidToken();
        return token?.access_token || '';
      },
      refreshToken: async () => {
        const refreshed = await this.refreshToken();
        return refreshed.access_token;
      },
      onTokenRefresh: async (newToken: string) => {
        if (this.tokenData) {
          this.tokenData.access_token = newToken;
          this.tokenStore?.setTokens(this.tokenData);
        }
      },
      timeoutMs: this.config.timeoutMs,
      credentials: this.config.requestCredentials ?? (isTauri ? 'omit' : undefined),
    });

    // Create API clients
    this.authClient = createAuthApiClientFromHttpClient(this.httpClient, {
      baseUrl: this.config.baseUrl,
      getAuthToken: async () => {
        const token = await this.getValidToken();
        return token?.access_token || '';
      },
      timeoutMs: this.config.timeoutMs,
    });

    this.adminClient = createAdminApiClientFromHttpClient(this.httpClient, {
      baseUrl: this.config.baseUrl,
      getAuthToken: async () => {
        const token = await this.getValidToken();
        return token?.access_token || '';
      },
      timeoutMs: this.config.timeoutMs,
    });
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
   * Get the RPC client (lazy initialized)
   */
  get rpc(): RpcClient {
    if (!this.rpcClient) {
      this.rpcClient = new RpcClient({ httpClient: this.httpClient });
    }
    return this.rpcClient;
  }

  /**
   * Get the SSE event client (lazy initialized)
   */
  get events(): SseClient {
    if (!this.sseClient) {
      this.sseClient = new SseClient({
        baseUrl: this.config.baseUrl,
        getAuthToken: async () => {
          const token = await this.getValidToken();
          return token?.access_token || '';
        },
      });
    }
    return this.sseClient;
  }

  /**
   * Get the WebSocket event client (lazy initialized).
   * @experimental Use `events` (SSE) for production. WsClient is experimental.
   */
  get ws(): WsClient {
    if (!this.wsWarned) {
      this.wsWarned = true;
      console.warn('[mero-js] WsClient is experimental. Use mero.events (SSE) for production.');
    }
    if (!this.wsClient) {
      this.wsClient = new WsClient({
        baseUrl: this.config.baseUrl,
        getAuthToken: async () => {
          const token = await this.getValidToken();
          return token?.access_token || '';
        },
      });
    }
    return this.wsClient;
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

      const response = await this.authClient.generateTokens(requestBody);

      const accessToken = response.data.access_token;
      this.tokenData = {
        access_token: accessToken,
        refresh_token: response.data.refresh_token,
        expires_at: expiresAtFromJwt(accessToken, Date.now() + 3600_000),
      };

      this.tokenStore?.setTokens(this.tokenData);

      return this.tokenData;
    } catch (error) {
      throw new Error(
        `Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Get a valid token. Returns the current token as-is.
   * The server rejects refresh attempts while the access token is still valid,
   * so we never proactively refresh. Instead, the WebHttpClient handles 401
   * responses reactively via the refreshToken transport hook.
   */
  private async getValidToken(): Promise<TokenData | null> {
    // Defense-in-depth (#1): never present a refresh token as a bearer. If a
    // refresh token somehow landed in the access slot, treat as unauthenticated.
    if (this.tokenData && isRefreshTokenInAccessSlot(this.tokenData.access_token)) {
      return null;
    }
    return this.tokenData;
  }

  /**
   * Refresh the access token. Dedups concurrent refreshes within this instance
   * (single-flight) and, across tabs/instances, serializes through the Web Locks
   * API when available so a server-rotation 401 wave does not stampede the
   * refresh endpoint and replay consumed tokens.
   */
  private async refreshToken(): Promise<TokenData> {
    if (!this.tokenData?.refresh_token) {
      throw new Error('No refresh token available');
    }

    // Per-instance single-flight: collapse concurrent refreshes in this tab.
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = withRefreshLock(this.refreshLockName, () =>
      this.refreshUnderCoordination(),
    );

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Runs inside the cross-tab lock (or jitter fallback). Re-reads the shared
   * store first: if a peer already rotated the pair we ADOPT it instead of
   * replaying our now-consumed refresh token (which would trip reuse detection).
   */
  private async refreshUnderCoordination(): Promise<TokenData> {
    const startedWith = this.tokenData?.refresh_token;
    const stored = this.tokenStore?.getTokens() ?? null;
    if (stored?.refresh_token && stored.refresh_token !== startedWith) {
      // A concurrent tab/instance already rotated; take its fresh tokens.
      this.tokenData = stored;
      return stored;
    }
    return this.performTokenRefresh();
  }

  /**
   * Perform the actual token refresh against the node.
   *
   * On success the rotated pair is persisted to the store BEFORE it is returned,
   * so no subsequent request can fire with the now-consumed refresh token.
   *
   * On failure the error is classified (see {@link isRefreshReuseError}):
   *  - reuse / invalid-refresh (terminal): clear tokens + force re-auth, no retry.
   *  - transient / network: keep tokens (the access token may still be valid),
   *    surface to caller, never auto-retry the same refresh token.
   */
  private async performTokenRefresh(): Promise<TokenData> {
    if (!this.tokenData?.refresh_token) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await this.authClient.refreshToken({
        access_token: this.tokenData.access_token,
        refresh_token: this.tokenData.refresh_token,
      });

      const accessToken = response.data.access_token;
      const next: TokenData = {
        access_token: accessToken,
        refresh_token: response.data.refresh_token,
        expires_at: expiresAtFromJwt(accessToken, Date.now() + 3600_000),
      };

      // Persist the rotated pair BEFORE handing the token back / releasing the
      // lock, so a peer that wakes up next reads the new refresh token.
      this.tokenData = next;
      this.tokenStore?.setTokens(this.tokenData);

      return this.tokenData;
    } catch (error) {
      if (isRefreshReuseError(error)) {
        // Terminal: the node denylisted this refresh token and revoked the
        // family. Retrying replays a consumed token — clear and force re-auth.
        this.clearToken();
        throw new TokenReuseError();
      }
      // Transient/network error — the access token may still be valid. Keep
      // tokens and surface to the caller; never auto-retry the same refresh token.
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
    this.tokenStore?.clear();
  }

  /**
   * Check if the SDK is authenticated
   */
  public isAuthenticated(): boolean {
    return this.tokenData !== null;
  }

  /**
   * Set token data directly (e.g., from auth callback).
   * If `expires_at` is missing or 0, attempts to parse the JWT exp claim,
   * falling back to 1 hour from now.
   */
  public setTokenData(data: TokenData): void {
    const expiresAt = data.expires_at || expiresAtFromJwt(data.access_token, Date.now() + 3600_000);
    this.tokenData = { ...data, expires_at: expiresAt };
    this.tokenStore?.setTokens(this.tokenData);
  }

  /**
   * Get the current token data (for debugging)
   */
  public getTokenData(): TokenData | null {
    return this.tokenData;
  }

  /**
   * The EFFECTIVE permissions granted by the current access token (#10).
   *
   * Callers must NOT assume requested permissions == granted: core re-derives
   * permissions from the live key at issue time and may grant FEWER than were
   * requested. This decodes the issued access token's `permissions` claim so
   * callers can read what they actually got. Returns `[]` when unauthenticated
   * or the token carries no decodable permissions.
   */
  public getGrantedPermissions(): string[] {
    if (!this.tokenData?.access_token) {
      return [];
    }
    return permissionsFromJwt(this.tokenData.access_token);
  }

  /**
   * Close all event connections and clean up resources
   */
  public close(): void {
    this.sseClient?.close();
    this.wsClient?.close();
  }

  /**
   * Parse an auth callback URL hash fragment (static utility)
   */
  static parseAuthCallback(url: string): AuthCallbackResult | null {
    return parseAuthCallback(url);
  }

  /**
   * Build an auth login URL (static utility)
   */
  static buildAuthLoginUrl(nodeUrl: string, opts: AuthLoginOptions): string {
    return buildAuthLoginUrl(nodeUrl, opts);
  }
}

/**
 * Create a new MeroJs SDK instance
 */
export function createMeroJs(config: MeroJsConfig): MeroJs {
  return new MeroJs(config);
}
