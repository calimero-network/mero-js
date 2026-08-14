import { describe, it, expect, vi } from 'vitest';
import { EphemeralClient, jsonCodec } from './index.js';
import type { HttpClient } from '../http-client/index.js';

function mockHttp(postResponse: unknown): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn().mockResolvedValue(postResponse),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    head: vi.fn(),
    request: vi.fn(),
  } as unknown as HttpClient;
}

// A minimal SseClient stand-in; Task 1 never touches it.
const noopSse = { on: vi.fn(), off: vi.fn(), connect: vi.fn(), subscribe: vi.fn() } as never;

describe('jsonCodec', () => {
  it('round-trips a value through a byte array', () => {
    const c = jsonCodec<{ x: number }>();
    const bytes = c.encode({ x: 7 });
    expect(Array.isArray(bytes)).toBe(true);
    expect(bytes.every(b => typeof b === 'number')).toBe(true);
    expect(c.decode(bytes)).toEqual({ x: 7 });
  });
});

describe('EphemeralClient.set', () => {
  it('posts set_ephemeral with the encoded state and no author', async () => {
    const http = mockHttp({ jsonrpc: '2.0', id: 1, result: {} });
    const client = new EphemeralClient({ httpClient: http, sse: noopSse });

    await client.set('ctx-1', { cursor: 1 });

    expect(http.post).toHaveBeenCalledTimes(1);
    const [path, body] = (http.post as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toBe('/jsonrpc');
    expect(body.method).toBe('set_ephemeral');
    expect(body.params.contextId).toBe('ctx-1');
    expect(Array.isArray(body.params.state)).toBe(true);
    // The author is resolved server-side; a client cannot set it.
    expect(body.params).not.toHaveProperty('author');
  });

  it('throws on an RPC error rather than resolving silently', async () => {
    const http = mockHttp({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'nope' } });
    const client = new EphemeralClient({ httpClient: http, sse: noopSse });
    await expect(client.set('ctx-1', { cursor: 1 })).rejects.toThrow('nope');
  });
});

describe('EphemeralClient.get', () => {
  it('decodes the author-keyed map into entries carrying ageMs', async () => {
    // EXACT shape captured from a live node (core 11418a3c).
    const state = Array.from(new TextEncoder().encode(JSON.stringify({ cursor: 9 })));
    const http = mockHttp({
      jsonrpc: '2.0',
      id: 1,
      result: { entries: { 'AUTHOR_A': { state, ageMs: 447 } } },
    });
    const client = new EphemeralClient({ httpClient: http, sse: noopSse });

    const entries = await client.get<{ cursor: number }>('ctx-1');

    expect(entries).toEqual([{ author: 'AUTHOR_A', state: { cursor: 9 }, ageMs: 447 }]);
  });

  it('returns an empty array when the snapshot is empty', async () => {
    const http = mockHttp({ jsonrpc: '2.0', id: 1, result: { entries: {} } });
    const client = new EphemeralClient({ httpClient: http, sse: noopSse });
    expect(await client.get('ctx-1')).toEqual([]);
  });
});

describe('EphemeralClient.subscribe', () => {
  function fakeSse() {
    const handlers: Array<(e: unknown) => void> = [];
    return {
      handlers,
      on: vi.fn((_evt: string, h: (e: unknown) => void) => { handlers.push(h); }),
      off: vi.fn((_evt: string, h: (e: unknown) => void) => {
        const i = handlers.indexOf(h);
        if (i >= 0) handlers.splice(i, 1);
      }),
      connect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      emit: (e: unknown) => handlers.forEach(h => h(e)),
    };
  }

  const encoded = (v: unknown) => Array.from(new TextEncoder().encode(JSON.stringify(v)));

  it('delivers only Ephemeral events for the requested context', () => {
    const sse = fakeSse();
    const client = new EphemeralClient({ httpClient: mockHttp({}), sse: sse as never });
    const seen: unknown[] = [];
    client.subscribe('ctx-1', e => seen.push(e));

    // Wrong type -> ignored.
    sse.emit({ contextId: 'ctx-1', type: 'AppVersionChanged', data: {} });
    // Wrong context -> ignored.
    sse.emit({ contextId: 'ctx-2', type: 'Ephemeral', data: { author: 'A', state: encoded(1) } });
    // Match.
    sse.emit({ contextId: 'ctx-1', type: 'Ephemeral', data: { author: 'A', state: encoded({ x: 1 }) } });

    expect(seen).toEqual([{ author: 'A', state: { x: 1 }, removed: false }]);
  });

  it('treats a MISSING removed as an upsert and a true removed as a removal', () => {
    const sse = fakeSse();
    const client = new EphemeralClient({ httpClient: mockHttp({}), sse: sse as never });
    const seen: Array<{ author: string; removed?: boolean; state?: unknown }> = [];
    client.subscribe('ctx-1', e => seen.push(e));

    // Core omits `removed` entirely on an upsert (skip_serializing_if).
    sse.emit({ contextId: 'ctx-1', type: 'Ephemeral', data: { author: 'A', state: encoded({ x: 1 }) } });
    // On a removal, `state` is omitted and `removed` is true.
    sse.emit({ contextId: 'ctx-1', type: 'Ephemeral', data: { author: 'A', removed: true } });

    expect(seen[0].removed).toBe(false);
    expect(seen[0].state).toEqual({ x: 1 });
    expect(seen[1].removed).toBe(true);
    expect(seen[1].state).toBeUndefined();
  });

  it('does not throw when a removal arrives with no state to decode', () => {
    const sse = fakeSse();
    const client = new EphemeralClient({ httpClient: mockHttp({}), sse: sse as never });
    client.subscribe('ctx-1', () => {});
    expect(() =>
      sse.emit({ contextId: 'ctx-1', type: 'Ephemeral', data: { author: 'A', removed: true } }),
    ).not.toThrow();
  });

  it('stops delivering after the returned unsubscribe is called', () => {
    const sse = fakeSse();
    const client = new EphemeralClient({ httpClient: mockHttp({}), sse: sse as never });
    const seen: unknown[] = [];
    const unsubscribe = client.subscribe('ctx-1', e => seen.push(e));

    unsubscribe();
    sse.emit({ contextId: 'ctx-1', type: 'Ephemeral', data: { author: 'A', state: encoded(1) } });

    expect(seen).toEqual([]);
    expect(sse.off).toHaveBeenCalled();
  });

  it('leaves data.state as a raw byte array (mero-js auto-decode must not fire)', () => {
    // SseClient auto-decodes a byte-array `data` (sse.ts:215-225). Presence
    // `data` is an OBJECT so that decode does not fire, and the nested
    // `data.state` must reach us raw for the codec to decode. If a future
    // change recursed into nested arrays, this test fails loudly.
    const sse = fakeSse();
    const client = new EphemeralClient({ httpClient: mockHttp({}), sse: sse as never });
    let received: { x: number } | undefined;
    client.subscribe<{ x: number }>('ctx-1', e => { received = e.state; });
    sse.emit({ contextId: 'ctx-1', type: 'Ephemeral', data: { author: 'A', state: encoded({ x: 42 }) } });
    expect(received).toEqual({ x: 42 });
  });
});
