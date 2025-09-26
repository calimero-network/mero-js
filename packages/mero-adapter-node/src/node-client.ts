// Node.js HTTP client implementation
import { HttpClient, Transport, RequestOptions } from '@mero/core';

export class NodeHttpClient implements HttpClient {
  constructor(private transport: Transport) {}

  async get<T>(path: string, init?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...init, method: 'GET' });
  }

  async post<T>(
    path: string,
    body?: unknown,
    init?: RequestOptions
  ): Promise<T> {
    return this.request<T>(path, {
      ...init,
      method: 'POST',
      body: body as any,
    });
  }

  async put<T>(
    path: string,
    body?: unknown,
    init?: RequestOptions
  ): Promise<T> {
    return this.request<T>(path, { ...init, method: 'PUT', body: body as any });
  }

  async delete<T>(path: string, init?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...init, method: 'DELETE' });
  }

  async patch<T>(
    path: string,
    body?: unknown,
    init?: RequestOptions
  ): Promise<T> {
    return this.request<T>(path, {
      ...init,
      method: 'PATCH',
      body: body as any,
    });
  }

  async head(
    path: string,
    init?: RequestOptions
  ): Promise<{ headers: Record<string, string>; status: number }> {
    const response = await this.request<Response>(path, {
      ...init,
      method: 'HEAD',
    });
    return {
      headers: Object.fromEntries(response.headers.entries()),
      status: response.status,
    };
  }

  async request<T>(path: string, init?: RequestOptions): Promise<T> {
    const url = new URL(path, this.transport.baseUrl);
    const response = await this.transport.fetch(url.toString(), {
      ...init,
      headers: {
        ...this.transport.defaultHeaders,
        ...init?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json() as T;
  }
}
