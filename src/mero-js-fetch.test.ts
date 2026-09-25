import { describe, expect, it, vi } from 'vitest';
import { MeroJs } from './mero-js.js';

// MeroJsConfig.fetch reaches the one shared transport that admin, auth, and
// rpc all consume, and the default (no override) path must not regress.
describe('MeroJs custom fetch', () => {
  it('uses the configured fetch for an admin call', async () => {
    const globalFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', globalFetch);
    const customFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));

    const mero = new MeroJs({ baseUrl: 'https://relay.example', fetch: customFetch });
    await mero.admin.getContexts().catch(() => undefined);

    expect(customFetch).toHaveBeenCalledOnce();
    expect(globalFetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('uses the configured fetch for an rpc call', async () => {
    const globalFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', globalFetch);
    const customFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));

    const mero = new MeroJs({ baseUrl: 'https://relay.example', fetch: customFetch });
    await mero.rpc.execute({ contextId: 'ctx', method: 'noop' }).catch(() => undefined);

    expect(customFetch).toHaveBeenCalledOnce();
    expect(globalFetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('falls back to global fetch when no fetch is configured', async () => {
    const globalFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', globalFetch);

    const mero = new MeroJs({ baseUrl: 'https://relay.example' });
    await mero.admin.getContexts().catch(() => undefined);

    expect(globalFetch).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  // Browsers throw "Illegal invocation" if fetch is invoked through an
  // unbound reference; this fetch only succeeds when called as `this === globalThis`.
  it('keeps the global fetch receiver on the default path', async () => {
    const globalFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) {
        throw new TypeError(
          "Failed to execute 'fetch' on 'Window': Illegal invocation",
        );
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', globalFetch);

    const mero = new MeroJs({ baseUrl: 'https://relay.example' });
    // `{}` has no `data` field, so a successful call unwraps to undefined;
    // a rejection here means fetch was invoked through an unbound reference.
    await expect(mero.admin.getContexts()).resolves.toBeUndefined();
    expect(globalFetch).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
