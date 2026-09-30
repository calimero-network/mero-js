import { describe, it, expect, vi } from 'vitest';
import {
  createRecoveringNonceSource,
  createMemoryNonceSource,
  createLocalStorageNonceSource,
  WarrantNonceExhaustedError,
  type WarrantNonceLookup,
} from './nonce-source.js';
import type { WarrantNonceState } from '../admin-api/admin-types.js';

const CONTEXT = 'c'.repeat(64);
const DEVICE = 'a'.repeat(64);

/** A `localStorage` stand-in, so the tests run in any runtime. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    read: (k: string) => map.get(k) ?? null,
  };
}

/** A node that answers with `nextNonce`, or with an exhausted sequence. */
function nodeAt(nextNonce: bigint | 'exhausted'): WarrantNonceLookup & { calls: number } {
  const lookup = {
    calls: 0,
    getWarrantNonce(): Promise<WarrantNonceState> {
      lookup.calls += 1;
      const common = {
        contextId: CONTEXT,
        authorDeviceKey: DEVICE,
        seen: true,
        windowWidth: 64n,
      };
      return Promise.resolve(
        nextNonce === 'exhausted'
          ? { ...common, kind: 'exhausted' as const, seen: true as const, highWaterNonce: 2n ** 64n - 1n }
          : { ...common, kind: 'open' as const, nextNonce, highWaterNonce: nextNonce - 1n },
      );
    },
  };
  return lookup;
}

describe('createRecoveringNonceSource', () => {
  it('mints at the node position when local state is gone', async () => {
    // The case this exists for: storage cleared, local counter back at 1, node
    // remembers 41 warrants. Restarting at 1 would replay all 41 — every write
    // refused, looking to the user like the app silently not saving.
    const node = nodeAt(42n);
    const nonces = createRecoveringNonceSource({
      lookups: node,
      contextId: CONTEXT,
      authorDeviceKey: DEVICE,
      local: createMemoryNonceSource(1),
    });

    expect(await nonces.next()).toBe(42n);
    expect(await nonces.next()).toBe(43n);
  });

  it('keeps the client ahead when the client is ahead: max(ownNext, nextNonce)', async () => {
    // Nonce state folds per peer, so a node is only ever BEHIND a client whose
    // warrants it has not applied — never ahead of the truth. Taking the node's
    // answer unconditionally would hand back a number this client already spent.
    const nonces = createRecoveringNonceSource({
      lookups: nodeAt(5n),
      contextId: CONTEXT,
      authorDeviceKey: DEVICE,
      local: createMemoryNonceSource(100),
    });

    expect(await nonces.next()).toBe(100n);
    expect(await nonces.next()).toBe(101n);
  });

  it('starts a fresh sequence from the local counter, not from the node zero', async () => {
    // `seen: false` / `nextNonce: 0` is a real answer, and the max rule makes it
    // harmless: a client with its own counter at 1 stays at 1. Skipping costs
    // nothing; the window accepts gaps.
    const nonces = createRecoveringNonceSource({
      lookups: nodeAt(0n),
      contextId: CONTEXT,
      authorDeviceKey: DEVICE,
    });

    expect(await nonces.next()).toBe(1n);
  });

  it('takes the highest answer when an author writes through several relays', async () => {
    const behind = nodeAt(3n);
    const ahead = nodeAt(90n);
    const nonces = createRecoveringNonceSource({
      lookups: [behind, ahead],
      contextId: CONTEXT,
      authorDeviceKey: DEVICE,
    });

    expect(await nonces.next()).toBe(90n);
    expect(behind.calls).toBe(1);
    expect(ahead.calls).toBe(1);
  });

  it('asks once, however many nonces are drawn, and even under a concurrent first call', async () => {
    const node = nodeAt(10n);
    const nonces = createRecoveringNonceSource({
      lookups: node,
      contextId: CONTEXT,
      authorDeviceKey: DEVICE,
    });

    const [a, b] = await Promise.all([nonces.next(), nonces.next()]);
    await nonces.next();

    // Two racing first calls must not each spend a round trip, and must not be
    // handed the same number.
    expect(node.calls).toBe(1);
    expect(new Set([a, b]).size).toBe(2);
  });

  it('rejects rather than guessing when the sequence is exhausted', async () => {
    const nonces = createRecoveringNonceSource({
      lookups: nodeAt('exhausted'),
      contextId: CONTEXT,
      authorDeviceKey: DEVICE,
    });

    // There is no next nonce: `u64::MAX` is spent and every guess from here is
    // refused forever. The only cure is a new device key.
    await expect(nonces.next()).rejects.toBeInstanceOf(WarrantNonceExhaustedError);
  });

  it('refuses to mint when no node can be reached, by default', async () => {
    const dead: WarrantNonceLookup = {
      getWarrantNonce: vi.fn().mockRejectedValue(new Error('404 route not mounted')),
    };
    const nonces = createRecoveringNonceSource({
      lookups: dead,
      contextId: CONTEXT,
      authorDeviceKey: DEVICE,
      local: createMemoryNonceSource(1),
    });

    // Falling back silently is what replays: a cleared counter plus an
    // unreachable node is precisely the state where minting at 1 is wrong.
    await expect(nonces.next()).rejects.toThrow('404 route not mounted');
    // The failure is not cached — a node that was down a moment ago may answer.
    await expect(nonces.next()).rejects.toThrow('404 route not mounted');
    expect((dead.getWarrantNonce as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it('falls back to the local counter when told to', async () => {
    const dead: WarrantNonceLookup = {
      getWarrantNonce: vi.fn().mockRejectedValue(new Error('offline')),
    };
    const nonces = createRecoveringNonceSource({
      lookups: dead,
      contextId: CONTEXT,
      authorDeviceKey: DEVICE,
      local: createMemoryNonceSource(4),
      onLookupFailure: 'local',
    });

    expect(await nonces.next()).toBe(4n);
    expect(await nonces.next()).toBe(5n);
  });

  it('persists the jump into a localStorage counter, so the next cold start is above it', async () => {
    const storage = fakeStorage();
    const local = createLocalStorageNonceSource('nonce:ctx:dev', storage);
    const nonces = createRecoveringNonceSource({
      lookups: nodeAt(500n),
      contextId: CONTEXT,
      authorDeviceKey: DEVICE,
      local,
    });

    expect(await nonces.next()).toBe(500n);

    // The stored value is the last number handed out, so a fresh source over
    // the same storage continues at 501 even with no node to ask.
    expect(storage.read('nonce:ctx:dev')).toBe('500');
    expect(await createLocalStorageNonceSource('nonce:ctx:dev', storage).next()).toBe(501n);
  });

  it('never hands back a number below the floor even if the local source is far behind', async () => {
    // A local source with no `advanceTo` cannot be fast-forwarded, so the floor
    // is kept in the wrapper. It must still be strictly increasing.
    let n = 0n;
    const dumb = { next: () => Promise.resolve((n += 1n)) };
    const nonces = createRecoveringNonceSource({
      lookups: nodeAt(1000n),
      contextId: CONTEXT,
      authorDeviceKey: DEVICE,
      local: dumb,
    });

    const drawn = [await nonces.next(), await nonces.next(), await nonces.next()];

    expect(drawn).toEqual([1000n, 1001n, 1002n]);
  });

  it('refuses to be built with nothing to ask', () => {
    expect(() =>
      createRecoveringNonceSource({ lookups: [], contextId: CONTEXT, authorDeviceKey: DEVICE }),
    ).toThrow('at least one node');
  });
});
