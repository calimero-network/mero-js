/**
 * Shared utilities for API clients
 */

// Helper type for API responses that wrap data
export type ApiResponse<T> = { data: T };

/**
 * Unwraps a response from the API format { data: T } to T.
 * 
 * Note: This function specifically checks for null/undefined, not falsy values.
 * This allows valid responses like 0, false, or empty strings to pass through.
 * 
 * @param response - Promise resolving to an ApiResponse<T>
 * @returns Promise resolving to the unwrapped data
 * @throws Error if data is null or undefined
 */
export async function unwrap<T>(
  response: Promise<ApiResponse<T>>,
): Promise<T> {
  const result = await response;
  // Check specifically for null/undefined, not falsy values
  // This allows valid responses like 0, false, or empty strings
  if (result.data === null || result.data === undefined) {
    throw new Error('Response data is null or undefined');
  }
  return result.data;
}
