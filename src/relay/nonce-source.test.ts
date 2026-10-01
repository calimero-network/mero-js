import { describe, it, expect, vi } from 'vitest';
import {
  createMemoryNonceSource,
  createLocalStorageNonceSource,
  createRecoveringNonceSource,
  authorNonceLookup,
} from './nonce-source.js';

/** A `localStorage` stand-in, so the tests run in any runtime. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    read: (k: string) => map.get(k) ?? null,
  };
}

describe('createMemoryNonceSource', () => {
  it('hands out a strictly increasing sequence from the start value', async () => {
    const nonces = createMemoryNonceSource(7);
    expect(await nonces.next()).toBe(7n);
    expect(await nonces.next()).toBe(8n);
    expect(await nonces.next()).toBe(9n);
  });

  it('starts at 1 by default', async () => {
    expect(await createMemoryNonceSource().next()).toBe(1n);
  });

  /**
   * Nonce 0 is not a valid warrant nonce, and a source that silently produced
   * one would fail at the relay with a signature-shaped error nowhere near the
   * cause.
   */
  it('refuses a start below 1', () => {
    expect(() => createMemoryNonceSource(0)).toThrow(/starts at 1/);
  });
});

describe('createLocalStorageNonceSource', () => {
  it('continues the persisted sequence rather than restarting it', async () => {
    const storage = fakeStorage();
    const key = 'mero-js:warrant-nonce:abc';

    const first = createLocalStorageNonceSource(key, storage);
    expect(await first.next()).toBe(1n);
    expect(await first.next()).toBe(2n);

    // A new source over the same storage is what a page reload looks like. The
    // whole point of persisting is that this does NOT go back to 1 — that would
    // re-present nonces the network has already spent, and every such write is
    // refused as a replay.
    const afterReload = createLocalStorageNonceSource(key, storage);
    expect(await afterReload.next()).toBe(3n);
  });

  /**
   * Reserve-then-hand-out: the stored value must already be advanced by the
   * time the caller has the nonce, so a crash in between loses a number instead
   * of reusing one. Skipping is free (the receiving ledger is a 64-wide sliding
   * window); reusing is a refused write.
   */
  it('persists the nonce before returning it', async () => {
    const storage = fakeStorage();
    const nonces = createLocalStorageNonceSource('k', storage);
    const value = await nonces.next();
    expect(storage.read('k')).toBe(value.toString());
  });

  it('treats a corrupted or empty stored value as no sequence recorded', async () => {
    for (const corrupt of ['', 'not-a-number', '-4', '0']) {
      const storage = fakeStorage({ k: corrupt });
      expect(await createLocalStorageNonceSource('k', storage).next()).toBe(1n);
    }
  });

  it('keys are independent, so two devices do not share a sequence', async () => {
    const storage = fakeStorage();
    const deviceA = createLocalStorageNonceSource('device-a', storage);
    const deviceB = createLocalStorageNonceSource('device-b', storage);
    expect(await deviceA.next()).toBe(1n);
    expect(await deviceA.next()).toBe(2n);
    expect(await deviceB.next()).toBe(1n);
  });

  it('refuses to guess when the runtime has no storage', () => {
    vi.stubGlobal('localStorage', undefined);
    try {
      expect(() => createLocalStorageNonceSource('k')).toThrow(/no localStorage/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('authorNonceLookup', () => {
  /**
   * The adapter exists because the delegated route determines the device key
   * from the credential rather than taking it as an argument. A test that only
   * checked the happy path would not notice if someone "fixed" the ignored
   * parameter by passing it through, so this asserts the credential is what
   * travels.
   */
  it('asks with the credential, not with the device key handed to it', async () => {
    const asked: Array<[string, string]> = [];
    const lookup = authorNonceLookup({
      client: {
        getWarrantNonceAsAuthor: async (contextId, authorProof) => {
          asked.push([contextId, authorProof]);
          return {
            kind: 'open', seen: true, contextId, authorDeviceKey: 'dd'.repeat(32),
            highWaterNonce: 4n, nextNonce: 5n, windowWidth: 64n,
          } as never;
        },
      },
      authorProof: 'ab'.repeat(100),
    });

    const state = await lookup.getWarrantNonce('cc'.repeat(32), 'ee'.repeat(32));

    expect(asked).toEqual([['cc'.repeat(32), 'ab'.repeat(100)]]);
    expect(state.kind).toBe('open');
  });

  it('plugs into createRecoveringNonceSource as a lookup', async () => {
    const lookup = authorNonceLookup({
      client: {
        getWarrantNonceAsAuthor: async (contextId) => ({
          kind: 'open', seen: true, contextId, authorDeviceKey: 'dd'.repeat(32),
          highWaterNonce: 6n, nextNonce: 7n, windowWidth: 64n,
        }) as never,
      },
      authorProof: 'ab'.repeat(100),
    });
    let local = 0n;
    const source = createRecoveringNonceSource({
      lookups: [lookup], contextId: 'cc'.repeat(32), authorDeviceKey: 'ee'.repeat(32),
      local: { next: async () => local++ },
    });
    // The node is ahead of a counter that restarted, so the node wins.
    expect(await source.next()).toBe(7n);
  });
});
