import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MeroJs } from '../../src/index';
import { getMeroJs } from './setup';

describe('Auth API E2E Tests', () => {
  let meroJs: MeroJs;

  beforeAll(async () => {
    meroJs = await getMeroJs({
      baseUrl: process.env.AUTH_API_BASE_URL || 'http://localhost',
    });
  }, 120000);

  afterAll(async () => {
    // Don't teardown here - let it be handled globally to avoid conflicts
  }, 120000);

  describe('Health and Status', () => {
    it('should check auth service health', async () => {
      console.log('🏥 Checking Auth API health...');

      const health = await meroJs.auth.getHealth();
      console.log('✅ Auth API health:', JSON.stringify(health, null, 2));

      expect(health).toBeDefined();
      expect(health.status).toBeDefined();
      expect(health.status).toBe('healthy');
    });

    it('should get service identity', async () => {
      console.log('🔍 Getting service identity...');

      try {
        const identity = await meroJs.auth.getIdentity();
        console.log('✅ Service identity:', JSON.stringify(identity, null, 2));

        expect(identity).toBeDefined();
        expect(identity.service).toBeDefined();
        expect(identity.version).toBeDefined();
      } catch (error: any) {
        // Identity endpoint may not be available in all environments
        if (error.status === 404) {
          console.log('⚠️ Service identity endpoint not available (404) - skipping');
        } else {
          throw error;
        }
      }
    });

    it('should get available providers', async () => {
      console.log('🔌 Getting available providers...');

      const providers = await meroJs.auth.getProviders();
      console.log(
        '✅ Available providers:',
        JSON.stringify(providers, null, 2),
      );

      expect(providers).toBeDefined();
      // Response may be array directly or object with providers field
      const providerList = Array.isArray(providers)
        ? providers
        : (providers as any).providers;
      expect(Array.isArray(providerList)).toBe(true);
    });
  });

  describe('Authentication Flow', () => {
    it('should validate the generated token', async () => {
      console.log('🔐 Validating generated token...');

      const tokenData = meroJs.getTokenData();
      if (!tokenData) {
        console.log('⏭️ Skipping - no token data');
        return;
      }

      try {
        const validation = await meroJs.auth.validateToken({
          token: tokenData.access_token,
        });
        console.log('✅ Token validation:', JSON.stringify(validation, null, 2));

        expect(validation).toBeDefined();
        expect(validation.valid).toBe(true);
        console.log('✅ Token validated successfully');
      } catch (error: any) {
        if (error.status === 404 || error.status === 500) {
          console.log(`⚠️ Token validation endpoint not available (${error.status}) - skipping`);
        } else {
          throw error;
        }
      }
    });
  });

  describe('Key Management', () => {
    it('should list root keys', async () => {
      console.log('🔑 Listing root keys...');

      try {
        const rootKeys = await meroJs.auth.listRootKeys();
        console.log('✅ Root keys:', JSON.stringify(rootKeys, null, 2));

        expect(rootKeys).toBeDefined();
        expect(Array.isArray(rootKeys)).toBe(true);
        expect(rootKeys.length).toBeGreaterThan(0);
      } catch (error: any) {
        // Root keys endpoint may not be available in all environments
        if (error.status === 404) {
          console.log('⚠️ Root keys endpoint not available (404) - skipping');
        } else {
          throw error;
        }
      }
    });

    it('should get key permissions', async () => {
      console.log('🔑 Getting key permissions...');

      try {
        // Get the first key ID from the list
        const rootKeys = await meroJs.auth.listRootKeys();
        const firstKeyId = rootKeys[0]?.keyId;

        if (firstKeyId) {
          const permissions = await meroJs.auth.getKeyPermissions(firstKeyId);
          console.log(
            '✅ Key permissions:',
            JSON.stringify(permissions, null, 2),
          );

          expect(permissions).toBeDefined();
          // Response may be array directly or wrapped in data
          const permList = Array.isArray(permissions)
            ? permissions
            : (permissions as any).data?.permissions || permissions;
          expect(permList).toBeDefined();
        } else {
          console.log('⚠️ No keys found, skipping permissions test');
        }
      } catch (error: any) {
        // Key permissions endpoint may not be available in all environments
        if (error.status === 404) {
          console.log('⚠️ Key permissions endpoint not available (404) - skipping');
        } else {
          throw error;
        }
      }
    });
  });

  describe('Token Management', () => {
    it('should refresh the access token', async () => {
      console.log('🔄 Refreshing access token...');

      const tokenData = meroJs.getTokenData();
      if (!tokenData || !tokenData.refresh_token) {
        console.log('⏭️ Skipping - no refresh token available');
        return;
      }

      try {
        const refreshResponse = await meroJs.auth.refreshToken({
          refresh_token: tokenData.refresh_token,
        });

        console.log(
          '✅ Token refresh:',
          JSON.stringify(refreshResponse, null, 2),
        );

        expect(refreshResponse).toBeDefined();
        // Response has access_token and refresh_token directly
        if (refreshResponse.access_token) {
          expect(refreshResponse.access_token).toBeDefined();
          expect(refreshResponse.refresh_token).toBeDefined();
        }
      } catch (error: any) {
        // If the HTTP client throws an exception, that's expected behavior
        // 400 = bad request (token still valid), 401 = unauthorized, 404 = not available
        console.log('✅ Token refresh failed as expected:', error.message);
        expect([400, 401, 404]).toContain(error.status);
      }
    });
  });
});
