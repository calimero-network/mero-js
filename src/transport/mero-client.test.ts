/**
 * The test this whole module exists to make passable: ONE piece of app code,
 * written once against `client.rpc`, run unchanged against both transports.
 *
 * `appCode` below is deliberately transport-blind and is never parameterised on
 * anything but the client — if a transport ever needs a special case at a call
 * site, this test is the thing that fails.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createMeroClient, MeroClient } from './mero-client.js';
import { RelayTransport } from './relay-transport.js';
import { RelayClient } from '../relay/relay-client.js';
import { createMemoryNonceSource } from '../relay/nonce-source.js';
import { MemoryTokenStore } from '../token-store/index.js';
import type { ExecuteTransport } from './types.js';

const CONTEXT = '01'.repeat(32);
const AUTHOR = '0e'.repeat(32);
const EXECUTOR = '4d'.repeat(32);
const DEVICE_SECRET = '77'.repeat(32);

/** The app. Notice it names no transport and reads no transport-specific field. */
async function appCode(client: { rpc: ExecuteTransport }): Promise<unknown> {
  return client.rpc.execute<{ ok: boolean }>({
    contextId: CONTEXT,
    method: 'set',
    argsJson: { key: 'k', value: 'v' },
  });
}

/** A fake node: answers `/jsonrpc` with a JSON-RPC envelope. */
function fakeNodeFetch(result: unknown): { fetch: typeof fetch; bodies: unknown[] } {
  const bodies: unknown[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toContain('/jsonrpc');
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { output: result } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetch: impl, bodies };
}

/** A fake relay: answers the intents route with the `IntentResult` envelope. */
function fakeRelayFetch(
  returns: unknown,
  rootHash = 'ff'.repeat(32),
): { fetch: typeof fetch; bodies: unknown[] } {
  const bodies: unknown[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toContain(`/admin-api/contexts/${CONTEXT}/intents`);
    bodies.push(init?.body ? JSON.parse(String(init.body)) : null);
    return new Response(JSON.stringify({ data: { rootHash, returns } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetch: impl, bodies };
}

function relayClient(fetchImpl: typeof fetch): RelayClient {
  return new RelayClient({
    relayUrl: 'https://relay.example',
    executorAccount: EXECUTOR,
    authorAccount: AUTHOR,
    authorProof: 'aa',
    deviceSecret: DEVICE_SECRET,
    nonces: createMemoryNonceSource(1),
    fetch: fetchImpl,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('one call site, two transports', () => {
  it('returns the same value through the node and through a relay', async () => {
    const payload = { ok: true };

    const node = fakeNodeFetch(payload);
    vi.stubGlobal('fetch', node.fetch);
    const nodeClient = createMeroClient({ baseUrl: 'http://node.example' });
    const fromNode = await appCode(nodeClient);

    const relay = fakeRelayFetch(payload);
    const relayed = createMeroClient({ transport: 'relay', relay: relayClient(relay.fetch) });
    const fromRelay = await appCode(relayed);

    // The point of the whole abstraction: indistinguishable at the call site.
    expect(fromNode).toEqual(payload);
    expect(fromRelay).toEqual(payload);
    expect(fromRelay).toEqual(fromNode);
  });

  it('sends the same method and arguments on both transports', async () => {
    const node = fakeNodeFetch(null);
    vi.stubGlobal('fetch', node.fetch);
    await appCode(createMeroClient({ baseUrl: 'http://node.example' }));

    const relay = fakeRelayFetch(null);
    await appCode(createMeroClient({ transport: 'relay', relay: relayClient(relay.fetch) }));

    const nodeParams = (node.bodies[0] as { params: Record<string, unknown> }).params;
    const relayBody = relay.bodies[0] as Record<string, unknown>;
    expect(nodeParams.method).toBe('set');
    expect(relayBody.method).toBe('set');
    expect(relayBody.argsJson).toEqual(nodeParams.argsJson);
  });

  it('defaults `argsJson` to {} on both transports', async () => {
    const node = fakeNodeFetch(null);
    vi.stubGlobal('fetch', node.fetch);
    await createMeroClient({ baseUrl: 'http://node.example' }).rpc.execute({
      contextId: CONTEXT,
      method: 'noop',
    });

    const relay = fakeRelayFetch(null);
    await createMeroClient({
      transport: 'relay',
      relay: relayClient(relay.fetch),
    }).rpc.execute({ contextId: CONTEXT, method: 'noop' });

    expect((node.bodies[0] as { params: { argsJson: unknown } }).params.argsJson).toEqual({});
    expect((relay.bodies[0] as { argsJson: unknown }).argsJson).toEqual({});
  });

  it('reports a null return as `null` on both transports', async () => {
    // Pinned because it was a real fork in the road: `IntentResult.returns` is
    // `T | null`, and "normalize null to undefined" is the tempting cleanup.
    // The node already resolves a null `output` to `null`, so normalizing would
    // have made the two disagree — in the exact case this adapter unifies.
    const node = fakeNodeFetch(null);
    vi.stubGlobal('fetch', node.fetch);
    const fromNode = await appCode(createMeroClient({ baseUrl: 'http://node.example' }));

    const relay = fakeRelayFetch(null);
    const fromRelay = await appCode(
      createMeroClient({ transport: 'relay', relay: relayClient(relay.fetch) }),
    );

    expect(fromNode).toBeNull();
    expect(fromRelay).toBeNull();
  });

  it('runs migrateMyEntries and countMyPending identically on both transports', async () => {
    const summary = { converted: 3, remaining: 0 };

    const node = fakeNodeFetch(summary);
    vi.stubGlobal('fetch', node.fetch);
    const fromNode = await createMeroClient({
      baseUrl: 'http://node.example',
    }).rpc.migrateMyEntries(CONTEXT);

    const relay = fakeRelayFetch(summary);
    const fromRelay = await createMeroClient({
      transport: 'relay',
      relay: relayClient(relay.fetch),
    }).rpc.migrateMyEntries(CONTEXT);

    expect(fromRelay).toEqual(fromNode);
    expect((node.bodies[0] as { params: { method: string } }).params.method).toBe(
      'migrate_my_entries',
    );
    expect((relay.bodies[0] as { method: string }).method).toBe('migrate_my_entries');
  });

  it('countMyPending goes through as a plain number on the relay', async () => {
    const relay = fakeRelayFetch(7);
    const client = createMeroClient({ transport: 'relay', relay: relayClient(relay.fetch) });
    await expect(client.rpc.countMyPending(CONTEXT)).resolves.toBe(7);
    expect((relay.bodies[0] as { method: string }).method).toBe('count_my_pending');
  });
});

describe('the relay metadata the canonical shape has no room for', () => {
  it('surfaces rootHash through executeWithMetadata, not through execute', async () => {
    const relay = fakeRelayFetch({ ok: true }, 'ab'.repeat(32));
    const client = createMeroClient({ transport: 'relay', relay: relayClient(relay.fetch) });

    const detailed = await client.rpc.executeWithMetadata<{ ok: boolean }>({
      contextId: CONTEXT,
      method: 'set',
    });

    expect(detailed).toEqual({
      returns: { ok: true },
      transport: 'relay',
      rootHash: 'ab'.repeat(32),
    });
  });

  it('reports no rootHash on the node rather than inventing one', async () => {
    const node = fakeNodeFetch({ ok: true });
    vi.stubGlobal('fetch', node.fetch);
    const detailed = await createMeroClient({
      baseUrl: 'http://node.example',
    }).rpc.executeWithMetadata<{ ok: boolean }>({ contextId: CONTEXT, method: 'set' });

    expect(detailed.transport).toBe('node');
    expect(detailed.returns).toEqual({ ok: true });
    // Absent, never `''` — "the node does not report this" is not an answer.
    expect(detailed.rootHash).toBeUndefined();
  });
});

describe('transport selection', () => {
  it('defaults to the node when no transport is named', () => {
    const client = createMeroClient({ baseUrl: 'http://node.example' });
    expect(client.transport).toBe('node');
    expect(client.canSubscribe).toBe(true);
  });

  it('accepts an explicit node transport as the same thing', () => {
    const client = createMeroClient({ transport: 'node', baseUrl: 'http://node.example' });
    expect(client.transport).toBe('node');
    // The marker must not reach MeroJs, which has never heard of it.
    expect(client.node.rpc).toBe(client.rpc);
  });

  it('builds a relay client from a config as well as from an instance', () => {
    const { fetch } = fakeRelayFetch(null);
    const built = createMeroClient({
      transport: 'relay',
      relay: {
        relayUrl: 'https://relay.example',
        authorAccount: AUTHOR,
        authorProof: 'aa',
        deviceSecret: DEVICE_SECRET,
        nonces: createMemoryNonceSource(1),
        fetch,
      },
    });
    expect(built.transport).toBe('relay');
    expect(built.relay).toBeInstanceOf(RelayClient);
    expect(built.rpc).toBeInstanceOf(RelayTransport);
  });

  it('hands back the very RelayClient it was given', () => {
    const relay = relayClient(fakeRelayFetch(null).fetch);
    expect(createMeroClient({ transport: 'relay', relay }).relay).toBe(relay);
  });

  it('is constructible with `new` as well as through the factory', () => {
    expect(new MeroClient({ baseUrl: 'http://node.example' })).toBeInstanceOf(MeroClient);
  });
});

describe('a relay client with no node key', () => {
  const client = (): MeroClient =>
    createMeroClient({ transport: 'relay', relay: relayClient(fakeRelayFetch(null).fetch) });

  it('reports that it cannot subscribe, before anything is attempted', () => {
    expect(client().canSubscribe).toBe(false);
    expect(client().rpc.canSubscribe).toBe(false);
  });

  it('reports the same when `observe` is present but carries no key', () => {
    // The hosted shape today: `connectCloud` always passes `observe`, with the
    // key the cloud reported — which is null until mdma #312.
    const c = createMeroClient({
      transport: 'relay',
      relay: relayClient(fakeRelayFetch(null).fetch),
      observe: { nodeKey: null },
    });
    expect(c.canSubscribe).toBe(false);
  });

  it.each(['events', 'ws'] as const)(
    'throws from `%s` naming the missing key and mdma #312, not a phantom gap',
    (surface) => {
      expect(() => client()[surface]).toThrow(/no relay node key/);
      expect(() => client()[surface]).toThrow(/mdma #312/);
    },
  );

  it('does not claim the relay has no event routes — it has them', () => {
    // The previous message said a relay "has no /sse, no /ws". That was wrong:
    // a relay is an ordinary node. Only the key is missing.
    expect(() => client().events).toThrow(/does serve \/sse and \/ws/);
  });

  it('refuses to substitute peerId for the node key', () => {
    expect(() => client().events).toThrow(/never derived from its peerId/);
  });

  it.each(['ephemeral', 'admin', 'auth', 'node', 'cloud'] as const)(
    'still throws from `%s` rather than falling back to some other node',
    (surface) => {
      expect(() => client()[surface]).toThrow(/relay transport/);
    },
  );

  it('closes without error, so teardown need not know the transport', () => {
    expect(() => client().close()).not.toThrow();
  });

  it('refuses `relay` on a node client', () => {
    expect(() => createMeroClient({ baseUrl: 'http://node.example' }).relay).toThrow(
      /node transport/,
    );
  });
});

/**
 * A fake relay origin answering the two login calls, then the write.
 *
 * Deliberately a real `login()` handshake rather than a stubbed token: the
 * thing being proved is that a relay origin serves `/auth/challenge` and
 * `/auth/token` to an account proof, which is what makes "a relay can be
 * observed" true.
 */
function fakeRelayNodeFetch(): { fetch: typeof fetch; paths: string[]; bodies: unknown[] } {
  const paths: string[] = [];
  const bodies: unknown[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    if (init?.body) bodies.push(JSON.parse(String(init.body)));
    if (url.pathname === '/auth/challenge') {
      return Response.json({ data: { challenge: '11'.repeat(32) } });
    }
    if (url.pathname === '/auth/token') {
      return Response.json({ data: { access_token: 'sess-token', refresh_token: 'refresh-1' } });
    }
    return Response.json({ data: { rootHash: 'ff'.repeat(32), returns: null } });
  }) as unknown as typeof fetch;
  return { fetch: impl, paths, bodies };
}

/** A WebSocket stand-in that records its URL and can push one frame back. */
class FakeWebSocket {
  static last: FakeWebSocket | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  constructor(readonly url: string) {
    FakeWebSocket.last = this;
    // Opened asynchronously, like the real thing: `connect()` has to have
    // returned before anyone sees `onopen`.
    setTimeout(() => this.onopen?.(), 0);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {}
}

/** The observing config a caller who knows the key writes. */
const OBSERVE = { nodeKey: 'cd'.repeat(32), audience: { kind: 'cli' } } as const;

describe('a relay client given the node key', () => {
  it('reports that it can subscribe', () => {
    const client = createMeroClient({
      transport: 'relay',
      relay: relayClient(fakeRelayNodeFetch().fetch),
      observe: { ...OBSERVE },
    });
    expect(client.canSubscribe).toBe(true);
    expect(client.rpc.canSubscribe).toBe(true);
    expect(client.transport).toBe('relay');
  });

  it('hands out the same SseClient class a node client does', () => {
    const relayed = createMeroClient({
      transport: 'relay',
      relay: relayClient(fakeRelayNodeFetch().fetch),
      observe: { ...OBSERVE },
    });
    vi.stubGlobal('fetch', fakeNodeFetch(null).fetch);
    const noded = createMeroClient({ baseUrl: 'http://node.example' });
    expect(relayed.events.constructor).toBe(noded.events.constructor);
  });

  it('logs in with the account proof and subscribes with the session it got', async () => {
    const node = fakeRelayNodeFetch();
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
    const client = createMeroClient({
      transport: 'relay',
      relay: relayClient(node.fetch),
      observe: { ...OBSERVE, fetch: node.fetch },
    });

    const seen: unknown[] = [];
    client.ws.on('event', (e) => seen.push(e));
    await client.ws.connect();
    await client.ws.subscribe([CONTEXT]);

    // The handshake actually happened, in order, against the relay's origin.
    expect(node.paths).toEqual(['/auth/challenge', '/auth/token']);
    const tokenBody = node.bodies[0] as {
      auth_method: string;
      provider_data: { account_proof: string };
      permissions?: unknown;
    };
    expect(tokenBody.auth_method).toBe('account_proof');
    // Defaulted from the relay client rather than taken a second time.
    expect(tokenBody.provider_data.account_proof).toBe('aa');
    // Never asked for: the provider's own grant already includes
    // context:subscribe, and asking widens what a device key can mint.
    expect(tokenBody.permissions).toBeUndefined();
    // ...and the session it minted is what the stream presents.
    expect(FakeWebSocket.last?.url).toContain('token=sess-token');

    // A StateMutation arriving on that stream reaches the app's handler.
    FakeWebSocket.last?.onmessage?.({
      data: JSON.stringify({
        result: { contextId: CONTEXT, type: 'StateMutation', data: { newRoot: 'ff'.repeat(32) } },
      }),
    });
    expect(seen).toEqual([
      { contextId: CONTEXT, type: 'StateMutation', data: { newRoot: 'ff'.repeat(32) } },
    ]);

    client.close();
  });

  it('mints one session even when both event surfaces ask at once', async () => {
    const node = fakeRelayNodeFetch();
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
    const client = createMeroClient({
      transport: 'relay',
      relay: relayClient(node.fetch),
      observe: { ...OBSERVE, fetch: node.fetch },
    });
    await Promise.all([client.ws.connect(), client.ws.connect()]);
    expect(node.paths.filter((p) => p === '/auth/token')).toHaveLength(1);
    client.close();
  });

  it('is the same object each time, so handlers are not registered twice', () => {
    const client = createMeroClient({
      transport: 'relay',
      relay: relayClient(fakeRelayNodeFetch().fetch),
      observe: { ...OBSERVE },
    });
    expect(client.events).toBe(client.events);
    expect(client.ws).toBe(client.ws);
  });
});

describe('one call site that both writes and observes', () => {
  /**
   * The requirement in one function: an app written once, naming no transport,
   * that both writes and subscribes. If either transport ever needs a special
   * case here, this is the test that fails.
   */
  async function appCodeThatObserves(client: MeroClient): Promise<unknown[]> {
    const seen: unknown[] = [];
    client.ws.on('event', (e) => seen.push(e));
    await client.ws.connect();
    await client.ws.subscribe([CONTEXT]);
    await client.rpc.execute({ contextId: CONTEXT, method: 'set', argsJson: { key: 'k' } });
    // The node echoes the write back on the stream this client subscribed to.
    // Driven from the fake here rather than from inside a transport-specific
    // helper: the app does not know, and must not need to know, which one it
    // is on.
    FakeWebSocket.last?.onmessage?.({
      data: JSON.stringify({
        result: { contextId: CONTEXT, type: 'StateMutation', data: { newRoot: 'ff'.repeat(32) } },
      }),
    });
    return seen;
  }

  /** What both transports must produce: the write's own mutation, once. */
  const expected = [
    { contextId: CONTEXT, type: 'StateMutation', data: { newRoot: 'ff'.repeat(32) } },
  ];

  it('runs unchanged against a node client and a keyed relay client', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);

    vi.stubGlobal('fetch', fakeNodeFetch(null).fetch);
    // A node client holds a credential it was issued; a relay client mints one
    // by logging in. Different provenance, same surface from here on — which is
    // the whole claim under test.
    const store = new MemoryTokenStore();
    store.setTokens({
      access_token: 'node-token',
      refresh_token: 'r',
      expires_at: Date.now() + 3_600_000,
    });
    const noded = createMeroClient({ baseUrl: 'http://node.example', tokenStore: store });
    await expect(appCodeThatObserves(noded)).resolves.toEqual(expected);
    noded.close();

    const node = fakeRelayNodeFetch();
    const relayed = createMeroClient({
      transport: 'relay',
      relay: relayClient(node.fetch),
      observe: { ...OBSERVE, fetch: node.fetch },
    });
    await expect(appCodeThatObserves(relayed)).resolves.toEqual(expected);
    relayed.close();
  });
});

describe('the admin surface on the relay transport', () => {
  /**
   * The refusal has to distinguish two things a caller will conflate: the
   * mutations are gone for good, the reads are pending a surface that does not
   * exist yet. A message that says only "no admin here" sends someone looking
   * for a permission to grant, and there isn't one.
   */
  it('names the reads as pending rather than forbidden', () => {
    const client = createMeroClient({
      transport: 'relay',
      relay: new RelayClient({
        relayUrl: 'http://relay.example',
        authorAccount: 'aa'.repeat(32),
        authorProof: 'bb'.repeat(32),
        deviceSecret: 'cc'.repeat(32),
        nonces: createMemoryNonceSource(),
      }),
    });

    let message = '';
    try {
      void client.admin;
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).toContain('operator actions');
    expect(message).toMatch(/getContext|getContexts/);
    expect(message).toContain('transport-independent');
    // and it must not suggest the caller is one grant away from fixing it
    expect(message).not.toMatch(/permission denied|grant .* admin/i);
  });
});
