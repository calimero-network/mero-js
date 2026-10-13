// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeroJs } from './mero-js.js';
import { LocalStorageTokenStore } from './token-store/index.js';

const NODE = 'https://node.example';
const STORE_KEY = 'mero-tokens';

const tokens = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_at: Date.now() + 3600_000,
};

// The first authenticated call is rejected as expired; every other call succeeds.
function expiringFetch() {
  const refreshCalls: string[] = [];
  let expired = true;
  const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/auth/refresh')) {
      refreshCalls.push(String(input));
      return new Response(
        JSON.stringify({ data: { access_token: 'access-2', refresh_token: 'refresh-2' } }),
        { status: 200 },
      );
    }
    if (expired) {
      expired = false;
      return new Response('{}', { status: 401, headers: { 'x-auth-error': 'token_expired' } });
    }
    return new Response('{}', { status: 200 });
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, refreshCalls };
}

// The first authenticated call is rejected as expired and its refresh is held until released.
function gatedRefreshFetch() {
  let releaseRefresh: () => void = () => undefined;
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  let refreshStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    refreshStarted = resolve;
  });
  let expired = true;
  const seen: Array<string | null> = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Headers(init?.headers).get('authorization'));
    if (String(input).endsWith('/auth/refresh')) {
      refreshStarted();
      await refreshGate;
      return new Response(
        JSON.stringify({ data: { access_token: 'access-2', refresh_token: 'refresh-2' } }),
        { status: 200 },
      );
    }
    if (expired) {
      expired = false;
      return new Response('{}', { status: 401, headers: { 'x-auth-error': 'token_expired' } });
    }
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchFn, started, releaseRefresh, seen };
}

describe('a logout in one tab holds for the others', () => {
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

  it('does not refresh from memory or re-persist tokens after another tab cleared the store', async () => {
    const tab1 = new MeroJs({ baseUrl: NODE, tokenStore: new LocalStorageTokenStore() });
    tab1.setTokenData(tokens);

    const { fetchFn, refreshCalls } = expiringFetch();
    const tab2 = new MeroJs({
      baseUrl: NODE,
      fetch: fetchFn,
      tokenStore: new LocalStorageTokenStore(),
    });
    tab1.clearToken();

    await tab2.admin.getContexts().catch(() => undefined);

    expect(refreshCalls).toEqual([]);
    expect(storage.has(STORE_KEY)).toBe(false);
    expect(tab2.isAuthenticated()).toBe(false);
    tab2.close();
  });

  it('drops in-memory tokens when a storage event shows the store was emptied', () => {
    const tab1 = new MeroJs({ baseUrl: NODE, tokenStore: new LocalStorageTokenStore() });
    tab1.setTokenData(tokens);
    const tab2 = new MeroJs({ baseUrl: NODE, tokenStore: new LocalStorageTokenStore() });
    expect(tab2.isAuthenticated()).toBe(true);

    tab1.clearToken();
    window.dispatchEvent(new StorageEvent('storage', { key: STORE_KEY }));

    expect(tab2.isAuthenticated()).toBe(false);
    tab2.close();
  });

  it('still refreshes from memory when the store cannot persist', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('storage blocked');
      },
      removeItem: () => undefined,
    });
    const { fetchFn, refreshCalls } = expiringFetch();
    const mero = new MeroJs({
      baseUrl: NODE,
      fetch: fetchFn,
      tokenStore: new LocalStorageTokenStore(),
    });
    mero.setTokenData(tokens);

    await mero.admin.getContexts();

    expect(refreshCalls).toHaveLength(1);
    expect(mero.getTokenData()?.refresh_token).toBe('refresh-2');
    mero.close();
  });

  it('does not write back tokens from a refresh that was already in flight when another tab logged out', async () => {
    const tab1 = new MeroJs({ baseUrl: NODE, tokenStore: new LocalStorageTokenStore() });
    tab1.setTokenData(tokens);

    const { fetchFn, started, releaseRefresh } = gatedRefreshFetch();
    const tab2 = new MeroJs({
      baseUrl: NODE,
      fetch: fetchFn,
      tokenStore: new LocalStorageTokenStore(),
    });

    const call = tab2.admin.getContexts().catch(() => undefined);
    await started;
    tab1.clearToken();
    window.dispatchEvent(new StorageEvent('storage', { key: STORE_KEY }));
    releaseRefresh();
    await call;

    expect(storage.has(STORE_KEY)).toBe(false);
    expect(tab2.isAuthenticated()).toBe(false);
    tab2.close();
  });

  it('does not overwrite a new login with a refresh that was already in flight when the old session logged out', async () => {
    const tab1 = new MeroJs({ baseUrl: NODE, tokenStore: new LocalStorageTokenStore() });
    tab1.setTokenData(tokens);

    const { fetchFn, started, releaseRefresh } = gatedRefreshFetch();
    const tab2 = new MeroJs({
      baseUrl: NODE,
      fetch: fetchFn,
      tokenStore: new LocalStorageTokenStore(),
    });

    const call = tab2.admin.getContexts().catch(() => undefined);
    await started;
    tab1.clearToken();
    tab1.setTokenData({ ...tokens, access_token: 'access-new', refresh_token: 'refresh-new' });
    releaseRefresh();
    await call;

    expect(JSON.parse(storage.get(STORE_KEY) ?? '{}').access_token).toBe('access-new');
    tab2.close();
  });

  describe('a logout in the same tab during an in-flight refresh', () => {
    const logoutDuringRefresh = async (tokenStore?: LocalStorageTokenStore) => {
      const { fetchFn, started, releaseRefresh } = gatedRefreshFetch();
      const mero = new MeroJs({ baseUrl: NODE, fetch: fetchFn, tokenStore });
      mero.setTokenData(tokens);

      const call = mero.admin.getContexts().catch(() => undefined);
      await started;
      mero.clearToken();
      releaseRefresh();
      await call;
      return mero;
    };

    const reLoginDuringRefresh = async (tokenStore?: LocalStorageTokenStore) => {
      const { fetchFn, started, releaseRefresh } = gatedRefreshFetch();
      const mero = new MeroJs({ baseUrl: NODE, fetch: fetchFn, tokenStore });
      mero.setTokenData(tokens);

      const call = mero.admin.getContexts().catch(() => undefined);
      await started;
      mero.clearToken();
      mero.setTokenData({ ...tokens, access_token: 'access-new', refresh_token: 'refresh-new' });
      releaseRefresh();
      await call;
      return mero;
    };

    it.each([
      ['no store', () => undefined],
      ['a persisting store', () => new LocalStorageTokenStore()],
    ])('keeps a re-login made during the refresh with %s', async (_name, makeStore) => {
      const mero = await reLoginDuringRefresh(makeStore());

      expect(mero.isAuthenticated()).toBe(true);
      expect(mero.getTokenData()?.access_token).toBe('access-new');
    });

    it('does not restore tokens with no store', async () => {
      const mero = await logoutDuringRefresh();

      expect(mero.isAuthenticated()).toBe(false);
    });

    it('does not restore tokens with a store that cannot persist', async () => {
      const setItem = vi.fn(() => {
        throw new Error('storage blocked');
      });
      vi.stubGlobal('localStorage', { getItem: () => null, setItem, removeItem: () => undefined });

      const mero = await logoutDuringRefresh(new LocalStorageTokenStore());

      expect(mero.isAuthenticated()).toBe(false);
      expect(setItem).toHaveBeenCalledTimes(1);
    });

    it('does not restore or persist tokens with a persisting store', async () => {
      const mero = await logoutDuringRefresh(new LocalStorageTokenStore());

      expect(mero.isAuthenticated()).toBe(false);
      expect(storage.has(STORE_KEY)).toBe(false);
    });
  });

  it('keeps the new login of another tab in this instance, not only in the store', async () => {
    const tab1 = new MeroJs({ baseUrl: NODE, tokenStore: new LocalStorageTokenStore() });
    tab1.setTokenData(tokens);
    const { fetchFn, started, releaseRefresh, seen } = gatedRefreshFetch();
    const tab2 = new MeroJs({
      baseUrl: NODE,
      fetch: fetchFn,
      tokenStore: new LocalStorageTokenStore(),
    });

    const call = tab2.admin.getContexts().catch(() => undefined);
    await started;
    tab1.clearToken();
    tab1.setTokenData({ ...tokens, access_token: 'access-new', refresh_token: 'refresh-new' });
    releaseRefresh();
    await call;
    await tab2.admin.getContexts();

    expect(tab2.isAuthenticated()).toBe(true);
    expect(seen[seen.length - 1]).toBe('Bearer access-new');
    tab2.close();
  });

  it('does not treat another node bundle in the store as a logout', async () => {
    const tab1 = new MeroJs({ baseUrl: NODE, tokenStore: new LocalStorageTokenStore() });
    tab1.setTokenData(tokens);
    const { fetchFn } = expiringFetch();
    const tab2 = new MeroJs({
      baseUrl: NODE,
      fetch: fetchFn,
      tokenStore: new LocalStorageTokenStore(),
    });

    new LocalStorageTokenStore().setTokens({
      access_token: 'other-access',
      refresh_token: 'other-refresh',
      expires_at: Date.now() + 3600_000,
      node_origin: 'https://other-node.example',
    });
    window.dispatchEvent(new StorageEvent('storage', { key: STORE_KEY }));
    expect(tab2.isAuthenticated()).toBe(true);

    await tab2.admin.getContexts();
    expect(tab2.isAuthenticated()).toBe(true);
    tab2.close();
  });
});
