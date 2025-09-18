// Default retry condition - retry on network errors and 5xx status codes
function defaultRetryCondition(error, attempt) {
  // Don't retry on the last attempt
  if (attempt <= 0) return false;
  // Distinguish timeout vs. user abort:
  // - Timeout: name === 'TimeoutError' (per spec/platforms)
  // - User abort: name === 'AbortError'
  const name = error?.name;
  if (name === 'TimeoutError') return true;
  if (name === 'AbortError') return false;
  // HTTP 5xx
  if ('status' in error && typeof error.status === 'number') {
    return error.status >= 500;
  }
  // Network TypeError (DNS/reset) is reasonably retryable
  if (name === 'TypeError') return true;
  return false;
}
// Calculate delay with exponential backoff and jitter
function calculateDelay(attempt, baseDelayMs, maxDelayMs, backoffFactor) {
  const delay = baseDelayMs * Math.pow(backoffFactor, attempt);
  const cappedDelay = Math.min(delay, maxDelayMs);
  // Add ±20% jitter to reduce stampedes
  const jitter = (Math.random() - 0.5) * 0.4 * cappedDelay;
  return Math.max(0, cappedDelay + jitter);
}
// Extract Retry-After header value
function getRetryAfterMs(response) {
  const retryAfter = response.headers.get('Retry-After');
  if (!retryAfter) return null;
  // If it's a number, treat as seconds
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }
  // If it's a date, calculate the difference
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }
  return null;
}
// Retry helper function
export async function withRetry(fn, options = {}) {
  const {
    attempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 10000,
    backoffFactor = 2,
    retryCondition = defaultRetryCondition,
  } = options;
  let lastError;
  for (let attempt = attempts - 1; attempt >= 0; attempt--) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
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
      if ('response' in lastError && lastError.response instanceof Response) {
        const retryAfterMs = getRetryAfterMs(lastError.response);
        if (retryAfterMs !== null) {
          delayMs = Math.max(delayMs, retryAfterMs);
        }
      }
      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
// Helper to create a retry-enabled HTTP client method
export function createRetryableMethod(method, retryOptions = {}) {
  return async (...args) => {
    return withRetry(() => method(...args), retryOptions);
  };
}
//# sourceMappingURL=retry.js.map
