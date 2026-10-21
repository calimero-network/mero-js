// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { login } = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock('../login/index.js', async (importActual) => ({
  ...(await importActual<typeof import('../login/index.js')>()),
  login,
}));

import { HTTPError } from '../http-client/web-client.js';
import { classifyError } from '../errors/classify.js';
import { buildDelegatedClient, pinRelayNodeKey } from './session.js';
import { RelayLoginError } from './relay-login-error.js';

// A loopback relay keeps the global fetch (no sealing), so the stub below sees
// every admin request the client sends.
const RELAY = 'http://localhost:2428';
const S = { account: 'aa'.repeat(32), credential: 'cc', deviceSecret: '11'.repeat(32), relayUrl: RELAY };
const refused = (status: number) => new HTTPError(status, 'Unauthorized', `${RELAY}/auth/token`, new Headers(), '');
const unreachable = () =>
  new HTTPError(0, 'TypeError', `${RELAY}/auth/challenge`, new Headers(), 'Failed to fetch');

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  pinRelayNodeKey(RELAY, 'ab'.repeat(32));
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ data: { contexts: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const authorizationOf = (call: unknown[]): string | undefined =>
  ((call[1] as RequestInit | undefined)?.headers as Record<string, string> | undefined)?.Authorization;

describe('relay session: a failed login reaches the caller', () => {
  it('a credential the relay refuses (401) rejects the request as signed-out, without sending it', async () => {
    login.mockRejectedValueOnce(refused(401));
    const client = buildDelegatedClient(S, null)!;
    const err = await client.admin.getContexts().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RelayLoginError);
    expect(err).toMatchObject({ kind: 'signed-out', relayUrl: RELAY, loginStatus: 401 });
    expect((err as RelayLoginError).cause).toBeInstanceOf(HTTPError);
    expect(classifyError(err)).toMatchObject({ kind: 'unauthorized', retryable: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a 403 at login is a refused credential too', async () => {
    login.mockRejectedValueOnce(refused(403));
    const client = buildDelegatedClient(S, null)!;
    await expect(client.admin.getContexts()).rejects.toMatchObject({ kind: 'signed-out' });
  });

  it('a relay that cannot be reached is unavailable, and the request is not also sent unauthenticated', async () => {
    login.mockRejectedValueOnce(unreachable());
    const client = buildDelegatedClient(S, null)!;
    const err = await client.admin.getContexts().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RelayLoginError);
    expect(err).toMatchObject({ kind: 'unavailable', loginStatus: 0 });
    expect((err as Error).message).toContain('Failed to fetch');
    expect(classifyError(err)).toMatchObject({ kind: 'unreachable', retryable: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a bare fetch TypeError and a 5xx at login are unavailable', async () => {
    login.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const client = buildDelegatedClient(S, null)!;
    await expect(client.admin.getContexts()).rejects.toMatchObject({ kind: 'unavailable' });
    login.mockRejectedValueOnce(refused(502));
    await expect(client.admin.getContexts()).rejects.toMatchObject({ kind: 'unavailable', loginStatus: 502 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a successful login still sets the bearer token', async () => {
    login.mockResolvedValueOnce({ accessToken: 'tok-1', refreshToken: '' });
    const client = buildDelegatedClient(S, null)!;
    await expect(client.admin.getContexts()).resolves.toEqual({ contexts: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authorizationOf(fetchMock.mock.calls[0]!)).toBe('Bearer tok-1');
  });

  it('a failure is not remembered: the next call logs in again', async () => {
    login.mockRejectedValueOnce(unreachable());
    login.mockResolvedValueOnce({ accessToken: 'tok-2', refreshToken: '' });
    const client = buildDelegatedClient(S, null)!;
    await expect(client.admin.getContexts()).rejects.toBeInstanceOf(RelayLoginError);
    await expect(client.admin.getContexts()).resolves.toEqual({ contexts: [] });
    expect(login).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authorizationOf(fetchMock.mock.calls[0]!)).toBe('Bearer tok-2');
  });
});
