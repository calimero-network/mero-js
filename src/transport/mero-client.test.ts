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

describe('what a relay-transport client cannot do', () => {
  const client = (): MeroClient =>
    createMeroClient({ transport: 'relay', relay: relayClient(fakeRelayFetch(null).fetch) });

  it('reports that it cannot subscribe, before anything is attempted', () => {
    expect(client().canSubscribe).toBe(false);
  });

  it.each(['events', 'ws', 'ephemeral', 'admin', 'auth', 'node', 'cloud'] as const)(
    'throws from `%s` rather than falling back to some other node',
    (surface) => {
      expect(() => client()[surface]).toThrow(/relay transport/);
    },
  );

  it('explains the event gap in terms of what the relay actually serves', () => {
    expect(() => client().events).toThrow(/no \/sse, no \/ws/);
  });

  it('closes without error, so teardown need not know the transport', () => {
    expect(() => client().close()).not.toThrow();
  });

  it('refuses `relay` on a node client', () => {
    expect(() => createMeroClient({ baseUrl: 'http://node.example' }).relay).toThrow(
      /node transport/,
    );
  });
});
