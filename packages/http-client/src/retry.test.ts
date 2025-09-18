import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry } from './retry';

// Error types for testing
interface ErrorWithStatus extends Error {
  status: number;
}

interface ErrorWithHeaders extends Error {
  status: number;
  headers: Headers;
}

describe('withRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
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

    const resultPromise = withRetry(mockFn, { attempts: 3 });
    vi.advanceTimersByTime(1000); // Fast-forward through delay
    const result = await resultPromise;
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(2); // Should retry once
  });

  it('should retry on 5xx errors', async () => {
    let callCount = 0;
    const mockFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        const error = new Error('Internal Server Error');
        (error as ErrorWithStatus).status = 500;
        throw error;
      }
      return 'success';
    });

    const resultPromise = withRetry(mockFn, { attempts: 3 });
    vi.advanceTimersByTime(1000); // Fast-forward through delay
    const result = await resultPromise;
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(2); // Should retry once
  });

  it('should retry on 429 errors', async () => {
    let callCount = 0;
    const mockFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        const error = new Error('Too Many Requests');
        (error as ErrorWithStatus).status = 429;
        throw error;
      }
      return 'success';
    });

    const resultPromise = withRetry(mockFn, { attempts: 3 });
    vi.advanceTimersByTime(1000); // Fast-forward through delay
    const result = await resultPromise;
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(2); // Should retry once
  });

  it('should honor Retry-After header for 429 responses', async () => {
    let callCount = 0;
    const mockFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        const error = new Error('Too Many Requests');
        (error as ErrorWithStatus).status = 429;
        (error as ErrorWithHeaders).headers = new Headers({
          'Retry-After': '2',
        });
        throw error;
      }
      return 'success';
    });

    const resultPromise = withRetry(mockFn, { attempts: 3 });
    vi.advanceTimersByTime(2000); // Fast-forward through 2-second delay
    const result = await resultPromise;
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it('should not retry on 4xx errors (except 429)', async () => {
    const mockFn = vi.fn().mockImplementation(() => {
      const error = new Error('Bad Request');
      (error as ErrorWithStatus).status = 400;
      throw error;
    });

    await expect(withRetry(mockFn, { attempts: 3 })).rejects.toThrow(
      'Bad Request',
    );
    expect(mockFn).toHaveBeenCalledTimes(1); // Should not retry
  });

  it('should retry on network TypeError', async () => {
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

    const resultPromise = withRetry(retryMockFn, { attempts: 3 });
    vi.advanceTimersByTime(1000); // Fast-forward through delay
    const result = await resultPromise;
    expect(result).toBe('success');
    expect(retryMockFn).toHaveBeenCalledTimes(2); // Should retry
  });

  it('should use exponential backoff with jitter', async () => {
    let callCount = 0;
    const mockFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount < 3) {
        const error = new Error('Server Error');
        (error as ErrorWithStatus).status = 500;
        throw error;
      }
      return 'success';
    });

    const resultPromise = withRetry(mockFn, { attempts: 3 });

    // Fast-forward through all delays step by step
    vi.advanceTimersByTime(1000); // First retry delay
    await vi.runAllTimersAsync(); // Process any pending timers
    vi.advanceTimersByTime(2000); // Second retry delay
    await vi.runAllTimersAsync(); // Process any pending timers

    const result = await resultPromise;
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it('should pass attempt number to function', async () => {
    const mockFn = vi.fn().mockImplementation((attempt: number) => {
      if (attempt === 1) {
        const error = new Error('Server Error');
        (error as ErrorWithStatus).status = 500;
        throw error;
      }
      return `success-${attempt}`;
    });

    const resultPromise = withRetry(mockFn, { attempts: 3 });
    vi.advanceTimersByTime(1000); // Fast-forward through delay
    const result = await resultPromise;
    expect(result).toBe('success-2');
    expect(mockFn).toHaveBeenCalledWith(1);
    expect(mockFn).toHaveBeenCalledWith(2);
  });
});
