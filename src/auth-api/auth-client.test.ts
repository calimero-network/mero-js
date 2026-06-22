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
});
