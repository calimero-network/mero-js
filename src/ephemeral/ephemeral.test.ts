import { describe, it, expect, vi } from 'vitest';
import { EphemeralClient, jsonCodec, subscribePresence } from './index.js';
import { SseClient } from '../events/sse.js';
import type { EphemeralEntry } from './index.js';
import { RpcError } from '../rpc/index.js';
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

  it('throws a typed RpcError carrying the server type and data', async () => {
    // Core returns `{ type, data }` (no code/message) — an oversized slice must
    // keep the size detail instead of collapsing to Error("SliceTooLarge").
    const http = mockHttp({
      jsonrpc: '2.0',
      id: 1,
      error: { type: 'SliceTooLarge', data: { maxBytes: 16384, gotBytes: 20000 } },
    });
    const client = new EphemeralClient({ httpClient: http, sse: noopSse });

    await expect(client.set('ctx-1', { cursor: 1 })).rejects.toBeInstanceOf(RpcError);
    try {
      await client.set('ctx-1', { cursor: 1 });
      expect.unreachable('set should reject');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).type).toBe('SliceTooLarge');
      expect((e as RpcError).message).toBe('SliceTooLarge');
      expect((e as RpcError).data).toEqual({ maxBytes: 16384, gotBytes: 20000 });
    }
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

  it('passes ageMs through on a replayed seed entry', () => {
    // EXACT shape: a replay-on-subscribe seed entry carries ageMs.
    const sse = fakeSse();
    const client = new EphemeralClient({ httpClient: mockHttp({}), sse: sse as never });
    const seen: Array<EphemeralEntry<{ x: number }>> = [];
    client.subscribe<{ x: number }>('ctx-1', e => seen.push(e));

    sse.emit({
      contextId: 'ctx-1',
      type: 'Ephemeral',
      data: { author: 'A', state: encoded({ x: 1 }), ageMs: 447 },
    });

    expect(seen).toEqual([{ author: 'A', state: { x: 1 }, removed: false, ageMs: 447 }]);
  });

  it('leaves ageMs undefined (not 0) on a live delta', () => {
    // EXACT shape: a live delta carries no ageMs at all (skip_serializing_if).
    const sse = fakeSse();
    const client = new EphemeralClient({ httpClient: mockHttp({}), sse: sse as never });
    const seen: Array<EphemeralEntry<{ x: number }>> = [];
    client.subscribe<{ x: number }>('ctx-1', e => seen.push(e));

    sse.emit({ contextId: 'ctx-1', type: 'Ephemeral', data: { author: 'A', state: encoded({ x: 1 }) } });

    expect(seen[0].ageMs).toBeUndefined();
    expect('ageMs' in seen[0]).toBe(false);
  });
});

// The node replays a context's presence once, when the context is first
// subscribed on the connection. An app that mounts an event subscription
// before its presence one on the same context (useSubscription, then
// useEphemeral) subscribes once, so the replay reaches only the first
// listener — and presence, which a later listener never sees again until
// each author publishes, looked empty. The SseClient keeps what the replay
// and the live deltas said, and seeds a late presence listener from it.
describe('subscribePresence on a context the connection already holds', () => {
  const encoded = (v: unknown) => Array.from(new TextEncoder().encode(JSON.stringify(v)));
  const ephemeral = (data: Record<string, unknown>) =>
    JSON.stringify({ result: { contextId: 'ctx-1', type: 'Ephemeral', data } });

  function sseOnCtx1() {
    const sse = new SseClient({ baseUrl: 'http://localhost:4001', getAuthToken: async () => 't' });
    vi.spyOn(sse, 'connect').mockResolvedValue(undefined);
    // An earlier event listener subscribed the context; no session yet, so
    // nothing goes over the wire.
    void sse.subscribe(['ctx-1']);
    return sse;
  }

  it('a late listener gets the current presence: upserts kept, removals dropped, ages advanced', () => {
    vi.useFakeTimers();
    try {
      const sse = sseOnCtx1();
      (sse as any).handleMessage(ephemeral({ author: 'A', state: encoded({ x: 1 }), ageMs: 500 }));
      (sse as any).handleMessage(ephemeral({ author: 'B', state: encoded({ x: 2 }) }));
      (sse as any).handleMessage(ephemeral({ author: 'B', removed: true }));
      vi.advanceTimersByTime(1000);

      const seen: EphemeralEntry<{ x: number }>[] = [];
      subscribePresence<{ x: number }>(sse, 'ctx-1', (e) => seen.push(e));

      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ author: 'A', state: { x: 1 }, removed: false });
      expect(seen[0].ageMs).toBeGreaterThanOrEqual(1500);
      sse.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a late listener then gets live deltas as before', () => {
    const sse = sseOnCtx1();
    const seen: EphemeralEntry<number>[] = [];
    subscribePresence<number>(sse, 'ctx-1', (e) => seen.push(e));
    (sse as any).handleMessage(ephemeral({ author: 'C', state: encoded(7) }));
    expect(seen).toEqual([{ author: 'C', state: 7, removed: false }]);
    sse.close();
  });

  it('a reconnect drops what the old connection said: the re-subscribe brings a fresh replay', () => {
    const sse = sseOnCtx1();
    (sse as any).handleMessage(ephemeral({ author: 'A', state: encoded(1) }));
    (sse as any).handleMessage(JSON.stringify({ type: 'connect', session_id: 's2' }));
    const seen: unknown[] = [];
    subscribePresence(sse, 'ctx-1', (e) => seen.push(e));
    expect(seen).toEqual([]);
    sse.close();
  });

  it('an unsubscribed context is forgotten', () => {
    const sse = sseOnCtx1();
    (sse as any).handleMessage(ephemeral({ author: 'A', state: encoded(1) }));
    void sse.unsubscribe(['ctx-1']);
    expect(sse.presenceSeed('ctx-1')).toEqual([]);
    sse.close();
  });
});
