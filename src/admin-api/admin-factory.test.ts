import { describe, it, expect } from 'vitest';
import { createAdminApiClientFromHttpClient } from './admin-factory';
import { AdminApiClient } from './admin-client';
import { HttpClient } from '../http-client';

// Mock HttpClient
class MockHttpClient implements HttpClient {
  async get<T>(): Promise<T> {
    return {} as T;
  }

  async post<T>(): Promise<T> {
    return {} as T;
  }

  async put<T>(): Promise<T> {
    return {} as T;
  }

  async delete<T>(): Promise<T> {
    return {} as T;
  }

  async head(): Promise<{ headers: Record<string, string>; status: number }> {
    return { headers: {}, status: 200 };
  }

  async patch<T>(): Promise<T> {
    return {} as T;
  }

  async request<T>(): Promise<T> {
    return {} as T;
  }
}

describe('createAdminApiClientFromHttpClient', () => {
  it('should create AdminApiClient from existing HttpClient', () => {
    const client = createAdminApiClientFromHttpClient(new MockHttpClient(), {
      baseUrl: 'http://localhost',
      getAuthToken: async () => 'test-token',
      timeoutMs: 10000,
    });
    expect(client).toBeInstanceOf(AdminApiClient);
  });

  it('should create AdminApiClient with minimal config', () => {
    const client = createAdminApiClientFromHttpClient(new MockHttpClient(), {
      baseUrl: 'http://localhost',
    });
    expect(client).toBeInstanceOf(AdminApiClient);
  });
});
