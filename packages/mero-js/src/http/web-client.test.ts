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
  let refreshCallCount: number;

  beforeEach(() => {
    tokenCallCount = 0;
    refreshCallCount = 0;

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
});
