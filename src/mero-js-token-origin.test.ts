import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeroJs } from './mero-js.js';
import { LocalStorageTokenStore } from './token-store/index.js';

const NODE_A = 'https://node-a.example';
const NODE_B = 'https://node-b.example';
const STORE_KEY = 'mero-tokens';

const bundle = (name: string) => ({
  access_token: `${name}-access`,
  refresh_token: `${name}-refresh`,
  expires_at: Date.now() + 3600_000,
});

const authorizationOf = (init?: RequestInit) =>
  new Headers(init?.headers).get('authorization');

// Answers every request with an empty 200 and records the Authorization header.
function recordingFetch() {
  const seen: Array<string | null> = [];
  const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(authorizationOf(init));
    return new Response('{}', { status: 200 });
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, seen };
}

describe('token persistence is bound to the issuing node', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not send node A tokens to node B through the shared default store', async () => {
    const a = new MeroJs({ baseUrl: NODE_A, tokenStore: new LocalStorageTokenStore() });
    a.setTokenData(bundle('a'));

    const { fetchFn, seen } = recordingFetch();
    const b = new MeroJs({
      baseUrl: NODE_B,
      fetch: fetchFn,
      tokenStore: new LocalStorageTokenStore(),
    });
    await b.admin.getContexts();

    expect(seen).toHaveLength(1);
    expect(seen[0] ?? '').not.toContain('a-access');
    expect(b.isAuthenticated()).toBe(false);
  });

  it('restores the tokens on the node that issued them', async () => {
    const a = new MeroJs({ baseUrl: NODE_A, tokenStore: new LocalStorageTokenStore() });
    a.setTokenData(bundle('a'));

    const { fetchFn, seen } = recordingFetch();
    const again = new MeroJs({
      baseUrl: NODE_A,
      fetch: fetchFn,
      tokenStore: new LocalStorageTokenStore(),
    });
    await again.admin.getContexts();

    expect(again.isAuthenticated()).toBe(true);
    expect(seen).toEqual(['Bearer a-access']);
  });

  it('ignores a stored bundle that carries no node origin', async () => {
    storage.set(STORE_KEY, JSON.stringify(bundle('legacy')));

    const { fetchFn, seen } = recordingFetch();
    const mero = new MeroJs({
      baseUrl: NODE_A,
      fetch: fetchFn,
      tokenStore: new LocalStorageTokenStore(),
    });
    await mero.admin.getContexts();

    expect(seen[0] ?? '').not.toContain('legacy-access');
    expect(mero.isAuthenticated()).toBe(false);
  });

  it('ignores a foreign-origin bundle when the refresh re-reads the store', async () => {
    const refreshed: string[] = [];
    let expired = true;
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/auth/refresh')) {
        refreshed.push(JSON.parse(String(init?.body)).refresh_token);
        return new Response(
          JSON.stringify({ data: { access_token: 'b-access-2', refresh_token: 'b-refresh-2' } }),
          { status: 200 },
        );
      }
      if (expired) {
        expired = false;
        return new Response('{}', { status: 401, headers: { 'x-auth-error': 'token_expired' } });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const b = new MeroJs({
      baseUrl: NODE_B,
      fetch: fetchFn,
      tokenStore: new LocalStorageTokenStore(),
    });
    b.setTokenData(bundle('b'));
    new MeroJs({ baseUrl: NODE_A, tokenStore: new LocalStorageTokenStore() }).setTokenData(
      bundle('a'),
    );

    await b.admin.getContexts();

    expect(refreshed).toEqual(['b-refresh']);
    expect(b.getTokenData()?.refresh_token).toBe('b-refresh-2');
  });
});
