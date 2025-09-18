export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  retryCondition?: (error: Error, attempt: number) => boolean;
}
export declare function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T>;
export declare function createRetryableMethod<T extends any[], R>(
  method: (...args: T) => Promise<R>,
  retryOptions?: RetryOptions,
): (...args: T) => Promise<R>;
//# sourceMappingURL=retry.d.ts.map
