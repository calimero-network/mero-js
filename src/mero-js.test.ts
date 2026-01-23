import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MeroJs, createMeroJs } from './mero-js';

// Mock the HTTP client and API clients
const mockHttpClient = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

// Mock the new modular API clients
const mockAuthClient = {
  getHealth: vi.fn(),
  getIdentity: vi.fn(),
  getProviders: vi.fn(),
  getToken: vi.fn(), // Renamed from generateTokens
  refreshToken: vi.fn(),
  validateToken: vi.fn(),
  validateTokenGet: vi.fn(),
  listRootKeys: vi.fn(),
  getKeyPermissions: vi.fn(),
  createRootKey: vi.fn(),
  deleteRootKey: vi.fn(),
  listClientKeys: vi.fn(),
  generateClientKey: vi.fn(),
  deleteClientKey: vi.fn(),
  updateKeyPermissions: vi.fn(),
  revokeToken: vi.fn(),
  getMetrics: vi.fn(),
  getProtectedIdentity: vi.fn(),
  getChallenge: vi.fn(),
  getLogin: vi.fn(),
  getCallback: vi.fn(),
};

const mockAdminPublicClient = {
  health: vi.fn(),
  isAuthed: vi.fn(),
  getCertificate: vi.fn(),
};

const mockAdminApplicationsClient = {
  installApplication: vi.fn(),
  installDevApplication: vi.fn(),
  listApplications: vi.fn(),
  getApplication: vi.fn(),
  uninstallApplication: vi.fn(),
  listPackages: vi.fn(),
  listVersions: vi.fn(),
  getLatestVersion: vi.fn(),
};

const mockAdminContextsClient = {
  listContexts: vi.fn(),
  createContext: vi.fn(),
  getContext: vi.fn(),
  deleteContext: vi.fn(),
  getContextStorage: vi.fn(),
  getContextIdentities: vi.fn(),
  getContextIdentitiesOwned: vi.fn(),
  inviteToContext: vi.fn(),
  inviteToContextOpenInvitation: vi.fn(),
  inviteSpecializedNode: vi.fn(),
  joinContext: vi.fn(),
  joinContextByOpenInvitation: vi.fn(),
  updateContextApplication: vi.fn(),
  getContextsForApplication: vi.fn(),
  getContextsWithExecutorsForApplication: vi.fn(),
  getProxyContract: vi.fn(),
  syncContext: vi.fn(),
  syncContextById: vi.fn(),
};

const mockAdminClient = {
  public: mockAdminPublicClient,
  applications: mockAdminApplicationsClient,
  contexts: mockAdminContextsClient,
  proposals: {
    getProposals: vi.fn(),
    getProposal: vi.fn(),
    createAndApproveProposal: vi.fn(),
    approveProposal: vi.fn(),
    getNumberOfActiveProposals: vi.fn(),
    getNumberOfProposalApprovals: vi.fn(),
    getProposalApprovers: vi.fn(),
    getContextValue: vi.fn(),
    getContextStorageEntries: vi.fn(),
  },
  capabilities: {
    grantPermission: vi.fn(),
    revokePermission: vi.fn(),
  },
  identity: {
    generateContextIdentity: vi.fn(),
  },
  network: {
    getPeersCount: vi.fn(),
  },
  blobs: {
    uploadBlob: vi.fn(),
    listBlobs: vi.fn(),
    getBlob: vi.fn(),
    getBlobInfo: vi.fn(),
    deleteBlob: vi.fn(),
  },
  aliases: {
    createContextAlias: vi.fn(),
    createApplicationAlias: vi.fn(),
    createIdentityAlias: vi.fn(),
    lookupContextAlias: vi.fn(),
    lookupApplicationAlias: vi.fn(),
    lookupIdentityAlias: vi.fn(),
    listContextAliases: vi.fn(),
    listApplicationAliases: vi.fn(),
    listIdentityAliases: vi.fn(),
    deleteContextAlias: vi.fn(),
    deleteApplicationAlias: vi.fn(),
    deleteIdentityAlias: vi.fn(),
  },
  tee: {
    getTeeInfo: vi.fn(),
    attestTee: vi.fn(),
    verifyTeeQuote: vi.fn(),
  },
};

vi.mock('./http-client', () => ({
  createBrowserHttpClient: vi.fn(() => mockHttpClient),
}));

vi.mock('./api/auth/client', () => ({
  AuthApiClient: vi.fn(() => mockAuthClient),
}));

vi.mock('./api/admin/client', () => ({
  AdminApiClient: vi.fn(() => mockAdminClient),
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
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
      };

      mockAuthClient.getToken.mockResolvedValue(mockTokenResponse);

      const tokenData = await meroJs.authenticate();

      expect(mockAuthClient.getToken).toHaveBeenCalledWith({
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
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
      };

      mockAuthClient.getToken.mockResolvedValue(mockTokenResponse);

      const tokenData = await meroJs.authenticate({
        username: 'custom-user',
        password: 'custom-pass',
      });

      expect(mockAuthClient.getToken).toHaveBeenCalledWith({
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
      mockAuthClient.getToken.mockRejectedValue(new Error('Auth failed'));

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
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
      };

      mockAuthClient.getToken.mockResolvedValue(mockTokenResponse);

      await meroJs.authenticate();

      const tokenData = meroJs.getTokenData();
      expect(tokenData).toBeDefined();
      expect(tokenData?.access_token).toBe('mock-access-token');
    });

    it('should refresh token when expired', async () => {
      // First authenticate
      const mockTokenResponse = {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
      };

      mockAuthClient.getToken.mockResolvedValue(mockTokenResponse);
      await meroJs.authenticate();

      // Mock refresh response
      const mockRefreshResponse = {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      };

      mockAuthClient.refreshToken.mockResolvedValue(mockRefreshResponse);

      // Manually set token as expired
      const tokenData = meroJs.getTokenData()!;
      tokenData.expires_at = Date.now() - 1000; // Expired 1 second ago

      // This should trigger a refresh
      const validToken = await (meroJs as any).getValidToken();

      expect(mockAuthClient.refreshToken).toHaveBeenCalledWith({
        refresh_token: 'mock-refresh-token',
      });

      expect(validToken.access_token).toBe('new-access-token');
    });

    it('should clear token when refresh fails', async () => {
      // First authenticate
      const mockTokenResponse = {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
      };

      mockAuthClient.getToken.mockResolvedValue(mockTokenResponse);
      await meroJs.authenticate();

      // Mock refresh failure
      mockAuthClient.refreshToken.mockRejectedValue(
        new Error('Refresh failed'),
      );

      // Manually set token as expired
      const tokenData = meroJs.getTokenData()!;
      tokenData.expires_at = Date.now() - 1000; // Expired 1 second ago

      // This should trigger a refresh and fail
      await expect((meroJs as any).getValidToken()).rejects.toThrow(
        'Token refresh failed: Refresh failed',
      );
      expect(meroJs.isAuthenticated()).toBe(false);
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
      expect(typeof meroJs.auth.getToken).toBe('function');
      expect(typeof meroJs.auth.refreshToken).toBe('function');
      expect(typeof meroJs.auth.getHealth).toBe('function');
      expect(typeof meroJs.auth.listRootKeys).toBe('function');
    });

    it('should provide admin API client', () => {
      expect(meroJs.admin).toBeDefined();
      expect(meroJs.admin.public).toBeDefined();
      expect(typeof meroJs.admin.public.health).toBe('function');
      expect(typeof meroJs.admin.public.isAuthed).toBe('function');
      expect(meroJs.admin.contexts).toBeDefined();
      expect(typeof meroJs.admin.contexts.listContexts).toBe('function');
      expect(meroJs.admin.blobs).toBeDefined();
      expect(typeof meroJs.admin.blobs.listBlobs).toBe('function');
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
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
      };

      mockAuthClient.getToken.mockResolvedValue(mockTokenResponse);
      await meroJs.authenticate();

      // Verify HTTP client was created with getAuthToken function
      expect(createBrowserHttpClient).toHaveBeenCalledWith({
        baseUrl: 'http://localhost:3000',
        getAuthToken: expect.any(Function),
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
      mockAuthClient.getToken.mockRejectedValue(
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
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
      };

      mockAuthClient.getToken.mockResolvedValue(mockTokenResponse);
      await meroJs.authenticate();

      // Mock refresh failure
      mockAuthClient.refreshToken.mockRejectedValue(
        new Error('Invalid refresh token'),
      );

      // Manually set token as expired
      const tokenData = meroJs.getTokenData()!;
      tokenData.expires_at = Date.now() - 1000;

      await expect((meroJs as any).getValidToken()).rejects.toThrow(
        'Token refresh failed: Invalid refresh token',
      );
      expect(meroJs.isAuthenticated()).toBe(false);
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
        timeoutMs: 30000,
      });
    });
  });
});
