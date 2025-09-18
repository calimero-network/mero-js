// Retry helper for HTTP requests
export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  retryCondition?: (error: Error, attempt: number) => boolean;
}

// Default retry condition - retry on network errors and 5xx status codes
function defaultRetryCondition(error: Error, attempt: number): boolean {
  // Don't retry on the last attempt
  if (attempt <= 0) return false;

  // Distinguish timeout vs. user abort:
  // - Timeout: name === 'TimeoutError' (per spec/platforms)
  // - User abort: name === 'AbortError'
  const name = (error as any)?.name;
  if (name === 'TimeoutError') return true;
  if (name === 'AbortError') return false;

  // HTTP 5xx (including HTTPError from web-client)
  if ('status' in (error as any) && typeof (error as any).status === 'number') {
    return (error as any).status >= 500;
  }
  // Network TypeError (DNS/reset) is reasonably retryable
  if (name === 'TypeError') return true;

  return false;
}

// Calculate delay with exponential backoff and jitter
function calculateDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  backoffFactor: number,
): number {
  const delay = baseDelayMs * Math.pow(backoffFactor, attempt);
  const cappedDelay = Math.min(delay, maxDelayMs);

  // Add ±20% jitter to reduce stampedes
  const jitter = (Math.random() - 0.5) * 0.4 * cappedDelay;
  return Math.max(0, cappedDelay + jitter);
}


// Retry helper function
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    attempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 10000,
    backoffFactor = 2,
    retryCondition = defaultRetryCondition,
  } = options;

  let lastError: Error;

  for (let attempt = attempts - 1; attempt >= 0; attempt--) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Check if we should retry (this handles the last attempt check)
      if (!retryCondition(lastError, attempt)) {
        throw lastError;
      }

      // Calculate delay
      let delayMs = calculateDelay(
        attempts - attempt - 1,
        baseDelayMs,
        maxDelayMs,
        backoffFactor,
      );

      // Check for Retry-After header if it's an HTTP error
      type HasHeaders = { headers?: Headers };
      const hdrs = (lastError as HasHeaders).headers;
      const retryAfter = hdrs?.get?.('Retry-After');
      if (retryAfter) {
        // If it's a number, treat as seconds
        const seconds = parseInt(retryAfter, 10);
        if (!isNaN(seconds)) {
          delayMs = Math.max(delayMs, seconds * 1000);
        } else {
          // If it's a date, calculate the difference
          const date = new Date(retryAfter);
          if (!isNaN(date.getTime())) {
            delayMs = Math.max(delayMs, Math.max(0, date.getTime() - Date.now()));
          }
        }
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError!;
}

// Helper to create a retry-enabled HTTP client method
export function createRetryableMethod<T extends any[], R>(
  method: (...args: T) => Promise<R>,
  retryOptions: RetryOptions = {},
) {
  return async (...args: T): Promise<R> => {
    return withRetry(() => method(...args), retryOptions);
  };
}
