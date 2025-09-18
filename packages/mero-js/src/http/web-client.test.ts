import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebHttpClient } from './web-client';
import { Transport } from './types';

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
) => {
  const mockHeaders = headers || new Headers();
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: mockHeaders,
    json: vi.fn().mockResolvedValue({ message: 'success' }),
    text: vi.fn().mockResolvedValue('success'),
  } as Response;
};

describe('WebHttpClient Token Refresh Queueing', () => {
  let client: WebHttpClient;
  let mockFetch: ReturnType<typeof vi.fn>;
  let tokenCallCount: number;

  beforeEach(() => {
    tokenCallCount = 0;

    const transport: Transport = {
      fetch: vi.fn(),
      baseUrl: 'https://api.example.com',
      getAuthToken: vi.fn().mockImplementation(async () => {
        tokenCallCount++;
        return `token-${tokenCallCount}`;
      }),
      onTokenRefresh: vi.fn().mockImplementation(async (newToken: string) => {
        refreshCallCount++;
        // Simulate token update
        console.log(`Token refreshed to: ${newToken}`);
      }),
    };

    client = new WebHttpClient(transport);
    mockFetch = transport.fetch as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should queue concurrent requests during token refresh', async () => {
    // Setup: First request returns 401, subsequent requests succeed
    const responses = [
      createMockResponse(
        401,
        'Unauthorized',
        new Headers({ 'x-auth-error': 'token_expired' }),
      ),
      createMockResponse(200, 'OK'),
      createMockResponse(200, 'OK'),
      createMockResponse(200, 'OK'),
    ];

    mockFetch.mockImplementation(createMockFetch(responses));

    // Make multiple concurrent requests
    const request1 = client.get('/api/data1');
    const request2 = client.get('/api/data2');
    const request3 = client.get('/api/data3');

    // All requests should eventually succeed
    const [result1, result2, result3] = await Promise.all([
      request1,
      request2,
      request3,
    ]);

    expect(result1.data).toBeDefined();
    expect(result2.data).toBeDefined();
    expect(result3.data).toBeDefined();
    expect(result1.error).toBeNull();
    expect(result2.error).toBeNull();
    expect(result3.error).toBeNull();

    // Verify that fetch was called multiple times (initial + retries)
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('should not process queue until token refresh completes', async () => {
    let refreshResolve: () => void;
    const refreshPromise = new Promise<void>((resolve) => {
      refreshResolve = resolve;
    });

    // Mock the performTokenRefresh method to control timing
    const originalPerformTokenRefresh = (client as any).performTokenRefresh;
    (client as any).performTokenRefresh = vi
      .fn()
      .mockImplementation(async () => {
        await refreshPromise;
      });

    // Setup responses: 401 then 200
    const responses = [
      createMockResponse(
        401,
        'Unauthorized',
        new Headers({ 'x-auth-error': 'token_expired' }),
      ),
      createMockResponse(200, 'OK'),
      createMockResponse(200, 'OK'),
    ];

    mockFetch.mockImplementation(createMockFetch(responses));

    // Start first request (will trigger refresh)
    const request1Promise = client.get('/api/data1');

    // Wait a bit to ensure refresh has started
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Start second request while refresh is in progress (should be queued)
    const request2Promise = client.get('/api/data2');

    // Verify that the second request is queued and not yet processed
    // The second request should be queued, so we expect only 1 call so far
    expect(mockFetch).toHaveBeenCalledTimes(1); // Only initial call

    // Complete the refresh
    refreshResolve!();

    // Now both requests should complete
    const [result1, result2] = await Promise.all([
      request1Promise,
      request2Promise,
    ]);

    expect(result1.data).toBeDefined();
    expect(result2.data).toBeDefined();
    expect(result1.error).toBeNull();
    expect(result2.error).toBeNull();

    // Restore original method
    (client as any).performTokenRefresh = originalPerformTokenRefresh;
  });

  it('should handle refresh failure and reject queued requests', async () => {
    // Mock performTokenRefresh to always fail
    (client as any).performTokenRefresh = vi
      .fn()
      .mockRejectedValue(new Error('Refresh failed'));

    // Setup: First request returns 401
    const responses = [
      createMockResponse(
        401,
        'Unauthorized',
        new Headers({ 'x-auth-error': 'token_expired' }),
      ),
    ];

    mockFetch.mockImplementation(createMockFetch(responses));

    // Make concurrent requests
    const request1 = client.get('/api/data1');
    const request2 = client.get('/api/data2');

    // All requests should fail
    const [result1, result2] = await Promise.all([request1, request2]);

    expect(result1.data).toBeNull();
    expect(result2.data).toBeNull();
    expect(result1.error).toBeDefined();
    expect(result2.error).toBeDefined();
  });

  it('should not create duplicate refresh operations', async () => {
    let refreshCallCount = 0;

    // Mock performTokenRefresh to count calls
    (client as any).performTokenRefresh = vi
      .fn()
      .mockImplementation(async () => {
        refreshCallCount++;
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

    // Setup: Multiple 401 responses
    const responses = [
      createMockResponse(
        401,
        'Unauthorized',
        new Headers({ 'x-auth-error': 'token_expired' }),
      ),
      createMockResponse(
        401,
        'Unauthorized',
        new Headers({ 'x-auth-error': 'token_expired' }),
      ),
      createMockResponse(200, 'OK'),
      createMockResponse(200, 'OK'),
    ];

    mockFetch.mockImplementation(createMockFetch(responses));

    // Make multiple concurrent requests that will all trigger 401
    const requests = [
      client.get('/api/data1'),
      client.get('/api/data2'),
      client.get('/api/data3'),
    ];

    await Promise.all(requests);

    // Should only have called performTokenRefresh once
    expect(refreshCallCount).toBe(1);
  });

  it('should properly clean up refresh state on success', async () => {
    // Setup: 401 then 200
    const responses = [
      createMockResponse(
        401,
        'Unauthorized',
        new Headers({ 'x-auth-error': 'token_expired' }),
      ),
      createMockResponse(200, 'OK'),
    ];

    mockFetch.mockImplementation(createMockFetch(responses));

    // First request triggers refresh
    await client.get('/api/data1');

    // Verify refresh state is cleaned up
    expect((client as any).isRefreshing).toBe(false);
    expect((client as any).refreshPromise).toBeNull();

    // Second request should work normally (no queuing)
    const result = await client.get('/api/data2');
    expect(result.data).toBeDefined();
    expect(result.error).toBeNull();
  });

  it('should properly clean up refresh state on failure', async () => {
    // Mock performTokenRefresh to fail
    (client as any).performTokenRefresh = vi
      .fn()
      .mockRejectedValue(new Error('Refresh failed'));

    // Setup: 401 response
    const responses = [
      createMockResponse(
        401,
        'Unauthorized',
        new Headers({ 'x-auth-error': 'token_expired' }),
      ),
    ];

    mockFetch.mockImplementation(createMockFetch(responses));

    // Request should fail
    const result = await client.get('/api/data1');
    expect(result.data).toBeNull();
    expect(result.error).toBeDefined();

    // Verify refresh state is cleaned up
    expect((client as any).isRefreshing).toBe(false);
    expect((client as any).refreshPromise).toBeNull();
  });

  it('should not retry on user abort (AbortError)', async () => {
    // Mock fetch to throw AbortError when signal is aborted
    mockFetch.mockImplementation(() => {
      const error = new Error('Request aborted');
      error.name = 'AbortError';
      throw error;
    });

    const abortController = new AbortController();
    abortController.abort(); // Simulate user abort

    const result = await client.get('/api/data', {
      signal: abortController.signal,
    });

    expect(result.data).toBeNull();
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe(408); // Request timeout/abort
    expect(mockFetch).toHaveBeenCalledTimes(1); // Should not retry
  });

  it('should handle timeout (TimeoutError) without retry (retry handled by withRetry)', async () => {
    // Mock fetch to throw TimeoutError
    mockFetch.mockImplementation(() => {
      const error = new Error('Request timeout');
      error.name = 'TimeoutError';
      throw error;
    });

    const result = await client.get('/api/data');

    // Should return timeout error without retry at HTTP client level
    expect(result.data).toBeNull();
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe(408); // Request timeout
    expect(mockFetch).toHaveBeenCalledTimes(1); // No retry at HTTP client level
  });

  it('should return 429 error without retry (retry handled by withRetry)', async () => {
    const responses = [
      createMockResponse(
        429,
        'Too Many Requests',
        new Headers({ 'Retry-After': '1' }),
      ),
    ];

    mockFetch.mockImplementation(createMockFetch(responses));

    const result = await client.get('/api/data');

    expect(result.data).toBeNull();
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe(429);
    expect(mockFetch).toHaveBeenCalledTimes(1); // No retry at HTTP client level
  });

  it('should return real headers and status from HEAD request', async () => {
    const mockHeaders = new Headers({
      'content-type': 'application/json',
      'cache-control': 'no-cache',
      'x-custom-header': 'test-value',
    });

    const responses = [createMockResponse(200, 'OK', mockHeaders)];

    mockFetch.mockImplementation(createMockFetch(responses));

    const result = await client.head('/api/head-test');

    expect(result.data).toBeDefined();
    expect(result.error).toBeNull();

    const headData = result.data as {
      headers: Record<string, string>;
      status: number;
    };
    expect(headData.status).toBe(200);
    expect(headData.headers['content-type']).toBe('application/json');
    expect(headData.headers['cache-control']).toBe('no-cache');
    expect(headData.headers['x-custom-header']).toBe('test-value');
  });

  it('should not auto-set Content-Type for FormData', async () => {
    const formData = new FormData();
    formData.append(
      'file',
      new Blob(['test'], { type: 'text/plain' }),
      'test.txt',
    );

    const responses = [createMockResponse(200, 'OK')];

    mockFetch.mockImplementation(createMockFetch(responses));

    await client.post('/api/upload', formData);

    // Check that fetch was called with FormData and no Content-Type header was set
    const fetchCall = mockFetch.mock.calls[0];
    const fetchOptions = fetchCall[1];

    expect(fetchOptions.body).toBeInstanceOf(FormData);
    expect(fetchOptions.headers).not.toHaveProperty('Content-Type');
  });
});
