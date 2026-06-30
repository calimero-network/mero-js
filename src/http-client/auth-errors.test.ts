import { describe, it, expect } from 'vitest';
import {
  AUTH_ERROR_HEADER,
  AUTH_ERROR_TOKEN_EXPIRED,
  AUTH_ERROR_TOKEN_REUSE,
  isRefreshReuseError,
} from './auth-errors';
import { HTTPError } from './web-client';

function httpError(status: number, authError?: string): HTTPError {
  const headers = new Headers();
  if (authError) headers.set(AUTH_ERROR_HEADER, authError);
  return new HTTPError(status, 'err', 'https://node/auth/refresh', headers, '');
}

describe('auth-error wire constants', () => {
  it('pins the contract values', () => {
    expect(AUTH_ERROR_HEADER).toBe('x-auth-error');
    expect(AUTH_ERROR_TOKEN_EXPIRED).toBe('token_expired');
    expect(AUTH_ERROR_TOKEN_REUSE).toBe('token_reuse');
  });
});

describe('isRefreshReuseError', () => {
  it('is true for a 401 with x-auth-error: token_reuse', () => {
    expect(isRefreshReuseError(httpError(401, AUTH_ERROR_TOKEN_REUSE))).toBe(true);
  });

  it('is true for any 403 from the refresh endpoint', () => {
    expect(isRefreshReuseError(httpError(403))).toBe(true);
    expect(isRefreshReuseError(httpError(403, 'whatever'))).toBe(true);
  });

  it('is false for a 401 token_expired (transient/refreshable)', () => {
    expect(isRefreshReuseError(httpError(401, AUTH_ERROR_TOKEN_EXPIRED))).toBe(false);
  });

  it('is false for a bare 401 and for network/other errors', () => {
    expect(isRefreshReuseError(httpError(401))).toBe(false);
    expect(isRefreshReuseError(httpError(0))).toBe(false); // network error
    expect(isRefreshReuseError(new Error('boom'))).toBe(false);
    expect(isRefreshReuseError(undefined)).toBe(false);
    expect(isRefreshReuseError('nope')).toBe(false);
  });

  it('duck-types a plain object shaped like HTTPError', () => {
    expect(
      isRefreshReuseError({ status: 401, headers: new Headers([[AUTH_ERROR_HEADER, 'token_reuse']]) }),
    ).toBe(true);
  });
});
