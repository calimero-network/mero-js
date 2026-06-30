import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MeroJs, createMeroJs, TokenReuseError } from './mero-js';
import { HTTPError } from './http-client';
import { MemoryTokenStore } from './token-store';

/** Build an unsigned JWT carrying the given claims (for decode-only assertions). */
function makeJwt(claims: Record<string, unknown>): string {
  const b64url = (o: unknown): string =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(claims)}.fakesig`;
}

/** An HTTPError mimicking core's refresh-reuse response. */
function reuseHttpError(): HTTPError {
  return new HTTPError(401, 'Unauthorized', 'https://node/auth/refresh',
    new Headers([['x-auth-error', 'token_reuse']]), '');
}

// Mock the HTTP client and API clients
const mockHttpClient = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

const mockAuthClient = {
  getHealth: vi.fn(),
  getIdentity: vi.fn(),
  getProviders: vi.fn(),
  generateTokens: vi.fn(),
  refreshToken: vi.fn(),
  validateToken: vi.fn(),
  listRootKeys: vi.fn(),
  getKeyPermissions: vi.fn(),
  createKey: vi.fn(),
  deleteKey: vi.fn(),
  getClientKeys: vi.fn(),
  generateClientKey: vi.fn(),
  deleteClient: vi.fn(),
  revokeToken: vi.fn(),
  getAuthStatus: vi.fn(),
};

const mockAdminClient = {
  healthCheck: vi.fn(),
  isAuthed: vi.fn(),
  createContext: vi.fn(),
  getContexts: vi.fn(),
  getContext: vi.fn(),
  deleteContext: vi.fn(),
  uploadBlob: vi.fn(),
  listBlobs: vi.fn(),
  getBlob: vi.fn(),
  deleteBlob: vi.fn(),
  createAlias: vi.fn(),
  listAliases: vi.fn(),
  getAlias: vi.fn(),
  deleteAlias: vi.fn(),
  getNetworkPeers: vi.fn(),
  getNetworkStats: vi.fn(),
  getNetworkConfig: vi.fn(),
  updateNetworkConfig: vi.fn(),
  getSystemInfo: vi.fn(),
  getSystemLogs: vi.fn(),
  getSystemMetrics: vi.fn(),
  restartSystem: vi.fn(),
  shutdownSystem: vi.fn(),
  installApplication: vi.fn(),
  installDevApplication: vi.fn(),
  uninstallApplication: vi.fn(),
  listApplications: vi.fn(),
  getApplication: vi.fn(),
};

vi.mock('./http-client', async (importActual) => {
  const actual = await importActual<typeof import('./http-client')>();
  return {
    ...actual,
    createBrowserHttpClient: vi.fn(() => mockHttpClient),
  };
});

vi.mock('./auth-api', () => ({
  createAuthApiClientFromHttpClient: vi.fn(() => mockAuthClient),
}));

vi.mock('./admin-api', () => ({
  createAdminApiClientFromHttpClient: vi.fn(() => mockAdminClient),
}));

describe('MeroJs SDK', () => {
  let meroJs: MeroJs;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should create MeroJs instance with default config', () => {
      const config = {
        baseUrl: 'http://localhost:3000',
        credentials: {
          username: 'admin',
          password: 'admin123',
        },
      };

      meroJs = new MeroJs(config);

      expect(meroJs).toBeDefined();
      expect(meroJs.auth).toBeDefined();
      expect(meroJs.admin).toBeDefined();
      expect(meroJs.isAuthenticated()).toBe(false);
    });

    it('should create MeroJs instance with custom config', () => {
      const config = {
        baseUrl: 'http://localhost:8080',
        timeoutMs: 15000,
      };

      meroJs = new MeroJs(config);

      expect(meroJs).toBeDefined();
      expect(meroJs.isAuthenticated()).toBe(false);
    });
  });

  describe('createMeroJs factory', () => {
    it('should create MeroJs instance using factory function', () => {
      const config = {
        baseUrl: 'http://localhost:3000',
      };

      meroJs = createMeroJs(config);

      expect(meroJs).toBeDefined();
      expect(meroJs.auth).toBeDefined();
      expect(meroJs.admin).toBeDefined();
    });
  });

  describe('Authentication', () => {
    beforeEach(() => {
      meroJs = new MeroJs({
        baseUrl: 'http://localhost:3000',
        credentials: {
          username: 'admin',
          password: 'admin123',
        },
      });
    });

    it('should authenticate successfully', async () => {
      const mockTokenResponse = {
        data: {
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
        },
      };

      mockAuthClient.generateTokens.mockResolvedValue(mockTokenResponse);

      const tokenData = await meroJs.authenticate();

      expect(mockAuthClient.generateTokens).toHaveBeenCalledWith({
        auth_method: 'user_password',
        public_key: 'admin',
        client_name: 'mero-js-sdk',
        permissions: ['admin'],
        timestamp: expect.any(Number),
        provider_data: {
          username: 'admin',
          password: 'admin123',
        },
      });

      expect(tokenData).toEqual({
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_at: expect.any(Number),
      });

      expect(meroJs.isAuthenticated()).toBe(true);
    });

    it('should authenticate with custom credentials', async () => {
      const mockTokenResponse = {
        data: {
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
        },
      };

      mockAuthClient.generateTokens.mockResolvedValue(mockTokenResponse);

      const tokenData = await meroJs.authenticate({
        username: 'custom-user',
        password: 'custom-pass',
      });

      expect(mockAuthClient.generateTokens).toHaveBeenCalledWith({
        auth_method: 'user_password',
        public_key: 'custom-user',
        client_name: 'mero-js-sdk',
        permissions: ['admin'],
        timestamp: expect.any(Number),
        provider_data: {
          username: 'custom-user',
          password: 'custom-pass',
        },
      });

      expect(tokenData.access_token).toBe('mock-access-token');
    });

    it('should throw error when authentication fails', async () => {
      mockAuthClient.generateTokens.mockRejectedValue(new Error('Auth failed'));

      await expect(meroJs.authenticate()).rejects.toThrow(
        'Authentication failed: Auth failed',
      );
    });

    it('should throw error when no credentials provided', async () => {
      const meroJsNoCreds = new MeroJs({
        baseUrl: 'http://localhost:3000',
      });

      await expect(meroJsNoCreds.authenticate()).rejects.toThrow(
        'No credentials provided for authentication',
      );
    });
  });

  describe('Token Management', () => {
    beforeEach(() => {
      meroJs = new MeroJs({
        baseUrl: 'http://localhost:3000',
        credentials: {
          username: 'admin',
          password: 'admin123',
        },
      });
    });

    it('should clear token', () => {
      meroJs.clearToken();
      expect(meroJs.isAuthenticated()).toBe(false);
    });

    it('should get token data when not authenticated', () => {
      const tokenData = meroJs.getTokenData();
      expect(tokenData).toBeNull();
    });

    it('should get token data when authenticated', async () => {
      const mockTokenResponse = {
        data: {
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
        },
      };

      mockAuthClient.generateTokens.mockResolvedValue(mockTokenResponse);

      await meroJs.authenticate();

      const tokenData = meroJs.getTokenData();
      expect(tokenData).toBeDefined();
      expect(tokenData?.access_token).toBe('mock-access-token');
    });

    it('should return token as-is from getValidToken (no proactive refresh)', async () => {
      const mockTokenResponse = {
        data: {
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
        },
      };

      mockAuthClient.generateTokens.mockResolvedValue(mockTokenResponse);
      await meroJs.authenticate();

      // Even with expired token, getValidToken returns it — reactive refresh
      // happens in the HTTP client layer when it gets a 401
      const tokenData = meroJs.getTokenData()!;
      tokenData.expires_at = Date.now() - 1000;

      const validToken = await (meroJs as any).getValidToken();
      expect(validToken.access_token).toBe('mock-access-token');
      expect(mockAuthClient.refreshToken).not.toHaveBeenCalled();
    });

    it('should not clear token on refresh failure', async () => {
      const mockTokenResponse = {
        data: {
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
        },
      };

      mockAuthClient.generateTokens.mockResolvedValue(mockTokenResponse);
      await meroJs.authenticate();

      mockAuthClient.refreshToken.mockRejectedValue(
        new Error('Refresh failed'),
      );

      await expect((meroJs as any).performTokenRefresh()).rejects.toThrow(
        'Token refresh failed',
      );
      // Token should NOT be cleared — still valid until server says otherwise
      expect(meroJs.isAuthenticated()).toBe(true);
    });
  });

  describe('API Access', () => {
    beforeEach(() => {
      meroJs = new MeroJs({
        baseUrl: 'http://localhost:3000',
      });
    });

    it('should provide auth API client', () => {
      expect(meroJs.auth).toBeDefined();
      expect(typeof meroJs.auth.generateTokens).toBe('function');
      expect(typeof meroJs.auth.refreshToken).toBe('function');
      expect(typeof meroJs.auth.getHealth).toBe('function');
      expect(typeof meroJs.auth.listRootKeys).toBe('function');
    });

    it('should provide admin API client', () => {
      expect(meroJs.admin).toBeDefined();
      expect(typeof meroJs.admin.healthCheck).toBe('function');
      expect(typeof meroJs.admin.isAuthed).toBe('function');
      expect(typeof meroJs.admin.getContexts).toBe('function');
      expect(typeof meroJs.admin.listBlobs).toBe('function');
    });
  });

  describe('HTTP Client Integration', () => {
    it('should pass auth token to HTTP client', async () => {
      const { createBrowserHttpClient } = await import('./http-client');

      meroJs = new MeroJs({
        baseUrl: 'http://localhost:3000',
        credentials: {
          username: 'admin',
          password: 'admin123',
        },
      });

      // Mock authentication
      const mockTokenResponse = {
        data: {
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
        },
      };

      mockAuthClient.generateTokens.mockResolvedValue(mockTokenResponse);
      await meroJs.authenticate();

      // Verify HTTP client was created with getAuthToken function
      expect(createBrowserHttpClient).toHaveBeenCalledWith({
        baseUrl: 'http://localhost:3000',
        getAuthToken: expect.any(Function),
        refreshToken: expect.any(Function),
        onTokenRefresh: expect.any(Function),
        timeoutMs: 10000,
      });

      // Test that getAuthToken returns the token
      const getAuthToken = (createBrowserHttpClient as any).mock.calls[0][0]
        .getAuthToken;
      const token = await getAuthToken();
      expect(token).toBe('mock-access-token');
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      meroJs = new MeroJs({
        baseUrl: 'http://localhost:3000',
        credentials: {
          username: 'admin',
          password: 'admin123',
        },
      });
    });

    it('should handle authentication errors gracefully', async () => {
      mockAuthClient.generateTokens.mockRejectedValue(
        new Error('Network error'),
      );

      await expect(
        meroJs.authenticate({
          username: 'admin',
          password: 'admin123',
        }),
      ).rejects.toThrow('Authentication failed: Network error');
    });

    it('should handle refresh token errors gracefully', async () => {
      // First authenticate successfully
      const mockTokenResponse = {
        data: {
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
        },
      };

      mockAuthClient.generateTokens.mockResolvedValue(mockTokenResponse);
      await meroJs.authenticate();

      // Mock refresh failure
      mockAuthClient.refreshToken.mockRejectedValue(
        new Error('Invalid refresh token'),
      );

      // performTokenRefresh throws but does NOT clear token
      await expect((meroJs as any).performTokenRefresh()).rejects.toThrow(
        'Token refresh failed: Invalid refresh token',
      );
      // Token is NOT cleared — reactive refresh is handled by HTTP client
      expect(meroJs.isAuthenticated()).toBe(true);
    });
  });

  describe('Configuration', () => {
    it('should use default timeout when not provided', async () => {
      const { createBrowserHttpClient } = await import('./http-client');

      meroJs = new MeroJs({
        baseUrl: 'http://localhost:3000',
      });

      expect(createBrowserHttpClient).toHaveBeenCalledWith({
        baseUrl: 'http://localhost:3000',
        getAuthToken: expect.any(Function),
        refreshToken: expect.any(Function),
        onTokenRefresh: expect.any(Function),
        timeoutMs: 10000,
      });
    });

    it('should use custom timeout when provided', async () => {
      const { createBrowserHttpClient } = await import('./http-client');

      meroJs = new MeroJs({
        baseUrl: 'http://localhost:3000',
        timeoutMs: 30000,
      });

      expect(createBrowserHttpClient).toHaveBeenCalledWith({
        baseUrl: 'http://localhost:3000',
        getAuthToken: expect.any(Function),
        refreshToken: expect.any(Function),
        onTokenRefresh: expect.any(Function),
        timeoutMs: 30000,
      });
    });
  });

  describe('Refresh-reuse handling (v8)', () => {
    beforeEach(async () => {
      meroJs = new MeroJs({
        baseUrl: 'http://localhost:3000',
        credentials: { username: 'admin', password: 'admin123' },
      });
      mockAuthClient.generateTokens.mockResolvedValue({
        data: { access_token: 'access-1', refresh_token: 'refresh-1' },
      });
      await meroJs.authenticate();
    });

    it('clears tokens and throws TokenReuseError on a reuse (401 token_reuse) error', async () => {
      mockAuthClient.refreshToken.mockRejectedValue(reuseHttpError());

      await expect((meroJs as any).performTokenRefresh()).rejects.toBeInstanceOf(
        TokenReuseError,
      );
      // Terminal: tokens cleared, forcing re-auth.
      expect(meroJs.isAuthenticated()).toBe(false);
      expect(meroJs.getTokenData()).toBeNull();
    });

    it('clears tokens on a 403 from the refresh endpoint', async () => {
      mockAuthClient.refreshToken.mockRejectedValue(
        new HTTPError(403, 'Forbidden', 'https://node/auth/refresh', new Headers(), ''),
      );

      await expect((meroJs as any).performTokenRefresh()).rejects.toBeInstanceOf(
        TokenReuseError,
      );
      expect(meroJs.isAuthenticated()).toBe(false);
    });

    it('keeps tokens on a transient/network error and never marks it terminal', async () => {
      mockAuthClient.refreshToken.mockRejectedValue(new Error('network down'));

      await expect((meroJs as any).performTokenRefresh()).rejects.toThrow(
        'Token refresh failed: network down',
      );
      // Transient: access token may still be valid — tokens retained.
      expect(meroJs.isAuthenticated()).toBe(true);
      expect(meroJs.getTokenData()?.refresh_token).toBe('refresh-1');
    });

    it('persists the rotated pair to the store before returning', async () => {
      mockAuthClient.refreshToken.mockResolvedValue({
        data: { access_token: 'access-2', refresh_token: 'refresh-2' },
      });

      const result = await (meroJs as any).performTokenRefresh();
      expect(result.refresh_token).toBe('refresh-2');
      expect(meroJs.getTokenData()).toEqual(
        expect.objectContaining({ access_token: 'access-2', refresh_token: 'refresh-2' }),
      );
    });

    it('single-flights concurrent refreshes (one network call)', async () => {
      mockAuthClient.refreshToken.mockResolvedValue({
        data: { access_token: 'access-2', refresh_token: 'refresh-2' },
      });

      const [a, b] = await Promise.all([
        (meroJs as any).refreshToken(),
        (meroJs as any).refreshToken(),
      ]);

      expect(mockAuthClient.refreshToken).toHaveBeenCalledTimes(1);
      expect(a.refresh_token).toBe('refresh-2');
      expect(b.refresh_token).toBe('refresh-2');
    });
  });

  describe('Cross-tab adoption (v8)', () => {
    it('adopts a peer-rotated pair from the store instead of replaying a consumed token', async () => {
      const store = new MemoryTokenStore();
      meroJs = new MeroJs({
        baseUrl: 'http://localhost:3000',
        credentials: { username: 'admin', password: 'admin123' },
        tokenStore: store,
      });
      mockAuthClient.generateTokens.mockResolvedValue({
        data: { access_token: 'access-1', refresh_token: 'refresh-1' },
      });
      await meroJs.authenticate();

      // Simulate another tab having already rotated the shared pair.
      store.setTokens({
        access_token: 'peer-access',
        refresh_token: 'peer-refresh',
        expires_at: Date.now() + 3600_000,
      });

      const result = await (meroJs as any).refreshUnderCoordination();

      expect(mockAuthClient.refreshToken).not.toHaveBeenCalled();
      expect(result.refresh_token).toBe('peer-refresh');
      expect(meroJs.getTokenData()?.access_token).toBe('peer-access');
    });
  });

  describe('Permission-shrink awareness (v8, #10)', () => {
    it('surfaces the EFFECTIVE granted permissions from the issued access token', () => {
      meroJs = new MeroJs({ baseUrl: 'http://localhost:3000' });
      meroJs.setTokenData({
        access_token: makeJwt({ token_type: 'access', permissions: ['context:read'] }),
        refresh_token: 'r',
        expires_at: Date.now() + 3600_000,
      });
      // Requested admin earlier, but the node granted only read.
      expect(meroJs.getGrantedPermissions()).toEqual(['context:read']);
    });

    it('returns [] when unauthenticated', () => {
      meroJs = new MeroJs({ baseUrl: 'http://localhost:3000' });
      expect(meroJs.getGrantedPermissions()).toEqual([]);
    });
  });

  describe('token_type assertion (v8, #1)', () => {
    it('treats a refresh token in the access slot as unauthenticated', async () => {
      meroJs = new MeroJs({ baseUrl: 'http://localhost:3000' });
      meroJs.setTokenData({
        access_token: makeJwt({ token_type: 'refresh' }),
        refresh_token: 'r',
        expires_at: Date.now() + 3600_000,
      });

      const valid = await (meroJs as any).getValidToken();
      expect(valid).toBeNull();
    });

    it('allows a proper access token through', async () => {
      meroJs = new MeroJs({ baseUrl: 'http://localhost:3000' });
      meroJs.setTokenData({
        access_token: makeJwt({ token_type: 'access' }),
        refresh_token: 'r',
        expires_at: Date.now() + 3600_000,
      });

      const valid = await (meroJs as any).getValidToken();
      expect(valid?.access_token).toBeDefined();
    });
  });
});
