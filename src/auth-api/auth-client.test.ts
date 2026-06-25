import { describe, it, expect, beforeEach } from 'vitest';
import { AuthApiClient } from './auth-client';
import { HttpClient } from '../http-client';

// Mock HttpClient that records request bodies (mirrors admin-client.test.ts).
class MockHttpClient implements HttpClient {
  private mockResponses = new Map<string, unknown>();
  private requestBodies = new Map<string, unknown>();

  setMockResponse(method: string, path: string, response: unknown) {
    this.mockResponses.set(`${method} ${path}`, response);
  }
  getRequestBody(method: string, path: string): unknown {
    return this.requestBodies.get(`${method} ${path}`);
  }
  private getResponse(method: string, path: string): unknown {
    const key = `${method} ${path}`;
    if (!this.mockResponses.has(key)) throw new Error(`No mock response for ${key}`);
    return this.mockResponses.get(key);
  }
  async get<T>(path: string): Promise<T> {
    return this.getResponse('GET', path) as T;
  }
  async post<T>(path: string, body?: unknown): Promise<T> {
    this.requestBodies.set(`POST ${path}`, body);
    return this.getResponse('POST', path) as T;
  }
  async put<T>(path: string, body?: unknown): Promise<T> {
    this.requestBodies.set(`PUT ${path}`, body);
    return this.getResponse('PUT', path) as T;
  }
  async delete<T>(path: string): Promise<T> {
    return this.getResponse('DELETE', path) as T;
  }
  async patch<T>(path: string, body?: unknown): Promise<T> {
    this.requestBodies.set(`PATCH ${path}`, body);
    return this.getResponse('PATCH', path) as T;
  }
  async head(): Promise<{ headers: Record<string, string>; status: number }> {
    return { headers: {}, status: 200 };
  }
  async request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const method = init?.method ?? 'GET';
    let body = init?.body;
    if (typeof body === 'string') body = JSON.parse(body);
    this.requestBodies.set(`${method} ${path}`, body);
    return this.getResponse(method, path) as T;
  }
}

describe('AuthApiClient', () => {
  let mock: MockHttpClient;
  let client: AuthApiClient;

  beforeEach(() => {
    mock = new MockHttpClient();
    client = new AuthApiClient(mock);
  });

  describe('updateKeyPermissions', () => {
    it('sends an { add, remove } delta (not a { permissions } replacement)', async () => {
      mock.setMockResponse('PUT', '/admin/keys/key1/permissions', {
        data: { permissions: ['context:execute'] },
        error: null,
      });

      const result = await client.updateKeyPermissions('key1', {
        add: ['context:execute'],
        remove: ['admin'],
      });

      expect(result).toEqual({ data: { permissions: ['context:execute'] }, error: null });
      const body = mock.getRequestBody('PUT', '/admin/keys/key1/permissions');
      expect(body).toEqual({ add: ['context:execute'], remove: ['admin'] });
      // Regression guard: core ignores a `permissions` field, so it must not be sent.
      expect(body).not.toHaveProperty('permissions');
    });

    it('supports an add-only delta', async () => {
      mock.setMockResponse('PUT', '/admin/keys/key1/permissions', {
        data: { permissions: ['a', 'b'] },
        error: null,
      });

      await client.updateKeyPermissions('key1', { add: ['b'] });

      expect(mock.getRequestBody('PUT', '/admin/keys/key1/permissions')).toEqual({ add: ['b'] });
    });
  });

  describe('revokeTokens', () => {
    it('sends { client_id } and unwraps the { data } envelope', async () => {
      mock.setMockResponse('POST', '/admin/revoke', {
        data: { success: true, message: 'Tokens revoked successfully' },
        error: null,
      });
      const result = await client.revokeTokens({ client_id: 'client-1' });
      expect(result).toEqual({ success: true, message: 'Tokens revoked successfully' });
      expect(mock.getRequestBody('POST', '/admin/revoke')).toEqual({ client_id: 'client-1' });
    });

    it('returns a success:false payload rather than throwing', async () => {
      mock.setMockResponse('POST', '/admin/revoke', {
        data: { success: false, message: 'no active client tokens' },
        error: null,
      });
      const result = await client.revokeTokens({ client_id: 'client-1' });
      expect(result).toEqual({ success: false, message: 'no active client tokens' });
    });

    it('throws when the payload is absent (data: null error envelope)', async () => {
      mock.setMockResponse('POST', '/admin/revoke', {
        data: null,
        error: { message: 'unauthorized' },
      });
      await expect(client.revokeTokens({ client_id: 'client-1' })).rejects.toThrow(
        /response data is null/,
      );
    });
  });

  describe('createRootKey', () => {
    it('sends { public_key, auth_method, provider_data } and unwraps the { data } envelope', async () => {
      mock.setMockResponse('POST', '/admin/keys', {
        data: { status: true, message: 'Key was created' },
        error: null,
      });
      const result = await client.createRootKey({
        public_key: 'ed25519:pk',
        auth_method: 'user_password',
        provider_data: {},
      });
      expect(result).toEqual({ status: true, message: 'Key was created' });
      expect(mock.getRequestBody('POST', '/admin/keys')).toEqual({
        public_key: 'ed25519:pk',
        auth_method: 'user_password',
        provider_data: {},
      });
    });

    it('returns a status:false payload rather than throwing', async () => {
      mock.setMockResponse('POST', '/admin/keys', {
        data: { status: false, message: 'key already exists' },
        error: null,
      });
      const result = await client.createRootKey({
        public_key: 'ed25519:pk',
        auth_method: 'user_password',
        provider_data: {},
      });
      expect(result).toEqual({ status: false, message: 'key already exists' });
    });
  });

  describe('listRootKeys', () => {
    it('unwraps the flat data array of root keys', async () => {
      const keys = [
        {
          key_id: 'k1',
          public_key: 'pk',
          auth_method: 'user_password',
          created_at: 1,
          revoked_at: null,
          permissions: ['admin'],
        },
      ];
      mock.setMockResponse('GET', '/admin/keys', { data: keys, error: null });
      expect(await client.listRootKeys()).toEqual(keys);
    });
  });

  describe('listClientKeys', () => {
    it('unwraps the flat data array of client keys', async () => {
      const clients = [
        {
          client_id: 'c1',
          root_key_id: 'k1',
          name: 'ctx client',
          permissions: ['context:execute'],
          created_at: 1,
          revoked_at: null,
          is_valid: true,
        },
      ];
      mock.setMockResponse('GET', '/admin/keys/clients', { data: clients, error: null });
      expect(await client.listClientKeys()).toEqual(clients);
    });
  });

  describe('generateClientKey', () => {
    it('sends the context_id/context_identity/permissions body', async () => {
      mock.setMockResponse('POST', '/admin/client-key', {
        data: { access_token: 'a', refresh_token: 'r' },
        error: null,
      });
      await client.generateClientKey({
        context_id: 'ctx-1',
        context_identity: 'id-1',
        permissions: ['context:execute'],
      });
      expect(mock.getRequestBody('POST', '/admin/client-key')).toEqual({
        context_id: 'ctx-1',
        context_identity: 'id-1',
        permissions: ['context:execute'],
      });
    });
  });

  describe('generateMockTokens', () => {
    it('sends snake_case { client_name, access_token_expiry }', async () => {
      mock.setMockResponse('POST', '/auth/mock-token', {
        data: { access_token: 'a', refresh_token: 'r' },
        error: null,
      });
      await client.generateMockTokens({
        client_name: 'cli',
        permissions: ['admin'],
        access_token_expiry: 3600,
      });
      expect(mock.getRequestBody('POST', '/auth/mock-token')).toEqual({
        client_name: 'cli',
        permissions: ['admin'],
        access_token_expiry: 3600,
      });
    });
  });

  describe('getHealth', () => {
    it('exposes the alive/not_alive status and uptime_seconds (snake_case)', async () => {
      mock.setMockResponse('GET', '/auth/health', {
        data: { status: 'alive', storage: true, uptime_seconds: 42 },
        error: null,
      });
      expect(await client.getHealth()).toEqual({ status: 'alive', storage: true, uptime_seconds: 42 });
    });
  });
});
