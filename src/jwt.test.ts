import { describe, it, expect } from 'vitest';
import {
  decodeJwtPayload,
  expiresAtFromJwt,
  tokenTypeFromJwt,
  permissionsFromJwt,
  isRefreshTokenInAccessSlot,
} from './jwt';

/** Build an unsigned (fake-signature) JWT carrying the given claims. */
function makeJwt(claims: Record<string, unknown>): string {
  const b64url = (o: unknown): string =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(claims)}.fakesig`;
}

describe('decodeJwtPayload', () => {
  it('decodes a well-formed JWT payload', () => {
    const token = makeJwt({ sub: 'user-1', token_type: 'access' });
    expect(decodeJwtPayload(token)).toMatchObject({ sub: 'user-1', token_type: 'access' });
  });

  it('returns null for a non-JWT string', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
    expect(decodeJwtPayload('a.b')).toBeNull();
    expect(decodeJwtPayload('')).toBeNull();
  });

  it('returns null for an undecodable payload segment', () => {
    expect(decodeJwtPayload('aaa.!!!notbase64!!!.ccc')).toBeNull();
  });
});

describe('expiresAtFromJwt', () => {
  it('extracts exp as a ms timestamp', () => {
    const expSeconds = 1_900_000_000;
    const token = makeJwt({ exp: expSeconds });
    expect(expiresAtFromJwt(token, 0)).toBe(expSeconds * 1000);
  });

  it('falls back when there is no exp claim', () => {
    const token = makeJwt({ sub: 'x' });
    expect(expiresAtFromJwt(token, 12345)).toBe(12345);
  });

  it('falls back for a non-JWT', () => {
    expect(expiresAtFromJwt('mock-access-token', 999)).toBe(999);
  });
});

describe('tokenTypeFromJwt', () => {
  it('returns the lowercased token_type claim', () => {
    expect(tokenTypeFromJwt(makeJwt({ token_type: 'access' }))).toBe('access');
    expect(tokenTypeFromJwt(makeJwt({ token_type: 'Refresh' }))).toBe('refresh');
  });

  it('returns undefined when absent or not a JWT', () => {
    expect(tokenTypeFromJwt(makeJwt({ sub: 'x' }))).toBeUndefined();
    expect(tokenTypeFromJwt('mock-token')).toBeUndefined();
  });
});

describe('permissionsFromJwt', () => {
  it('returns the permissions claim as a string array', () => {
    const token = makeJwt({ permissions: ['admin', 'context:read'] });
    expect(permissionsFromJwt(token)).toEqual(['admin', 'context:read']);
  });

  it('filters out non-string entries', () => {
    const token = makeJwt({ permissions: ['admin', 42, null, 'ok'] });
    expect(permissionsFromJwt(token)).toEqual(['admin', 'ok']);
  });

  it('returns [] when there is no permissions claim or not a JWT', () => {
    expect(permissionsFromJwt(makeJwt({ sub: 'x' }))).toEqual([]);
    expect(permissionsFromJwt('mock-access-token')).toEqual([]);
  });

  it('surfaces a SHRUNK permission set (fewer than requested)', () => {
    // Requested ['admin','context:write'] but the node granted only read.
    const issued = makeJwt({ permissions: ['context:read'] });
    expect(permissionsFromJwt(issued)).toEqual(['context:read']);
  });
});

describe('isRefreshTokenInAccessSlot', () => {
  it('is true only for an explicit refresh token_type', () => {
    expect(isRefreshTokenInAccessSlot(makeJwt({ token_type: 'refresh' }))).toBe(true);
    expect(isRefreshTokenInAccessSlot(makeJwt({ token_type: 'Refresh' }))).toBe(true);
  });

  it('is false for an access token, a typeless token, or a non-JWT', () => {
    expect(isRefreshTokenInAccessSlot(makeJwt({ token_type: 'access' }))).toBe(false);
    expect(isRefreshTokenInAccessSlot(makeJwt({ sub: 'x' }))).toBe(false);
    expect(isRefreshTokenInAccessSlot('mock-access-token')).toBe(false);
  });
});
