/**
 * Shared utilities for API clients
 */

// Helper type for API responses that wrap data
// Note: This is specifically for unwrapping { data: T } responses from the API
export type ApiResponseWrapper<T> = { data: T; error?: never } | { data?: never; error: ApiError };

/**
 * API-level error structure (returned in response body even with HTTP 200)
 * Common in RPC-style APIs where errors are semantic, not transport-level.
 */
export interface ApiError {
  type?: string;
  code?: number;
  message: string;
  data?: unknown;
}

/**
 * Custom error class for API errors that includes structured error data.
 */
export class ApiResponseError extends Error {
  public readonly type?: string;
  public readonly code?: number;
  public readonly data?: unknown;

  constructor(error: ApiError) {
    super(error.message);
    this.name = 'ApiResponseError';
    this.type = error.type;
    this.code = error.code;
    this.data = error.data;
  }
}

/**
 * Type guard to check if a response contains an error payload.
 */
function hasErrorPayload(
  response: unknown,
): response is { error: ApiError } {
  return (
    typeof response === 'object' &&
    response !== null &&
    'error' in response &&
    response.error !== null &&
    response.error !== undefined &&
    typeof (response as { error: unknown }).error === 'object'
  );
}

/**
 * Unwraps a response from the API format { data: T } to T.
 *
 * This function handles:
 * 1. Standard success responses: { data: T }
 * 2. RPC-style error responses: { error: { message, type?, code? } }
 * 3. Null/undefined data detection
 *
 * @example
 * ```typescript
 * // Success case
 * const apps = await unwrap(client.get<{ data: App[] }>('/apps'));
 * // apps is App[]
 *
 * // Error case (throws ApiResponseError)
 * const result = await unwrap(client.post('/rpc', badRequest));
 * // throws ApiResponseError with message, type, code
 * ```
 *
 * @param response - Promise resolving to an ApiResponseWrapper<T>
 * @returns Promise resolving to the unwrapped data
 * @throws ApiResponseError if the response contains an error payload
 * @throws Error if data is null or undefined
 */
export async function unwrap<T>(
  response: Promise<ApiResponseWrapper<T> | { data: T }>,
): Promise<T> {
  const result = await response;

  // Check for RPC-style error payload (even with HTTP 200)
  if (hasErrorPayload(result)) {
    throw new ApiResponseError(result.error);
  }

  // Check specifically for null/undefined, not falsy values
  // This allows valid responses like 0, false, or empty strings
  if (result.data === null || result.data === undefined) {
    throw new Error('Response data is null or undefined');
  }

  return result.data;
}

/**
 * Safely unwraps a response, returning null instead of throwing on missing data.
 * Still throws on explicit error payloads.
 *
 * @param response - Promise resolving to an ApiResponseWrapper<T>
 * @returns Promise resolving to the unwrapped data or null
 * @throws ApiResponseError if the response contains an error payload
 */
export async function unwrapOrNull<T>(
  response: Promise<ApiResponseWrapper<T> | { data: T }>,
): Promise<T | null> {
  const result = await response;

  // Check for RPC-style error payload
  if (hasErrorPayload(result)) {
    throw new ApiResponseError(result.error);
  }

  if (result.data === null || result.data === undefined) {
    return null;
  }

  return result.data;
}
