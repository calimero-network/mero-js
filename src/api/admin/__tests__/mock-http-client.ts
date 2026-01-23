import { HttpClient } from '../../../http-client';

// Mock HttpClient for unit tests
export class MockHttpClient implements HttpClient {
  private mockResponses = new Map<string, any>();

  setMockResponse(method: string, path: string, response: any) {
    this.mockResponses.set(`${method} ${path}`, response);
  }

  clearMocks() {
    this.mockResponses.clear();
  }

  async get<T>(path: string): Promise<T> {
    const key = `GET ${path}`;
    const response = this.mockResponses.get(key);
    if (response instanceof Error) {
      throw response;
    }
    if (!response) {
      throw new Error(`No mock response for GET ${path}`);
    }
    return response;
  }

  async post<T>(path: string, _body?: any): Promise<T> {
    const key = `POST ${path}`;
    const response = this.mockResponses.get(key);
    if (response instanceof Error) {
      throw response;
    }
    if (!response) {
      throw new Error(`No mock response for POST ${path}`);
    }
    return response;
  }

  async put<T>(path: string, _body?: any): Promise<T> {
    const key = `PUT ${path}`;
    const response = this.mockResponses.get(key);
    if (response instanceof Error) {
      throw response;
    }
    if (!response) {
      throw new Error(`No mock response for PUT ${path}`);
    }
    return response;
  }

  async delete<T>(path: string): Promise<T> {
    const key = `DELETE ${path}`;
    const response = this.mockResponses.get(key);
    if (response instanceof Error) {
      throw response;
    }
    if (!response) {
      throw new Error(`No mock response for DELETE ${path}`);
    }
    return response;
  }

  async patch<T>(path: string, _body?: any): Promise<T> {
    const key = `PATCH ${path}`;
    const response = this.mockResponses.get(key);
    if (response instanceof Error) {
      throw response;
    }
    if (!response) {
      throw new Error(`No mock response for PATCH ${path}`);
    }
    return response;
  }

  async head(
    path: string,
  ): Promise<{ headers: Record<string, string>; status: number }> {
    const key = `HEAD ${path}`;
    const response = this.mockResponses.get(key);
    if (response instanceof Error) {
      throw response;
    }
    if (!response) {
      throw new Error(`No mock response for HEAD ${path}`);
    }
    return response;
  }

  async request<T>(path: string, init?: any): Promise<T> {
    const method = init?.method || 'GET';
    const key = `${method} ${path}`;
    const response = this.mockResponses.get(key);
    if (response instanceof Error) {
      throw response;
    }
    if (!response) {
      throw new Error(`No mock response for ${method} ${path}`);
    }
    return response;
  }
}
