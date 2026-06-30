// Auth error wire contract (core ↔ mero-js).
//
// SINGLE SOURCE OF TRUTH for the auth failure signals the SDK keys off, so the
// values track the server in one place. Core sets these on the `x-auth-error`
// response header.

/** Response header core uses to disambiguate auth failures. Always lowercase. */
export const AUTH_ERROR_HEADER = 'x-auth-error';

/**
 * Access token expired. RECOVERABLE: a refresh is expected to mint a new pair,
 * so the reactive layer refreshes once and retries the original request.
 */
export const AUTH_ERROR_TOKEN_EXPIRED = 'token_expired';

/**
 * Refresh-token reuse detected: a consumed/rotated refresh token was replayed.
 * Core denylists the `jti` and revokes the entire token family (see core PR3).
 *
 * TERMINAL. The client MUST clear its tokens and force re-authentication, and
 * MUST NOT retry — retrying replays the consumed token and widens the blast
 * radius of the family revocation.
 *
 * Wire contract (core PR2/PR3): the refresh endpoint signals reuse as either a
 * `401` carrying this `x-auth-error` value, or a `403`. Both are treated as
 * terminal by {@link isRefreshReuseError}.
 */
export const AUTH_ERROR_TOKEN_REUSE = 'token_reuse';

/**
 * Classify a refresh failure: `true` iff it is a TERMINAL reuse / invalid-refresh
 * error (clear + force re-auth, never retry), `false` for a transient/network
 * error (keep tokens, surface to caller, never auto-retry the same refresh token).
 *
 * Duck-typed on `{ status, headers }` so it works for `HTTPError` without
 * importing it (avoids an http-client import cycle) and stays trivially testable.
 */
export function isRefreshReuseError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { status?: unknown }).status;
  // A 403 from the refresh endpoint is reuse/invalid-refresh by contract.
  if (status === 403) return true;
  if (status === 401) {
    const headers = (error as { headers?: { get?: (k: string) => string | null } }).headers;
    const code = typeof headers?.get === 'function' ? headers.get(AUTH_ERROR_HEADER) : undefined;
    return code === AUTH_ERROR_TOKEN_REUSE;
  }
  return false;
}
