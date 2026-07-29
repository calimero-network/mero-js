import { createBrowserHttpClient } from './http-client/index.js';
import { createAuthApiClientFromHttpClient } from './auth-api/index.js';
import { createAdminApiClientFromHttpClient } from './admin-api/index.js';
import type { AuthApiClient } from './auth-api/index.js';
import type { AdminApiClient } from './admin-api/index.js';
import type { HttpClient } from './http-client/index.js';
import type { TokenStore } from './token-store/index.js';
import { parseAuthCallback, buildAuthLoginUrl } from './auth/index.js';
import type { AuthCallbackResult, AuthLoginOptions } from './auth/index.js';
import { RpcClient } from './rpc/index.js';
import { SseClient } from './events/sse.js';
import { WsClient } from './events/ws.js';

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

/** Name of the Web Lock that serializes token refresh across tabs / webviews. */
const REFRESH_LOCK_NAME = 'mero-js:token-refresh';

/** Minimal structural view of the Web Locks API (not available in every runtime). */
interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

/** Returns `navigator.locks` when the runtime supports the Web Locks API. */
function getLockManager(): LockManagerLike | null {
  const nav = (globalThis as unknown as { navigator?: { locks?: LockManagerLike } }).navigator;
  const locks = nav?.locks;
  return locks && typeof locks.request === 'function' ? locks : null;
}

/** Try to extract `exp` (seconds) from a JWT, return ms timestamp or fallback. */
function expiresAtFromJwt(token: string, fallbackMs: number): number {
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      // JWT uses base64url encoding: replace -/_ with +// and add padding
      let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const payload = JSON.parse(atob(b64));
      if (typeof payload.exp === 'number') {
        return payload.exp * 1000;
      }
    }
  } catch {
    // not a JWT or can't parse
  }
  return fallbackMs;
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
        const refreshed = await this.performTokenRefresh();
        return refreshed.access_token;
      },
      onTokenRefresh: async (newToken: string) => {
        if (this.tokenData) {
          this.tokenData.access_token = newToken;
          this.tokenStore?.setTokens(this.tokenData);
        }
      },
      onAuthRevoked: () => {
        // The refresh-token family is gone (a single-use refresh token was
        // replayed, or the token was revoked). Nothing left to refresh with —
        // drop the bundle so the app can force a re-login.
        this.clearToken();
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
    return this.tokenData;
  }

  /**
   * Refresh the access token. Single-flight: every caller (including the HTTP
   * transport's 401 hook) goes through here.
   *
   * Refresh tokens are single-use (calimero-network/core#3083): each refresh
   * consumes the presented token and returns a new one, and replaying a consumed
   * token makes the server revoke the whole family. A refresh must therefore
   * happen exactly once per rotation, which needs three layers:
   *  - an in-process promise, so concurrent 401s in this instance share one call;
   *  - a Web Lock (when available), so other tabs/webviews don't refresh at the
   *    same time on the same stored token;
   *  - a re-read of the token store inside the lock, so a bundle that another
   *    instance already rotated is adopted instead of replaying a stale token.
   */
  private async performTokenRefresh(): Promise<TokenData> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // The access token that triggered this refresh. If the store holds a different
    // one by the time we get the lock, someone else already rotated for us.
    const triggeringAccessToken = this.tokenData?.access_token;

    const promise = this.withRefreshLock(() =>
      this.performTokenRefreshLocked(triggeringAccessToken),
    );
    this.refreshPromise = promise;

    try {
      return await promise;
    } finally {
      if (this.refreshPromise === promise) {
        this.refreshPromise = null;
      }
    }
  }

  /** Run `fn` under the cross-tab refresh lock, or directly if Web Locks are unavailable. */
  private withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
    const locks = getLockManager();
    return locks ? locks.request(REFRESH_LOCK_NAME, fn) : fn();
  }

  /**
   * Perform the actual token refresh. Runs with the refresh lock held.
   */
  private async performTokenRefreshLocked(
    triggeringAccessToken?: string,
  ): Promise<TokenData> {
    // Another instance/tab may have rotated the bundle while we were queued behind
    // the lock — the store, not our in-memory copy, is the source of truth.
    const stored = this.tokenStore?.getTokens() ?? null;
    if (stored?.refresh_token) {
      this.tokenData = stored;

      if (triggeringAccessToken && stored.access_token !== triggeringAccessToken) {
        // Someone else already refreshed. Reuse their bundle rather than replaying
        // our (now consumed) refresh token, which would revoke the family.
        return stored;
      }
    }

    if (!this.tokenData?.refresh_token) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await this.authClient.refreshToken({
        access_token: this.tokenData.access_token,
        refresh_token: this.tokenData.refresh_token,
      });

      const accessToken = response.data.access_token;
      this.tokenData = {
        access_token: accessToken,
        // The refresh token is rotated on every refresh — persist the new one or
        // the next refresh replays a consumed token.
        refresh_token: response.data.refresh_token,
        expires_at: expiresAtFromJwt(accessToken, Date.now() + 3600_000),
      };

      this.tokenStore?.setTokens(this.tokenData);

      return this.tokenData;
    } catch (error) {
      // Don't clear tokens on refresh failure — the access token may still be
      // valid (server rejects refresh while access token hasn't expired yet).
      // A genuinely dead family arrives as `x-auth-error: token_reuse` and is
      // handled by the onAuthRevoked transport hook. Let the caller handle this.
      throw new Error(
        `Token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Clear the current token
   */
  public clearToken(): void {
    this.refreshPromise = null;
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
