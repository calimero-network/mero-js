import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  createBrowserAdminApiClient,
  createNodeAdminApiClient,
  createAdminApiClient,
  createAdminApiClientFromHttpClient,
} from './admin-factory.js';
import { AdminApiClient } from './admin-client.js';
import { HttpClient } from '../http-client/index.js';

// Mock HttpClient
class MockHttpClient implements HttpClient {
  async get<T>(path: string): Promise<T> {
    return {} as T;
  }

  async post<T>(path: string, body?: any): Promise<T> {
    return {} as T;
  }

  async put<T>(path: string, body?: any): Promise<T> {
    return {} as T;
  }

  async delete<T>(path: string): Promise<T> {
    return {} as T;
  }

  async head(_path: string): Promise<{ headers: Record<string, string>; status: number }> {
    return { headers: {}, status: 200 };
  }

  async patch<T>(path: string, body?: any): Promise<T> {
    return {} as T;
  }

  async request<T>(): Promise<T> {
    return {} as T;
  }
}

describe('Admin API Factory Functions', () => {
  describe('createBrowserAdminApiClient', () => {
    it('should create AdminApiClient with browser HTTP client', () => {
      const config = {
        baseUrl: 'http://localhost',
        getAuthToken: async () => 'test-token',
        timeoutMs: 10000,
      };

      const client = createBrowserAdminApiClient(config);
      expect(client).toBeInstanceOf(AdminApiClient);
    });

    it('should create AdminApiClient with default config', () => {
      const config = {
        baseUrl: 'http://localhost',
      };

      const client = createBrowserAdminApiClient(config);
      expect(client).toBeInstanceOf(AdminApiClient);
    });
  });

  describe('createNodeAdminApiClient', () => {
    it('should create AdminApiClient with node HTTP client', () => {
      const config = {
        baseUrl: 'http://localhost',
        getAuthToken: async () => 'test-token',
        timeoutMs: 10000,
      };

      const client = createNodeAdminApiClient(config);
      expect(client).toBeInstanceOf(AdminApiClient);
    });

    it('should create AdminApiClient with default config', () => {
      const config = {
        baseUrl: 'http://localhost',
      };

      const client = createNodeAdminApiClient(config);
      expect(client).toBeInstanceOf(AdminApiClient);
    });
  });

  describe('createAdminApiClient', () => {
    it('should create AdminApiClient with universal HTTP client', () => {
      const config = {
        baseUrl: 'http://localhost',
        getAuthToken: async () => 'test-token',
        timeoutMs: 10000,
      };

      const client = createAdminApiClient(config);
      expect(client).toBeInstanceOf(AdminApiClient);
    });

    it('should create AdminApiClient with default config', () => {
      const config = {
        baseUrl: 'http://localhost',
      };

      const client = createAdminApiClient(config);
      expect(client).toBeInstanceOf(AdminApiClient);
    });
  });

  describe('createAdminApiClientFromHttpClient', () => {
    it('should create AdminApiClient from existing HttpClient', () => {
      const mockHttpClient = new MockHttpClient();
      const config = {
        baseUrl: 'http://localhost',
        getAuthToken: async () => 'test-token',
        timeoutMs: 10000,
      };

      const client = createAdminApiClientFromHttpClient(mockHttpClient, config);
      expect(client).toBeInstanceOf(AdminApiClient);
    });

    it('should create AdminApiClient with minimal config', () => {
      const mockHttpClient = new MockHttpClient();
      const config = {
        baseUrl: 'http://localhost',
      };

      const client = createAdminApiClientFromHttpClient(mockHttpClient, config);
      expect(client).toBeInstanceOf(AdminApiClient);
    });
  });

  // These three used to hand the client a stub whose every method threw, so the
  // obvious-looking entry points were unusable. Prove they now reach the wire.
  describe('the config-only factories issue real requests', () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    const factories = {
      createAdminApiClient,
      createBrowserAdminApiClient,
      createNodeAdminApiClient,
    };

    for (const [name, factory] of Object.entries(factories)) {
      it(`${name} calls the node`, async () => {
        const fetchMock = vi.fn(
          async () =>
            new Response(JSON.stringify({ data: { status: 'alive' } }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
        );
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const client = factory({
          baseUrl: 'http://localhost:2428',
          getAuthToken: async () => 'test-token',
        });

        await expect(client.healthCheck()).resolves.toEqual({ status: 'alive' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [
          string,
          RequestInit,
        ];
        expect(url).toBe('http://localhost:2428/admin-api/health');
        expect((init.headers as Record<string, string>).Authorization).toBe(
          'Bearer test-token',
        );
      });
    }
  });
});
