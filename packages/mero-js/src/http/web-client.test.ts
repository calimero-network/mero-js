import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebHttpClient, HTTPError } from './web-client';
import { Transport } from './types';
import { withRetry } from './retry';

// Mock fetch implementation
const createMockFetch = (responses: Response[]) => {
  let callCount = 0;
  return vi.fn().mockImplementation(() => {
    const response = responses[callCount] || responses[responses.length - 1];
    callCount++;
    return Promise.resolve(response);
  });
};

// Mock Response implementation
const createMockResponse = (
  status: number,
  statusText: string,
  headers?: Headers,
  body?: string,
) => {
  const mockHeaders = headers || new Headers();
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: mockHeaders,
    json: vi.fn().mockResolvedValue(
      body
        ? (() => {
            try {
              return JSON.parse(body);
            } catch {
              return { message: body };
            }
          })()
        : { message: 'success' },
    ),
    text: vi.fn().mockResolvedValue(body || 'success'),
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    blob: vi.fn().mockResolvedValue(new Blob(['test'])),
    redirected: false,
    type: 'basic' as ResponseType,
    url: 'https://api.example.com',
    clone: vi.fn().mockReturnThis(),
    body: null,
    bodyUsed: false,
    formData: vi.fn().mockResolvedValue(new FormData()),
  } as unknown as Response;
};

describe('WebHttpClient - New Throwing Behavior', () => {
  let client: WebHttpClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const transport: Transport = {
      fetch: vi.fn(),
      baseUrl: 'https://api.example.com',
      getAuthToken: vi.fn().mockResolvedValue('test-token'),
      defaultHeaders: { 'X-Client': 'test' },
      timeoutMs: 30000,
    };

    client = new WebHttpClient(transport);
    mockFetch = transport.fetch as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('HTTPError throwing behavior', () => {
    it('should throw HTTPError on non-2xx responses', async () => {
      const responses = [
        createMockResponse(
          500,
          'Internal Server Error',
          new Headers({ 'Retry-After': '1' }),
          'Server error body',
        ),
      ];

      mockFetch.mockImplementation(createMockFetch(responses));

      await expect(client.get('/api/data')).rejects.toThrow(HTTPError);

      try {
        await client.get('/api/data');
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPError);
        expect(error.status).toBe(500);
        expect(error.statusText).toBe('Internal Server Error');
        expect(error.url).toBe('https://api.example.com/api/data');
        expect(error.headers).toBeInstanceOf(Headers);
        expect(error.bodyText).toBe('Server error body');
        expect(error.name).toBe('HTTPError');
      }
    });

    it('should capture bodyText with 64KB limit', async () => {
      const largeBody = 'x'.repeat(70000); // 70KB body
      const responses = [
        createMockResponse(400, 'Bad Request', new Headers(), largeBody),
      ];

      mockFetch.mockImplementation(createMockFetch(responses));

      try {
        await client.get('/api/data');
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPError);
        expect(error.bodyText).toBe(largeBody.substring(0, 65536)); // Should be capped at 64KB
      }
    });

    it('should handle network errors by re-throwing', async () => {
      const networkError = new TypeError('Network error');
      mockFetch.mockRejectedValue(networkError);

      await expect(client.get('/api/data')).rejects.toThrow(networkError);
    });

    it('should handle timeout errors by re-throwing', async () => {
      const timeoutError = new Error('Timeout');
      timeoutError.name = 'TimeoutError';
      mockFetch.mockRejectedValue(timeoutError);

      await expect(client.get('/api/data')).rejects.toThrow(timeoutError);
    });

    it('should handle abort errors by re-throwing', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      await expect(client.get('/api/data')).rejects.toThrow(abortError);
    });
  });

  describe('Parsing defaults and override', () => {
    it('should parse JSON by default for application/json', async () => {
      const responses = [
        createMockResponse(
          200,
          'OK',
          new Headers({ 'content-type': 'application/json' }),
          '{"message": "success"}',
        ),
      ];

      mockFetch.mockImplementation(createMockFetch(responses));

      const result = await client.get('/api/data');
      expect(result).toEqual({ message: 'success' });
    });

    it('should parse text by default for text/*', async () => {
      const responses = [
        createMockResponse(
          200,
          'OK',
          new Headers({ 'content-type': 'text/plain' }),
          'Hello World',
        ),
      ];

      mockFetch.mockImplementation(createMockFetch(responses));

      const result = await client.get('/api/data');
      expect(result).toBe('Hello World');
    });

    it('should parse ArrayBuffer by default for application/octet-stream', async () => {
      const responses = [
        createMockResponse(
          200,
          'OK',
          new Headers({ 'content-type': 'application/octet-stream' }),
        ),
      ];

      mockFetch.mockImplementation(createMockFetch(responses));

      const result = await client.get('/api/data');
      expect(result).toBeInstanceOf(ArrayBuffer);
    });

    it('should honor parse override', async () => {
      const responses = [
        createMockResponse(
          200,
          'OK',
          new Headers({ 'content-type': 'application/json' }),
        ),
      ];

      mockFetch.mockImplementation(createMockFetch(responses));

      const result = await client.get('/api/data', { parse: 'response' });
      expect(result).toHaveProperty('ok');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('headers');
    });
  });

  describe('Authorization precedence', () => {
    it('should not override caller Authorization header', async () => {
      const responses = [createMockResponse(200, 'OK')];
      mockFetch.mockImplementation(createMockFetch(responses));

      await client.get('/api/data', {
        headers: { Authorization: 'Bearer caller-token' },
      });

      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall[1].headers as Headers;
      expect(headers.get('authorization')).toBe('Bearer caller-token');
    });

    it('should apply auth token when no caller Authorization', async () => {
      const responses = [createMockResponse(200, 'OK')];
      mockFetch.mockImplementation(createMockFetch(responses));

      await client.get('/api/data');

      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall[1].headers as Headers;
      expect(headers.get('authorization')).toBe('Bearer test-token');
    });

    it('should handle case-insensitive Authorization check', async () => {
      const responses = [createMockResponse(200, 'OK')];
      mockFetch.mockImplementation(createMockFetch(responses));

      await client.get('/api/data', {
        headers: { authorization: 'Bearer caller-token' }, // lowercase
      });

      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall[1].headers as Headers;
      expect(headers.get('authorization')).toBe('Bearer caller-token');
    });
  });

  describe('FormData handling', () => {
    it('should not set content-type for FormData', async () => {
      const formData = new FormData();
      formData.append(
        'file',
        new Blob(['test'], { type: 'text/plain' }),
        'test.txt',
      );

      const responses = [createMockResponse(200, 'OK')];
      mockFetch.mockImplementation(createMockFetch(responses));

      await client.post('/api/upload', formData);

      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall[1].headers as Headers;
      expect(headers.has('content-type')).toBe(false);
    });

    it('should set content-type for JSON bodies', async () => {
      const responses = [createMockResponse(200, 'OK')];
      mockFetch.mockImplementation(createMockFetch(responses));

      await client.post('/api/data', { message: 'test' });

      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall[1].headers as Headers;
      expect(headers.get('content-type')).toBe('application/json');
    });
  });

  describe('Credentials handling', () => {
    it('should not set credentials by default', async () => {
      const responses = [createMockResponse(200, 'OK')];
      mockFetch.mockImplementation(createMockFetch(responses));

      await client.get('/api/data');

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1].credentials).toBeUndefined();
    });

    it('should use provided credentials', async () => {
      const mockFetchWithCredentials = vi.fn();
      const transport: Transport = {
        fetch: mockFetchWithCredentials,
        baseUrl: 'https://api.example.com',
        credentials: 'include',
      };

      const clientWithCredentials = new WebHttpClient(transport);
      const responses = [createMockResponse(200, 'OK')];
      mockFetchWithCredentials.mockImplementation(createMockFetch(responses));

      await clientWithCredentials.get('/api/data');

      const fetchCall = mockFetchWithCredentials.mock.calls[0];
      expect(fetchCall[1].credentials).toBe('include');
    });
  });

  describe('HEAD method', () => {
    it('should return actual headers and status', async () => {
      const mockHeaders = new Headers({
        'content-type': 'application/json',
        'cache-control': 'no-cache',
        'x-custom-header': 'test-value',
      });

      const responses = [createMockResponse(204, 'No Content', mockHeaders)];
      mockFetch.mockImplementation(createMockFetch(responses));

      const result = await client.head('/api/head-test');

      expect(result.status).toBe(204);
      expect(result.headers['content-type']).toBe('application/json');
      expect(result.headers['cache-control']).toBe('no-cache');
      expect(result.headers['x-custom-header']).toBe('test-value');
    });
  });

  describe('Signal composition', () => {
    it('should combine user signal and timeout signal', async () => {
      const responses = [createMockResponse(200, 'OK')];
      mockFetch.mockImplementation(createMockFetch(responses));

      const userSignal = new AbortController().signal;
      await client.get('/api/data', { signal: userSignal, timeoutMs: 5000 });

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1].signal).toBeDefined();
    });

    it('should handle caller abort', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      await expect(
        client.get('/api/data', { signal: abortController.signal }),
      ).rejects.toThrow(abortError);
    });
  });
});

describe('withRetry', () => {
  it('should retry HTTPError 500', async () => {
    let callCount = 0;
    const mockFn = vi.fn().mockImplementation((attempt: number) => {
      callCount++;
      if (callCount === 1) {
        const error = new Error('Internal Server Error');
        (error as any).status = 500;
        throw error;
      }
      return 'success';
    });

    const result = await withRetry(mockFn, { attempts: 3 });
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it('should retry HTTPError 429', async () => {
    let callCount = 0;
    const mockFn = vi.fn().mockImplementation((attempt: number) => {
      callCount++;
      if (callCount === 1) {
        const error = new Error('Too Many Requests');
        (error as any).status = 429;
        throw error;
      }
      return 'success';
    });

    const result = await withRetry(mockFn, { attempts: 3 });
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it('should retry TimeoutError', async () => {
    let callCount = 0;
    const mockFn = vi.fn().mockImplementation((attempt: number) => {
      callCount++;
      if (callCount === 1) {
        const error = new Error('Timeout');
        error.name = 'TimeoutError';
        throw error;
      }
      return 'success';
    });

    const result = await withRetry(mockFn, { attempts: 3 });
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it('should retry TypeError (network)', async () => {
    let callCount = 0;
    const mockFn = vi.fn().mockImplementation((attempt: number) => {
      callCount++;
      if (callCount === 1) {
        const error = new TypeError('Network error');
        throw error;
      }
      return 'success';
    });

    const result = await withRetry(mockFn, { attempts: 3 });
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it('should NOT retry AbortError', async () => {
    const mockFn = vi.fn().mockImplementation((attempt: number) => {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      throw error;
    });

    await expect(withRetry(mockFn, { attempts: 3 })).rejects.toThrow('Aborted');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should NOT retry 4xx errors (except 429)', async () => {
    const mockFn = vi.fn().mockImplementation((attempt: number) => {
      const error = new Error('Bad Request');
      (error as any).status = 400;
      throw error;
    });

    await expect(withRetry(mockFn, { attempts: 3 })).rejects.toThrow(
      'Bad Request',
    );
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should honor Retry-After header', async () => {
    let callCount = 0;
    const mockFn = vi.fn().mockImplementation((attempt: number) => {
      callCount++;
      if (callCount === 1) {
        const error = new Error('Too Many Requests');
        (error as any).status = 429;
        (error as any).headers = new Headers({ 'Retry-After': '0.1' }); // Use small delay for test
        throw error;
      }
      return 'success';
    });

    const result = await withRetry(mockFn, { attempts: 3 });
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it('should use exponential backoff with jitter', async () => {
    let callCount = 0;
    const mockFn = vi.fn().mockImplementation((attempt: number) => {
      callCount++;
      if (callCount < 3) {
        const error = new Error('Server Error');
        (error as any).status = 500;
        throw error;
      }
      return 'success';
    });

    const result = await withRetry(mockFn, { attempts: 3 });
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it('should pass attempt number to function', async () => {
    const mockFn = vi.fn().mockImplementation((attempt: number) => {
      if (attempt === 1) {
        const error = new Error('Server Error');
        (error as any).status = 500;
        throw error;
      }
      return `success-${attempt}`;
    });

    const result = await withRetry(mockFn, { attempts: 3 });
    expect(result).toBe('success-2');
    expect(mockFn).toHaveBeenCalledWith(1);
    expect(mockFn).toHaveBeenCalledWith(2);
  });
});
