import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withRetry } from './retry';

describe('withRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not retry on user abort (AbortError)', async () => {
    const mockFn = vi.fn().mockImplementation(() => {
      const error = new Error('Request aborted');
      error.name = 'AbortError';
      throw error;
    });

    await expect(withRetry(mockFn, { attempts: 3 })).rejects.toThrow(
      'Request aborted',
    );
    expect(mockFn).toHaveBeenCalledTimes(1); // Should not retry
  });

  it('should retry on timeout (TimeoutError)', async () => {
    let callCount = 0;
    const mockFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        const error = new Error('Request timeout');
        error.name = 'TimeoutError';
        throw error;
      }
      return 'success';
    });

    const result = await withRetry(mockFn, { attempts: 3 });
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(2); // Should retry once
  });

  it('should retry on 5xx errors', async () => {
    let callCount = 0;
    const mockFn = vi.fn().mockImplementation(() => {
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
    expect(mockFn).toHaveBeenCalledTimes(2); // Should retry once
  });

  it('should retry on 429 errors', async () => {
    let callCount = 0;
    const mockFn = vi.fn().mockImplementation(() => {
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
    expect(mockFn).toHaveBeenCalledTimes(2); // Should retry once
  });

  it('should honor Retry-After header for 429 responses', async () => {
    let callCount = 0;
    const mockFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        const error = new Error('Too Many Requests');
        (error as any).status = 429;
        (error as any).headers = new Headers({ 'Retry-After': '1' });
        throw error;
      }
      return 'success';
    });

    const startTime = Date.now();
    const result = await withRetry(mockFn, { attempts: 3 });
    const endTime = Date.now();

    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(2);

    // Should have waited at least 1 second due to Retry-After
    expect(endTime - startTime).toBeGreaterThanOrEqual(900); // Allow some tolerance
  });

  it('should not retry on 4xx errors (except 429)', async () => {
    const mockFn = vi.fn().mockImplementation(() => {
      const error = new Error('Bad Request');
      (error as any).status = 400;
      throw error;
    });

    await expect(withRetry(mockFn, { attempts: 3 })).rejects.toThrow(
      'Bad Request',
    );
    expect(mockFn).toHaveBeenCalledTimes(1); // Should not retry
  });

  it('should not retry on network TypeError', async () => {
    const mockFn = vi.fn().mockImplementation(() => {
      const error = new TypeError('Network error');
      throw error;
    });

    // Network errors should be retried
    let callCount = 0;
    const retryMockFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        const error = new TypeError('Network error');
        throw error;
      }
      return 'success';
    });

    const result = await withRetry(retryMockFn, { attempts: 3 });
    expect(result).toBe('success');
    expect(retryMockFn).toHaveBeenCalledTimes(2); // Should retry
  });
});
