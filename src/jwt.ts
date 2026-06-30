// JWT claim decoding helpers (read-only, signature is NOT verified here).
//
// The SDK only ever *reads* claims from tokens the node issued in order to make
// local decisions (expiry, token-type assertion, effective permissions). It must
// never trust these for authorization — the node re-verifies on every request.

/**
 * Canonical `token_type` claim values (must mirror core's `TokenType` serde
 * representation). Compared case-insensitively by the helpers below so a
 * PascalCase/lowercase serde skew on the core side cannot silently defeat the
 * client-side defense-in-depth check.
 */
export const ACCESS_TOKEN_TYPE = 'access';
export const REFRESH_TOKEN_TYPE = 'refresh';

/**
 * Decode a JWT payload without verifying its signature. Returns the parsed
 * claims object, or `null` if the token is not a well-formed JWT.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // JWT uses base64url encoding: replace -/_ with +// and add padding.
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const json =
      typeof atob === 'function'
        ? atob(b64)
        : // Node fallback (no atob): decode via Buffer.
          (globalThis as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } })
            .Buffer?.from(b64, 'base64')
            .toString('binary') ?? '';
    const payload = JSON.parse(json);
    return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  } catch {
    // Not a JWT or can't parse.
    return null;
  }
}

/** Try to extract `exp` (seconds) from a JWT, return ms timestamp or fallback. */
export function expiresAtFromJwt(token: string, fallbackMs: number): number {
  const payload = decodeJwtPayload(token);
  if (payload && typeof payload.exp === 'number') {
    return payload.exp * 1000;
  }
  return fallbackMs;
}

/**
 * The `token_type` claim, lowercased, or `undefined` if the token is not a JWT
 * or carries no `token_type` claim.
 */
export function tokenTypeFromJwt(token: string): string | undefined {
  const payload = decodeJwtPayload(token);
  const t = payload?.token_type;
  return typeof t === 'string' ? t.toLowerCase() : undefined;
}

/**
 * The EFFECTIVE permissions granted by an access token, as decoded from its
 * `permissions` claim. This is what the node actually issued — which, after
 * core's live re-derivation (#10), may be FEWER than what was requested. Returns
 * `[]` when the token is not a JWT or declares no permissions.
 */
export function permissionsFromJwt(token: string): string[] {
  const payload = decodeJwtPayload(token);
  const perms = payload?.permissions;
  if (Array.isArray(perms)) {
    return perms.filter((p): p is string => typeof p === 'string');
  }
  return [];
}

/**
 * True iff the token's `token_type` claim explicitly identifies it as a REFRESH
 * token. A refresh token must never be presented as a bearer/access token.
 *
 * Note the asymmetry: a token with no decodable `token_type` (e.g. a legacy or
 * mock token) is NOT flagged here — we only reject what we can prove is a
 * refresh token, so this stays a safe, non-breaking guard.
 */
export function isRefreshTokenInAccessSlot(token: string): boolean {
  return tokenTypeFromJwt(token) === REFRESH_TOKEN_TYPE;
}
