import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MeroJs, createMeroJs } from './mero-js.js';
import { MemoryTokenStore } from './token-store/index.js';

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

vi.mock('./http-client/index.js', () => ({
  createBrowserHttpClient: vi.fn(() => mockHttpClient),
}));

vi.mock('./auth-api/index.js', () => ({
  createAuthApiClientFromHttpClient: vi.fn(() => mockAuthClient),
}));

vi.mock('./admin-api/index.js', () => ({
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
        timestamp: expect.any(Number),
        provider_data: {
          username: 'custom-user',
          password: 'custom-pass',
        },
      });

      expect(tokenData.access_token).toBe('mock-access-token');
    });

    it('omits permissions entirely when the caller does not ask for any', async () => {
      // The node ignores this field on POST /auth/token (scope comes from the
      // root key), so sending ['admin'] claimed a privilege the request never
      // actually requested — and would have become a real escalation the moment
      // core started honouring it.
      mockAuthClient.generateTokens.mockResolvedValue({
        data: { access_token: 'a', refresh_token: 'r' },
      });

      await meroJs.authenticate();

      const body = mockAuthClient.generateTokens.mock.calls[0][0];
      expect(body).not.toHaveProperty('permissions');
    });

    it('passes through the permissions and client name the caller supplies', async () => {
      mockAuthClient.generateTokens.mockResolvedValue({
        data: { access_token: 'a', refresh_token: 'r' },
      });

      await meroJs.authenticate(undefined, {
        permissions: ['context:list'],
        clientName: 'my-tool',
      });

      expect(mockAuthClient.generateTokens).toHaveBeenCalledWith(
        expect.objectContaining({
          client_name: 'my-tool',
          permissions: ['context:list'],
        }),
      );
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
      const { createBrowserHttpClient } = await import('./http-client/index.js');

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
        onAuthRevoked: expect.any(Function),
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
      const { createBrowserHttpClient } = await import('./http-client/index.js');

      meroJs = new MeroJs({
        baseUrl: 'http://localhost:3000',
      });

      expect(createBrowserHttpClient).toHaveBeenCalledWith({
        baseUrl: 'http://localhost:3000',
        getAuthToken: expect.any(Function),
        refreshToken: expect.any(Function),
        onTokenRefresh: expect.any(Function),
        onAuthRevoked: expect.any(Function),
        timeoutMs: 10000,
      });
    });

    it('should use custom timeout when provided', async () => {
      const { createBrowserHttpClient } = await import('./http-client/index.js');

      meroJs = new MeroJs({
        baseUrl: 'http://localhost:3000',
        timeoutMs: 30000,
      });

      expect(createBrowserHttpClient).toHaveBeenCalledWith({
        baseUrl: 'http://localhost:3000',
        getAuthToken: expect.any(Function),
        refreshToken: expect.any(Function),
        onTokenRefresh: expect.any(Function),
        onAuthRevoked: expect.any(Function),
        timeoutMs: 30000,
      });
    });
  });
  describe('Single-use refresh token rotation (core#3083)', () => {
    let store: MemoryTokenStore;

    const getTransportHooks = async (): Promise<any> => {
      const { createBrowserHttpClient } = await import('./http-client/index.js');
      return (createBrowserHttpClient as any).mock.calls[0][0];
    };

    beforeEach(async () => {
      store = new MemoryTokenStore();
      meroJs = new MeroJs({
        baseUrl: 'http://localhost:3000',
        credentials: {
          username: 'admin',
          password: 'admin123',
        },
        tokenStore: store,
      });

      mockAuthClient.generateTokens.mockResolvedValue({
        data: { access_token: 'access-1', refresh_token: 'refresh-1' },
      });
      await meroJs.authenticate();
    });

    it('should issue exactly one /auth/refresh call for concurrent 401 refreshes', async () => {
      let resolveRefresh: (value: unknown) => void = () => {};
      mockAuthClient.refreshToken.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve;
          }),
      );

      const { refreshToken } = await getTransportHooks();

      // Two in-flight requests both 401 and both ask the transport to refresh
      const first = refreshToken();
      const second = refreshToken();

      resolveRefresh({
        data: { access_token: 'access-2', refresh_token: 'refresh-2' },
      });
      const [firstToken, secondToken] = await Promise.all([first, second]);

      // Replaying the consumed refresh token would revoke the whole family
      expect(mockAuthClient.refreshToken).toHaveBeenCalledTimes(1);
      expect(firstToken).toBe('access-2');
      expect(secondToken).toBe('access-2');
    });

    it('should persist the rotated refresh token to the token store', async () => {
      mockAuthClient.refreshToken.mockResolvedValue({
        data: { access_token: 'access-2', refresh_token: 'refresh-2' },
      });

      await (meroJs as any).performTokenRefresh();

      expect(mockAuthClient.refreshToken).toHaveBeenCalledWith({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
      });
      expect(meroJs.getTokenData()?.refresh_token).toBe('refresh-2');
      expect(store.getTokens()?.refresh_token).toBe('refresh-2');
    });

    it('should prefer the stored refresh token over a stale in-memory one', async () => {
      // Another instance sharing this store rotated the refresh token
      store.setTokens({
        access_token: 'access-1',
        refresh_token: 'refresh-1b',
        expires_at: Date.now() + 3600_000,
      });

      mockAuthClient.refreshToken.mockResolvedValue({
        data: { access_token: 'access-2', refresh_token: 'refresh-2' },
      });

      await (meroJs as any).performTokenRefresh();

      expect(mockAuthClient.refreshToken).toHaveBeenCalledWith({
        access_token: 'access-1',
        refresh_token: 'refresh-1b',
      });
    });

    it('should adopt a bundle another tab already rotated without calling /auth/refresh', async () => {
      store.setTokens({
        access_token: 'access-2',
        refresh_token: 'refresh-2',
        expires_at: Date.now() + 3600_000,
      });

      const tokens = await (meroJs as any).performTokenRefresh();

      expect(mockAuthClient.refreshToken).not.toHaveBeenCalled();
      expect(tokens.access_token).toBe('access-2');
      expect(meroJs.getTokenData()?.refresh_token).toBe('refresh-2');
    });

    it('should serialize the refresh through navigator.locks when available', async () => {
      const request = vi.fn((_name: string, cb: () => Promise<unknown>) => cb());
      vi.stubGlobal('navigator', { locks: { request } });

      mockAuthClient.refreshToken.mockResolvedValue({
        data: { access_token: 'access-2', refresh_token: 'refresh-2' },
      });

      try {
        await (meroJs as any).performTokenRefresh();
      } finally {
        vi.unstubAllGlobals();
      }

      expect(request).toHaveBeenCalledWith(
        'mero-js:token-refresh',
        expect.any(Function),
      );
      expect(mockAuthClient.refreshToken).toHaveBeenCalledTimes(1);
    });

    it('should clear tokens when the transport reports a revoked token family', async () => {
      const { onAuthRevoked } = await getTransportHooks();

      await onAuthRevoked();

      expect(meroJs.isAuthenticated()).toBe(false);
      expect(meroJs.getTokenData()).toBeNull();
      expect(store.getTokens()).toBeNull();
    });

    it('should notify the app hook after clearing, and survive it throwing', async () => {
      // Assert on the recorded state, not inside the callback: the SDK swallows
      // whatever the callback throws, including a failed expect().
      let authenticatedWhenCalled: boolean | null = null;
      const onAuthRevoked = vi.fn(() => {
        authenticatedWhenCalled = app.isAuthenticated();
        throw new Error('re-login screen exploded');
      });
      const app = new MeroJs({
        baseUrl: 'http://localhost:3000',
        tokenStore: new MemoryTokenStore(),
        onAuthRevoked,
      });
      app.setTokenData({
        access_token: 'a',
        refresh_token: 'r',
        expires_at: Date.now() + 3600_000,
      });

      const { createBrowserHttpClient } = await import('./http-client/index.js');
      const hooks = (createBrowserHttpClient as any).mock.calls.at(-1)[0];
      await hooks.onAuthRevoked();

      expect(onAuthRevoked).toHaveBeenCalledTimes(1);
      // The tokens are gone before the app hears about it.
      expect(authenticatedWhenCalled).toBe(false);
      expect(app.isAuthenticated()).toBe(false);
    });
  });
});
