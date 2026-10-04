import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RelayPresenceClient } from './relay-presence.js';

type Sent = { contextId: string; body: { state: string | null; seq: number; sentAtMs: number } };

function stubRelay(statuses: number[] = []) {
  const calls: Sent[] = [];
  const relay = {
    authorProof: 'aa',
    authorSigner: async () => ({ publicKey: '22'.repeat(32), sign: async () => new Uint8Array(64) }),
    presenceIntent: vi.fn(async (contextId: string, body: Sent['body']) => {
      calls.push({ contextId, body });
      const status = statuses.shift();
      if (status !== undefined) throw Object.assign(new Error(`HTTP ${status}`), { status });
    }),
  };
  return { relay, calls };
}

const noEvents = () => {
  throw new Error('no event stream in this test');
};
const CTX = '11'.repeat(32);

/**
 * Run the fake clock forward, then let any send it started finish: each send
 * hashes with real WebCrypto, which fake timers do not drive, so asserting
 * "no more sends" straight after advancing could pass for the wrong reason.
 */
async function settleAfter(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  vi.useRealTimers();
  await new Promise((resolve) => setTimeout(resolve, 50));
  vi.useFakeTimers();
}

describe('RelayPresenceClient', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resends every 2.5 s with a rising seq, and one retract stops it', async () => {
    const { relay, calls } = stubRelay();
    const p = new RelayPresenceClient({ relay, events: noEvents, now: () => 1_000 });
    await p.set(CTX, { typing: true });
    // One heartbeat at a time, each waited for before the next fires. Each
    // resend hashes with real WebCrypto, which fake timers do not drive, so
    // jumping 5 s at once starts two resends together: they take their seqs
    // in order, but the hashing can finish in either order, recording them
    // as 1000, 1002, 1001. That is a harmless race (the relay drops the older
    // seq, and real heartbeats are 2.5 s apart), not what this test checks.
    for (const sent of [2, 3]) {
      await vi.advanceTimersByTimeAsync(2_500);
      await vi.waitFor(() => expect(calls.length).toBe(sent));
    }
    expect(calls[1]!.body.seq).toBeGreaterThan(calls[0]!.body.seq);
    expect(calls[2]!.body.seq).toBeGreaterThan(calls[1]!.body.seq);
    await p.set(CTX, null);
    const after = calls.length;
    expect(calls[after - 1]!.body.state).toBeNull();
    await settleAfter(10_000);
    expect(calls.length).toBe(after);
  });

  it('sends the encoded state as hex', async () => {
    const { relay, calls } = stubRelay();
    const p = new RelayPresenceClient({ relay, events: noEvents, now: () => 1_000 });
    await p.set(CTX, { typing: true });
    expect(calls[0]!.body.state).toBe(
      Array.from(new TextEncoder().encode('{"typing":true}'), (b) => b.toString(16).padStart(2, '0')).join(''),
    );
    p.close();
  });

  it('seeds seq from the wall clock, so a relay restart does not refuse it', async () => {
    const { relay, calls } = stubRelay();
    const p = new RelayPresenceClient({ relay, events: noEvents, now: () => 1_700_000_000_000 });
    await p.set(CTX, { typing: false });
    expect(calls[0]!.body.seq).toBeGreaterThanOrEqual(1_700_000_000_000);
    p.close();
  });

  it('does not retry a 429 at once, and stops resending after a 403', async () => {
    const { relay, calls } = stubRelay([429, 403]);
    const p = new RelayPresenceClient({ relay, events: noEvents, now: () => 1_000 });
    await p.set(CTX, { typing: true }); // 429: swallowed, the resend covers it
    expect(calls.length).toBe(1);
    await vi.advanceTimersByTimeAsync(2_500); // the resend gets 403
    await vi.waitFor(() => expect(calls.length).toBe(2));
    await settleAfter(10_000);
    expect(calls.length).toBe(2);
  });

  it('throws a 403 from set, and sends nothing more', async () => {
    const { relay, calls } = stubRelay([403]);
    const p = new RelayPresenceClient({ relay, events: noEvents, now: () => 1_000 });
    await expect(p.set(CTX, { typing: true })).rejects.toMatchObject({ status: 403 });
    await settleAfter(10_000);
    expect(calls.length).toBe(1);
  });

  it('stops every resend on close()', async () => {
    const { relay, calls } = stubRelay();
    const p = new RelayPresenceClient({ relay, events: noEvents, now: () => 1_000 });
    await p.set(CTX, { typing: true });
    p.close();
    await settleAfter(10_000);
    expect(calls.length).toBe(1);
  });

  it('opens the event stream only when subscribed to', () => {
    const { relay } = stubRelay();
    const events = vi.fn(noEvents);
    const p = new RelayPresenceClient({ relay, events, now: () => 1_000 });
    expect(events).not.toHaveBeenCalled();
    expect(() => p.subscribe(CTX, () => {})).toThrow(/no event stream/);
  });

  it('a retract made while an earlier set is in flight is not undone by it', async () => {
    const { relay, calls } = stubRelay();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    // The first POST hangs until released; later ones answer at once.
    relay.presenceIntent.mockImplementationOnce(async (contextId: string, body: Sent['body']) => {
      calls.push({ contextId, body });
      await held;
    });
    const p = new RelayPresenceClient({ relay, events: noEvents, now: () => 1_000 });
    const typing = p.set(CTX, { typing: true });
    await vi.waitFor(() => expect(calls.length).toBe(1));
    await p.set(CTX, null);
    release();
    await typing;
    await settleAfter(10_000);
    expect(calls.map((c) => c.body.state === null)).toEqual([false, true]);
  });

  it('two overlapping sets leave one heartbeat, which close() stops', async () => {
    const { relay, calls } = stubRelay();
    const p = new RelayPresenceClient({ relay, events: noEvents, now: () => 1_000 });
    await Promise.all([p.set(CTX, { typing: true }), p.set(CTX, { typing: false })]);
    p.close();
    const sent = calls.length;
    await settleAfter(10_000);
    expect(calls.length).toBe(sent);
  });

  it('keeps resending after a transient failure of the first send', async () => {
    for (const status of [503, 0]) {
      const { relay, calls } = stubRelay([status]);
      const p = new RelayPresenceClient({ relay, events: noEvents, now: () => 1_000 });
      await p.set(CTX, { typing: true }); // not thrown: the resend covers it
      await vi.advanceTimersByTimeAsync(2_500);
      await vi.waitFor(() => expect(calls.length).toBe(2));
      p.close();
    }
  });

  it('stops resending on a 400, which resending cannot fix', async () => {
    const { relay, calls } = stubRelay([undefined as unknown as number, 400]);
    const p = new RelayPresenceClient({ relay, events: noEvents, now: () => 1_000 });
    await p.set(CTX, { typing: true });
    await vi.advanceTimersByTimeAsync(2_500);
    await vi.waitFor(() => expect(calls.length).toBe(2));
    await settleAfter(10_000);
    expect(calls.length).toBe(2);
  });
});
