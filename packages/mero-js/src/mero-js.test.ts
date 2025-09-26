import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MeroJs, createMeroJs } from './mero-js';

// Mock token storage
const mockTokenStorage = {
  getToken: vi.fn().mockResolvedValue(null),
  setToken: vi.fn().mockResolvedValue(undefined),
  clearToken: vi.fn().mockResolvedValue(undefined),
  isAvailable: vi.fn().mockResolvedValue(true),
};

// Mock the token storage factory
vi.mock('./token-storage', () => ({
  createDefaultTokenStorage: () => mockTokenStorage,
  createTokenStorage: () => mockTokenStorage,
}));

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

vi.mock('./http-client', () => ({
  createBrowserHttpClient: vi.fn(() => mockHttpClient),
  createNodeHttpClient: vi.fn(() => mockHttpClient),
}));

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
    // Reset token storage mock
    mockTokenStorage.getToken.mockResolvedValue(null);
    mockTokenStorage.setToken.mockResolvedValue(undefined);
    mockTokenStorage.clearToken.mockResolvedValue(undefined);
    mockTokenStorage.isAvailable.mockResolvedValue(true);
  });

  describe('Constructor', () => {
    it('should create MeroJs instance with default config', async () => {
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
      expect(await meroJs.isAuthenticated()).toBe(false);
    });

    it('should create MeroJs instance with custom config', async () => {
      const config = {
        baseUrl: 'http://localhost:8080',
        timeoutMs: 15000,
      };

      meroJs = new MeroJs(config);

      expect(meroJs).toBeDefined();
      expect(await meroJs.isAuthenticated()).toBe(false);
    });
  });

  describe('createMeroJs factory', () => {
    it('should create MeroJs instance using factory function', async () => {
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

      // Mock token storage to return the token after authentication
      mockTokenStorage.getToken.mockResolvedValue(tokenData);
      expect(await meroJs.isAuthenticated()).toBe(true);
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
        'Authentication failed: Auth failed'
      );
    });

    it('should throw error when no credentials provided', async () => {
      const meroJsNoCreds = new MeroJs({
        baseUrl: 'http://localhost:3000',
      });

      await expect(meroJsNoCreds.authenticate()).rejects.toThrow(
        'No credentials provided for authentication'
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

    it('should clear token', async () => {
      await meroJs.clearToken();
      expect(await meroJs.isAuthenticated()).toBe(false);
    });

    it('should get token data when not authenticated', async () => {
      const tokenData = await meroJs.getTokenData();
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

      const authResult = await meroJs.authenticate();

      // Mock token storage to return the token
      mockTokenStorage.getToken.mockResolvedValue(authResult);

      const tokenData = await meroJs.getTokenData();
      expect(tokenData).toBeDefined();
      expect(tokenData?.access_token).toBe('mock-access-token');
    });

    it('should refresh token when expired', async () => {
      // First authenticate
      const mockTokenResponse = {
        data: {
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
        },
      };

      mockAuthClient.generateTokens.mockResolvedValue(mockTokenResponse);
      const authResult = await meroJs.authenticate();

      // Mock refresh response
      const mockRefreshResponse = {
        data: {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
        },
      };

      mockAuthClient.refreshToken.mockResolvedValue(mockRefreshResponse);

      // Mock token storage to return expired token
      const expiredToken = {
        ...authResult,
        expires_at: Date.now() - 1000, // Expired 1 second ago
      };
      mockTokenStorage.getToken.mockResolvedValue(expiredToken);

      // This should trigger a refresh
      const validToken = await (meroJs as any).getValidToken();

      expect(mockAuthClient.refreshToken).toHaveBeenCalledWith({
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
      });

      expect(validToken.access_token).toBe('new-access-token');
    });

    it('should clear token when refresh fails', async () => {
      // First authenticate
      const mockTokenResponse = {
        data: {
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
        },
      };

      mockAuthClient.generateTokens.mockResolvedValue(mockTokenResponse);
      const authResult = await meroJs.authenticate();

      // Mock refresh failure
      mockAuthClient.refreshToken.mockRejectedValue(
        new Error('Refresh failed')
      );

      // Mock token storage to return expired token
      const expiredToken = {
        ...authResult,
        expires_at: Date.now() - 1000, // Expired 1 second ago
      };
      mockTokenStorage.getToken.mockResolvedValue(expiredToken);

      // This should trigger a refresh and fail
      await expect((meroJs as any).getValidToken()).rejects.toThrow(
        'Token refresh failed: Refresh failed'
      );

      // Mock token storage to return null after refresh failure
      mockTokenStorage.getToken.mockResolvedValue(null);
      expect(await meroJs.isAuthenticated()).toBe(false);
    });
  });

  describe('API Access', () => {
    beforeEach(() => {
      meroJs = new MeroJs({
        baseUrl: 'http://localhost:3000',
      });
    });

    it('should provide auth API client', async () => {
      expect(meroJs.auth).toBeDefined();
      expect(typeof meroJs.auth.generateTokens).toBe('function');
      expect(typeof meroJs.auth.refreshToken).toBe('function');
      expect(typeof meroJs.auth.getHealth).toBe('function');
      expect(typeof meroJs.auth.listRootKeys).toBe('function');
    });

    it('should provide admin API client', async () => {
      expect(meroJs.admin).toBeDefined();
      expect(typeof meroJs.admin.healthCheck).toBe('function');
      expect(typeof meroJs.admin.isAuthed).toBe('function');
      expect(typeof meroJs.admin.getContexts).toBe('function');
      expect(typeof meroJs.admin.listBlobs).toBe('function');
    });
  });

  describe('HTTP Client Integration', () => {
    it('should pass auth token to HTTP client', async () => {
      const { createNodeHttpClient } = await import('./http-client');

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
      const authResult = await meroJs.authenticate();

      // Mock token storage to return the token
      mockTokenStorage.getToken.mockResolvedValue(authResult);

      // Verify HTTP client was created with getAuthToken function
      expect(createNodeHttpClient).toHaveBeenCalledWith({
        baseUrl: 'http://localhost:3000',
        getAuthToken: expect.any(Function),
        timeoutMs: 10000,
      });

      // Test that getAuthToken returns the token
      const getAuthToken = (createNodeHttpClient as any).mock.calls[0][0]
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
        new Error('Network error')
      );

      await expect(
        meroJs.authenticate({
          username: 'admin',
          password: 'admin123',
        })
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
      const authResult = await meroJs.authenticate();

      // Mock refresh failure
      mockAuthClient.refreshToken.mockRejectedValue(
        new Error('Invalid refresh token')
      );

      // Mock token storage to return expired token
      const expiredToken = {
        ...authResult,
        expires_at: Date.now() - 1000,
      };
      mockTokenStorage.getToken.mockResolvedValue(expiredToken);

      await expect((meroJs as any).getValidToken()).rejects.toThrow(
        'Token refresh failed: Invalid refresh token'
      );

      // Mock token storage to return null after refresh failure
      mockTokenStorage.getToken.mockResolvedValue(null);
      expect(await meroJs.isAuthenticated()).toBe(false);
    });
  });

  describe('Configuration', () => {
    it('should use default timeout when not provided', async () => {
      const { createNodeHttpClient } = await import('./http-client');

      meroJs = new MeroJs({
        baseUrl: 'http://localhost:3000',
      });

      expect(createNodeHttpClient).toHaveBeenCalledWith({
        baseUrl: 'http://localhost:3000',
        getAuthToken: expect.any(Function),
        timeoutMs: 10000,
      });
    });

    it('should use custom timeout when provided', async () => {
      const { createNodeHttpClient } = await import('./http-client');

      meroJs = new MeroJs({
        baseUrl: 'http://localhost:3000',
        timeoutMs: 30000,
      });

      expect(createNodeHttpClient).toHaveBeenCalledWith({
        baseUrl: 'http://localhost:3000',
        getAuthToken: expect.any(Function),
        timeoutMs: 30000,
      });
    });
  });
});
