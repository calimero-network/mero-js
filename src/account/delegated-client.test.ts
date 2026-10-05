// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fake, createMeroClient } = vi.hoisted(() => {
  const fake = {
    config: null as unknown,
    execute: vi.fn(async () => 'warranted'),
    executeWithMetadata: vi.fn(async () => ({ returns: 'warranted', transport: 'relay', rootHash: 'ff' })),
    queryContext: vi.fn(async () => ({ returns: 'queried' })),
    events: { connect: vi.fn(async () => {}), close: vi.fn() },
    close: vi.fn(),
  };
  const createMeroClient = vi.fn((config: unknown) => {
    fake.config = config;
    return {
      transport: 'relay',
      rpc: {
        kind: 'relay',
        canSubscribe: Boolean((config as { observe?: { nodeKey?: string } }).observe?.nodeKey),
        execute: fake.execute,
        executeWithMetadata: fake.executeWithMetadata,
        migrateMyEntries: vi.fn(),
        countMyPending: vi.fn(),
      },
      admin: { queryContext: fake.queryContext },
      get canSubscribe() { return true; },
      get events() { return fake.events; },
      close: fake.close,
    };
  });
  return { fake, createMeroClient };
});

vi.mock('../transport/index.js', async (importActual) => ({
  ...(await importActual<typeof import('../transport/index.js')>()),
  createMeroClient,
}));

import { buildDelegatedClient, forgetMethodKinds, pinRelayNodeKey } from './session.js';

const RELAY = 'https://node-x.relay.cloud.calimero.network';
const S = { account: 'aa'.repeat(32), credential: 'cc', deviceSecret: '11'.repeat(32), relayUrl: RELAY };
const CTX = '03'.repeat(32);
const http = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

beforeEach(() => {
  localStorage.clear();
  forgetMethodKinds();
  vi.clearAllMocks();
  fake.queryContext.mockResolvedValue({ returns: 'queried' });
});
afterEach(() => vi.unstubAllGlobals());

describe('buildDelegatedClient: reads of an account go through the query route', () => {
  it('a method the node answers as a view is read with the session, and no warrant is spent', async () => {
    pinRelayNodeKey(RELAY, 'ab'.repeat(32));
    const client = buildDelegatedClient(S, null)!;
    await expect(client.rpc.execute({ contextId: CTX, method: 'get', argsJson: { key: 'k' } })).resolves.toBe('queried');
    expect(fake.queryContext).toHaveBeenCalledWith(CTX, { method: 'get', argsJson: { key: 'k' } });
    expect(fake.execute).not.toHaveBeenCalled();
    expect(fake.executeWithMetadata).not.toHaveBeenCalled();
  });

  it('a method the node refuses as a write (409) goes out as a warrant, and is not asked about again', async () => {
    pinRelayNodeKey(RELAY, 'ab'.repeat(32));
    fake.queryContext.mockRejectedValueOnce(http(409));
    const client = buildDelegatedClient(S, null)!;
    await expect(client.rpc.execute({ contextId: CTX, method: 'set', argsJson: { key: 'k', value: 'v' } })).resolves.toBe('warranted');
    await expect(client.rpc.execute({ contextId: CTX, method: 'set', argsJson: { key: 'k', value: 'w' } })).resolves.toBe('warranted');
    expect(fake.queryContext).toHaveBeenCalledTimes(1);
    expect(fake.executeWithMetadata).toHaveBeenCalledTimes(2);
  });

  it('what was learned about a method is kept across rebuilds of the client for the same relay', async () => {
    pinRelayNodeKey(RELAY, 'ab'.repeat(32));
    fake.queryContext.mockRejectedValueOnce(http(409));
    await buildDelegatedClient(S, null)!.rpc.execute({ contextId: CTX, method: 'set' });
    await buildDelegatedClient(S, CTX)!.rpc.execute({ contextId: CTX, method: 'set' });
    expect(fake.queryContext).toHaveBeenCalledTimes(1);
  });

  it('any other failure of the query falls back to the warrant, which answers reads too', async () => {
    pinRelayNodeKey(RELAY, 'ab'.repeat(32));
    fake.queryContext.mockRejectedValueOnce(http(503));
    const client = buildDelegatedClient(S, null)!;
    await expect(client.rpc.execute({ contextId: CTX, method: 'get' })).resolves.toBe('warranted');
    // Nothing was learned: the next call asks again.
    await expect(client.rpc.execute({ contextId: CTX, method: 'get' })).resolves.toBe('queried');
    expect(fake.queryContext).toHaveBeenCalledTimes(2);
  });

  it('sends the node the empty arguments a warrant would, for a call with none', async () => {
    pinRelayNodeKey(RELAY, 'ab'.repeat(32));
    await buildDelegatedClient(S, null)!.rpc.execute({ contextId: CTX, method: 'list' });
    expect(fake.queryContext).toHaveBeenCalledWith(CTX, { method: 'list', argsJson: {} });
  });

  it('executeWithMetadata reports a read as the relay transport with no root hash: nothing was written', async () => {
    pinRelayNodeKey(RELAY, 'ab'.repeat(32));
    const client = buildDelegatedClient(S, null)!;
    await expect(client.rpc.executeWithMetadata({ contextId: CTX, method: 'get' })).resolves.toEqual({ returns: 'queried', transport: 'relay' });
    fake.queryContext.mockRejectedValueOnce(http(409));
    await expect(client.rpc.executeWithMetadata({ contextId: CTX, method: 'set' })).resolves.toMatchObject({ rootHash: 'ff' });
  });

  it('with no session on the relay (its node key unknown) every call stays a warrant, as before', async () => {
    const client = buildDelegatedClient(S, null)!;
    await expect(client.rpc.execute({ contextId: CTX, method: 'get' })).resolves.toBe('warranted');
    expect(fake.queryContext).not.toHaveBeenCalled();
  });
});

describe('buildDelegatedClient: no events on a hosted relay before its key is attested', () => {
  it('advertises no subscription and its stream opens nothing, so nothing loops on a 401', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const client = buildDelegatedClient(S, null)!;
    expect(client.canSubscribe).toBe(false);
    const events = client.events;
    expect(events).not.toBe(fake.events);
    // What the hooks do with a stream: connect, subscribe, and later close. The
    // connect never settles rather than failing, so no caller sees an error to
    // retry on; the close resolves whatever waits.
    let settled = false;
    void events.connect().finally(() => { settled = true; });
    await events.subscribe({ contextIds: [CTX] });
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    client.close();
    expect(fake.close).toHaveBeenCalled();
    expect(client.events).toBe(events);
  });

  it('with the key attested, the events are the client\'s own session-backed stream', () => {
    pinRelayNodeKey(RELAY, 'ab'.repeat(32));
    const client = buildDelegatedClient(S, null)!;
    expect(client.canSubscribe).toBe(true);
    expect(client.events).toBe(fake.events);
    expect((fake.config as { observe?: { nodeKey?: string } }).observe?.nodeKey).toBe('ab'.repeat(32));
  });

  it('a loopback relay is a dev rig whose proof the node accepts: events as given', () => {
    const client = buildDelegatedClient({ ...S, relayUrl: 'http://localhost:2428' }, null)!;
    expect(client.canSubscribe).toBe(true);
    expect(client.events).toBe(fake.events);
  });
});
