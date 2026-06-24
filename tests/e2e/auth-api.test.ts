import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MeroJs } from '@calimero-network/mero-js';
import { startNode, resolveBaseUrl, resolveCreds, type StartedNode } from './harness';

// Test configuration
const AUTH_CONFIG = {
  baseUrl: resolveBaseUrl(),
  credentials: resolveCreds(),
  timeoutMs: 10000,
};

describe('Auth API E2E Tests', () => {
  let meroJs: MeroJs;
  let node: StartedNode;

  beforeAll(async () => {
    // Attaches to NODE_BASE_URL when set (core CI injects its merod), else spawns
    // merobox/merod locally. See ./harness.
    node = await startNode();

    console.log('🔧 Creating MeroJs SDK...');
    console.log('Auth API URL:', AUTH_CONFIG.baseUrl);

    // Create MeroJs SDK instance
    meroJs = new MeroJs(AUTH_CONFIG);

    // Authenticate (this creates the root key on first use)
    console.log('🔑 Authenticating with MeroJs SDK...');
    const tokenData = await meroJs.authenticate();

    console.log('✅ Authentication successful!');
    console.log('🎫 Token expires at:', new Date(tokenData.expires_at));
  }, 120000); // 2 minute timeout for beforeAll

  afterAll(async () => {
    // No-op when attached to an injected node; tears down a locally-spawned one.
    try {
      await node?.stop();
    } catch (error) {
      console.warn('⚠️ node cleanup failed:', error);
    }
    console.log('🧹 Test cleanup completed');
  }, 120000); // 2 minute timeout for afterAll

  describe('Health and Status', () => {
    it('should check auth service health', async () => {
      console.log('🏥 Checking Auth API health...');

      const health = await meroJs.auth.getHealth();
      console.log('✅ Auth API health:', JSON.stringify(health, null, 2));

      expect(health).toBeDefined();
      expect(health.status).toBeDefined();
      expect(health.status).toBe('alive');
    });

    it('should get service identity', async () => {
      console.log('🔍 Getting service identity...');

      const identity = await meroJs.auth.getIdentity();
      console.log('✅ Service identity:', JSON.stringify(identity, null, 2));

      expect(identity).toBeDefined();
      expect(identity.service).toBeDefined();
      expect(identity.version).toBeDefined();
    });

    it('should get available providers', async () => {
      console.log('🔌 Getting available providers...');

      const providers = await meroJs.auth.getProviders();
      console.log(
        '✅ Available providers:',
        JSON.stringify(providers, null, 2),
      );

      expect(providers).toBeDefined();
      expect(providers.providers).toBeDefined();
      expect(Array.isArray(providers.providers)).toBe(true);
    });
  });

  describe('Authentication Flow', () => {
    it('should validate the generated token', async () => {
      console.log('🔐 Validating generated token...');

      const validation = await meroJs.auth.validateToken(
        meroJs.getTokenData()!.access_token,
      );
      console.log('✅ Token validation:', JSON.stringify(validation, null, 2));

      expect(validation).toBeDefined();
      expect(validation.valid).toBe(true);
    });
  });

  describe('Key Management', () => {
    it('should list root keys', async () => {
      console.log('🔑 Listing root keys...');

      const rootKeys = await meroJs.auth.listRootKeys();
      console.log('✅ Root keys:', JSON.stringify(rootKeys, null, 2));

      expect(rootKeys).toBeDefined();
      expect(Array.isArray(rootKeys)).toBe(true);
      expect(rootKeys.length).toBeGreaterThan(0);
    });

    it('should get key permissions', async () => {
      console.log('🔑 Getting key permissions...');

      // Get the first key ID from the list
      const rootKeys = await meroJs.auth.listRootKeys();
      const firstKeyId = rootKeys[0]?.key_id;

      if (firstKeyId) {
        const permissions = await meroJs.auth.getKeyPermissions(firstKeyId);
        console.log(
          '✅ Key permissions:',
          JSON.stringify(permissions, null, 2),
        );

        expect(permissions).toBeDefined();
        expect(permissions.data).toBeDefined();
        expect(permissions.data.permissions).toBeDefined();
        expect(Array.isArray(permissions.data.permissions)).toBe(true);
      } else {
        console.log('⚠️ No keys found, skipping permissions test');
        expect(true).toBe(true); // Placeholder assertion
      }
    });
  });

  describe('Token Management', () => {
    it('should refresh the access token', async () => {
      console.log('🔄 Refreshing access token...');

      // Generate a new token to get a refresh token for testing
      const tokenResponse = await meroJs.auth.generateTokens({
        auth_method: 'user_password',
        public_key: 'test-public-key-refresh',
        client_name: 'e2e-test-client-refresh',
        timestamp: Math.floor(Date.now() / 1000),
        provider_data: { ...AUTH_CONFIG.credentials },
      });

      try {
        const refreshResponse = await meroJs.auth.refreshToken({
          access_token: tokenResponse.data.access_token,
          refresh_token: tokenResponse.data.refresh_token,
        });

        console.log(
          '✅ Token refresh:',
          JSON.stringify(refreshResponse, null, 2),
        );

        expect(refreshResponse).toBeDefined();
        // The refresh might fail if the token is still valid, which is expected behavior
        if (refreshResponse.data) {
          expect(refreshResponse.data.access_token).toBeDefined();
          expect(refreshResponse.data.refresh_token).toBeDefined();
        } else {
          // If refresh fails because token is still valid, that's also a valid response
          expect(refreshResponse.error).toBeDefined();
          expect(refreshResponse.error).toContain('Access token still valid');
        }
      } catch (error: any) {
        // If the HTTP client throws an exception for 401, that's also expected behavior
        console.log('✅ Token refresh failed as expected:', error.message);
        expect(error.status).toBe(401);
        expect(error.bodyText).toContain('Access token still valid');
      }
    });
  });
});
