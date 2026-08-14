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
