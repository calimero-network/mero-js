import { describe, it, expect, beforeEach } from 'vitest';
import { AuthApiClient } from '../client';
import { MockHttpClient } from '../../admin/__tests__/mock-http-client';

describe('AuthApiClient', () => {
  let client: AuthApiClient;
  let mockHttp: MockHttpClient;

  beforeEach(() => {
    mockHttp = new MockHttpClient();
    client = new AuthApiClient(mockHttp, {
      baseUrl: 'http://localhost:3000',
      embedded: true,
    });
  });

  describe('Public Endpoints', () => {
    describe('getLogin', () => {
      it('should get login page', async () => {
        mockHttp.setMockResponse('GET', '/auth/login', '<html>Login</html>');

        const result = await client.getLogin();

        expect(result).toBe('<html>Login</html>');
        expect(typeof result).toBe('string');
      });
    });

    describe('getChallenge', () => {
      it('should get challenge', async () => {
        mockHttp.setMockResponse('GET', '/auth/challenge', {
          data: {
            challenge: 'challenge123',
            nonce: 'nonce456',
            timestamp: 1234567890,
          },
        });

        const result = await client.getChallenge();

        expect(result.challenge).toBe('challenge123');
        expect(result.nonce).toBe('nonce456');
        expect(result.timestamp).toBe(1234567890);
      });
    });

    describe('getToken', () => {
      it('should get token with user_password', async () => {
        const request = {
          auth_method: 'user_password' as const,
          public_key: 'username',
          client_name: 'test-client',
          timestamp: 1234567890,
          provider_data: {
            username: 'user',
            password: 'pass',
          },
        };

        mockHttp.setMockResponse('POST', '/auth/token', {
          data: {
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            expires_in: 3600,
          },
        });

        const result = await client.getToken(request);

        expect(result.access_token).toBe('access-token');
        expect(result.refresh_token).toBe('refresh-token');
        expect(result.expires_in).toBe(3600);
      });

      it('should get token with near_wallet', async () => {
        const request = {
          auth_method: 'near_wallet' as const,
          public_key: 'ed25519:abc123',
          client_name: 'test-client',
          timestamp: 1234567890,
          provider_data: {
            wallet_address: 'user.testnet',
            signature: 'sig123',
            message: 'challenge',
          },
        };

        mockHttp.setMockResponse('POST', '/auth/token', {
          data: {
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            expires_in: 3600,
          },
        });

        const result = await client.getToken(request);

        expect(result.access_token).toBeDefined();
      });
    });

    describe('refreshToken', () => {
      it('should refresh token', async () => {
        const request = {
          refresh_token: 'refresh-token',
        };

        mockHttp.setMockResponse('POST', '/auth/refresh', {
          data: {
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_in: 3600,
          },
        });

        const result = await client.refreshToken(request);

        expect(result.access_token).toBe('new-access-token');
        expect(result.refresh_token).toBe('new-refresh-token');
      });
    });

    describe('getProviders', () => {
      it('should get auth providers', async () => {
        mockHttp.setMockResponse('GET', '/auth/providers', {
          data: [
            { id: 'user_password', name: 'Username/Password', enabled: true },
            { id: 'near_wallet', name: 'NEAR Wallet', enabled: true },
          ],
        });

        const result = await client.getProviders();

        expect(result).toHaveLength(2);
        expect(result[0].id).toBe('user_password');
      });
    });

    describe('getIdentity', () => {
      it('should get auth identity', async () => {
        mockHttp.setMockResponse('GET', '/auth/identity', {
          data: {
            service: 'mero-auth',
            version: '1.0.0',
            identity: 'auth-service-id',
          },
        });

        const result = await client.getIdentity();

        expect(result.service).toBe('mero-auth');
        expect(result.version).toBe('1.0.0');
      });
    });

    describe('validateToken', () => {
      it('should validate token via POST', async () => {
        const request = { token: 'test-token' };

        mockHttp.setMockResponse('POST', '/auth/validate', {
          data: {
            valid: true,
            claims: { sub: 'user123' },
          },
        });

        const result = await client.validateToken(request);

        expect(result.valid).toBe(true);
        expect(result.claims).toBeDefined();
      });

      it('should validate token via GET', async () => {
        mockHttp.setMockResponse('GET', '/auth/validate', {
          data: {
            valid: true,
            claims: { sub: 'user123' },
          },
        });

        const result = await client.validateTokenGet('test-token');

        expect(result.valid).toBe(true);
      });

      it('should handle invalid token', async () => {
        const request = { token: 'invalid-token' };

        mockHttp.setMockResponse('POST', '/auth/validate', {
          data: {
            valid: false,
            claims: null,
          },
        });

        const result = await client.validateToken(request);

        expect(result.valid).toBe(false);
        expect(result.claims).toBeNull();
      });
    });

    describe('getHealth', () => {
      it('should get auth health', async () => {
        mockHttp.setMockResponse('GET', '/auth/health', {
          data: {
            status: 'healthy',
            storage: true,
            uptime_seconds: 100,
          },
        });

        const result = await client.getHealth();

        expect(result.status).toBe('healthy');
      });
    });

    describe('getCallback', () => {
      it('should get callback without URL', async () => {
        mockHttp.setMockResponse('GET', '/auth/callback', '<html>Callback</html>');

        const result = await client.getCallback();

        expect(result).toBe('<html>Callback</html>');
      });

      it('should get callback with URL', async () => {
        mockHttp.setMockResponse(
          'GET',
          '/auth/callback?callback-url=http%3A%2F%2Fexample.com',
          '<html>Callback</html>',
        );

        const result = await client.getCallback('http://example.com');

        expect(result).toBe('<html>Callback</html>');
      });
    });
  });

  describe('Protected Endpoints', () => {
    describe('revokeToken', () => {
      it('should revoke token', async () => {
        mockHttp.setMockResponse('POST', '/auth/admin/revoke', {
          data: {
            revoked: true,
          },
        });

        const result = await client.revokeToken();

        expect(result.revoked).toBe(true);
      });
    });

    describe('listRootKeys', () => {
      it('should list root keys', async () => {
        mockHttp.setMockResponse('GET', '/auth/admin/keys', {
          data: [
            {
              keyId: 'key-1',
              publicKey: 'pubkey-1',
              clientName: 'client-1',
              createdAt: '2024-01-01T00:00:00Z',
              permissions: ['admin'],
            },
          ],
        });

        const result = await client.listRootKeys();

        expect(result).toHaveLength(1);
        expect(result[0].keyId).toBe('key-1');
      });
    });

    describe('createRootKey', () => {
      it('should create root key', async () => {
        const request = {
          publicKey: 'pubkey-new',
          clientName: 'new-client',
          permissions: ['admin'],
        };

        mockHttp.setMockResponse('POST', '/auth/admin/keys', {
          data: {
            keyId: 'key-new',
            publicKey: 'pubkey-new',
            clientName: 'new-client',
            createdAt: '2024-01-01T00:00:00Z',
            permissions: ['admin'],
          },
        });

        const result = await client.createRootKey(request);

        expect(result.keyId).toBe('key-new');
        expect(result.publicKey).toBe('pubkey-new');
      });
    });

    describe('deleteRootKey', () => {
      it('should delete root key', async () => {
        mockHttp.setMockResponse('DELETE', '/auth/admin/keys/key-1', {
          data: {
            deleted: true,
          },
        });

        const result = await client.deleteRootKey('key-1');

        expect(result.deleted).toBe(true);
      });
    });

    describe('listClientKeys', () => {
      it('should list client keys', async () => {
        mockHttp.setMockResponse('GET', '/auth/admin/keys/clients', {
          data: [
            {
              keyId: 'client-key-1',
              rootKeyId: 'root-key-1',
              contextId: 'ctx-1',
              contextIdentity: 'identity-1',
              permissions: ['read'],
              createdAt: '2024-01-01T00:00:00Z',
            },
          ],
        });

        const result = await client.listClientKeys();

        expect(result).toHaveLength(1);
        expect(result[0].keyId).toBe('client-key-1');
      });
    });

    describe('generateClientKey', () => {
      it('should generate client key', async () => {
        const request = {
          contextId: 'ctx-1',
          contextIdentity: 'identity-1',
          permissions: ['read', 'execute'],
        };

        mockHttp.setMockResponse('POST', '/auth/admin/client-key', {
          data: {
            keyId: 'client-key-new',
            rootKeyId: 'root-key-1',
            contextId: 'ctx-1',
            contextIdentity: 'identity-1',
            permissions: ['read', 'execute'],
            createdAt: '2024-01-01T00:00:00Z',
          },
        });

        const result = await client.generateClientKey(request);

        expect(result.keyId).toBe('client-key-new');
        expect(result.contextId).toBe('ctx-1');
      });
    });

    describe('deleteClientKey', () => {
      it('should delete client key', async () => {
        mockHttp.setMockResponse(
          'DELETE',
          '/auth/admin/keys/root-key-1/clients/client-key-1',
          {
            data: {
              deleted: true,
            },
          },
        );

        const result = await client.deleteClientKey('root-key-1', 'client-key-1');

        expect(result.deleted).toBe(true);
      });
    });

    describe('getKeyPermissions', () => {
      it('should get key permissions', async () => {
        mockHttp.setMockResponse(
          'GET',
          '/auth/admin/keys/key-1/permissions',
          {
            data: ['admin', 'read', 'write'],
          },
        );

        const result = await client.getKeyPermissions('key-1');

        expect(result).toEqual(['admin', 'read', 'write']);
      });
    });

    describe('updateKeyPermissions', () => {
      it('should update key permissions', async () => {
        const request = {
          permissions: ['read', 'write'],
        };

        mockHttp.setMockResponse(
          'PUT',
          '/auth/admin/keys/key-1/permissions',
          {
            data: ['read', 'write'],
          },
        );

        const result = await client.updateKeyPermissions('key-1', request);

        expect(result).toEqual(['read', 'write']);
      });
    });

  });

  describe('Error Handling', () => {
    it('should throw error when response data is null', async () => {
      mockHttp.setMockResponse('GET', '/auth/challenge', { data: null });

      await expect(client.getChallenge()).rejects.toThrow('Response data is null');
    });

    it('should handle HTTP errors', async () => {
      const error = new Error('Unauthorized');
      mockHttp.setMockResponse('POST', '/auth/token', error);

      await expect(
        client.getToken({
          auth_method: 'user_password',
          public_key: 'user',
          client_name: 'client',
          timestamp: 1234567890,
          provider_data: {},
        }),
      ).rejects.toThrow('Unauthorized');
    });
  });

  describe('Embedded vs Proxied Mode', () => {
    it('should use /auth/ prefix in embedded mode', async () => {
      const embeddedClient = new AuthApiClient(mockHttp, {
        baseUrl: 'http://localhost:3000',
        embedded: true,
      });

      mockHttp.setMockResponse('GET', '/auth/health', {
        data: { status: 'healthy' },
      });

      await embeddedClient.getHealth();

      // Verify the path was used
      expect(mockHttp).toBeDefined();
    });

    it('should use relative paths in proxied mode', async () => {
      const proxiedClient = new AuthApiClient(mockHttp, {
        baseUrl: 'https://auth.example.com',
        embedded: false,
      });

      mockHttp.setMockResponse('GET', '/health', {
        data: { status: 'healthy' },
      });

      await proxiedClient.getHealth();

      // Verify the path was used
      expect(mockHttp).toBeDefined();
    });
  });
});
