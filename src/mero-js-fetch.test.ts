import { describe, expect, it, vi } from 'vitest';
import { MeroJs } from './mero-js.js';

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
});
