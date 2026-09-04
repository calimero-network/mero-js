import { describe, it, expect, vi } from 'vitest';
import { createMemoryNonceSource, createLocalStorageNonceSource } from './nonce-source.js';

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
