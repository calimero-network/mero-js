/**
 * Ephemeral-presence E2E: the cross-repo contract test for `mero.ephemeral`
 * against a REAL merod (the released binary CI downloads).
 *
 * Core pins its own half with Rust serde tests and a two-node merobox e2e; what
 * has never been checked is whether THIS package speaks the protocol correctly
 * to a live node — that `set` is accepted with the params the node expects, and
 * that the SSE `Ephemeral` events it emits carry the exact field
 * presence/absence `subscribe` reads.
 *
 * Single-node tier: everything below is client-side contract, so one node with
 * one owned identity is enough. (TTL eviction needs a second node — see the
 * skipped test at the bottom.)
 *
 * NOT-SUPPORTED POLICY: if the node under test predates presence, this suite
 * FAILS LOUDLY in `beforeAll` rather than skipping. CI always points at the
 * newest core release, so an unsupported node means a rollback or a dropped
 * endpoint — exactly the regression this file exists to catch. A skip would
 * still leave CI green (the other e2e suites satisfy its "[1-9] passed" guard),
 * which is precisely the vacuous pass we must not produce.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MeroJs } from '../../src/mero-js.js';
import { resolveBaseUrl, resolveCreds, ensureApplication, runId } from './harness.js';

const NODE_URL = resolveBaseUrl();
const CREDS = resolveCreds();
const RUN = runId();

/** Raw shape of the node's `Ephemeral` event payload, before `subscribe` normalizes it. */
interface RawEphemeral {
  author?: string;
  state?: number[];
  removed?: boolean;
  ageMs?: number;
}
interface RawEvent {
  contextId?: string;
  type?: string;
  data?: RawEphemeral;
}

/** The presence slice this suite publishes; `nonce` makes each `set` identifiable. */
interface Slice {
  nonce: string;
  cursor: { line: number; col: number };
}

let mero: MeroJs;
let applicationId: string;
let namespaceId: string;
let contextId: string;
/** Every raw `Ephemeral` event for our context, recorded straight off the SSE stream. */
const rawEvents: RawEvent[] = [];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Poll `check` until it returns a value, or throw after `timeoutMs`. */
async function waitFor<T>(
  check: () => T | undefined,
  timeoutMs: number,
  what: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = check();
    if (found !== undefined) return found;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    await sleep(100);
  }
}

/** Resolve once the SSE stream is live (the node has sent its session id), so a
 * later `subscribe` is actually registered before we publish. */
async function awaitSseConnected(client: MeroJs, timeoutMs = 30000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SSE did not connect')), timeoutMs);
    client.events.on('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    void client.events.connect();
  });
}

beforeAll(async () => {
  mero = new MeroJs({ baseUrl: NODE_URL });
  await mero.authenticate(CREDS);
  applicationId = await ensureApplication(mero);
  const ns = await mero.admin.createNamespace({ applicationId, alias: `eph-${RUN}` });
  namespaceId = ns.namespaceId;
  const ctx = await mero.admin.createContext({ applicationId, groupId: namespaceId });
  contextId = ctx.contextId;

  // Support probe. A node without presence answers `set_ephemeral` with a
  // method-not-found style RPC error; turn that into an unmistakable failure
  // instead of letting every assertion below fail with a cryptic message.
  try {
    await mero.ephemeral.set<Slice>(contextId, { nonce: 'probe', cursor: { line: 0, col: 0 } });
  } catch (err) {
    throw new Error(
      'set_ephemeral was rejected by the node under test — this merod appears to ' +
        'predate ephemeral presence (needs core >= 0.11.0-rc.24). Failing loudly ' +
        `rather than skipping, so a rollback cannot pass silently. Underlying error: ${String(err)}`,
    );
  }

  // Record every raw Ephemeral frame for this context. `subscribe` normalizes
  // the payload, so the raw stream is the only place to assert what the node
  // actually put on the wire (fields absent vs. present-and-falsy).
  mero.events.on('event', (event: unknown) => {
    const e = event as RawEvent;
    if (e.type === 'Ephemeral' && e.contextId === contextId) rawEvents.push(e);
  });
  await awaitSseConnected(mero);
}, 120000);

afterAll(async () => {
  if (namespaceId) await mero?.admin.deleteNamespace(namespaceId).catch(() => {});
  mero?.close();
}, 60000);

describe('E2E — ephemeral presence (single node)', () => {
  it('set publishes without an author — the node resolves it server-side', async () => {
    const captured: Array<Record<string, unknown>> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : '';
      if (url.includes('/jsonrpc') && typeof init?.body === 'string') {
        const body = JSON.parse(init.body) as { method?: string; params?: Record<string, unknown> };
        if (body.method === 'set_ephemeral') captured.push(body.params ?? {});
      }
      return realFetch(input, init);
    };

    try {
      // No throw == the node accepted it (`set` surfaces any RPC error).
      await mero.ephemeral.set<Slice>(contextId, {
        nonce: 'author-check',
        cursor: { line: 1, col: 2 },
      });
    } finally {
      globalThis.fetch = realFetch;
    }

    expect(captured).toHaveLength(1);
    const params = captured[0];
    expect(params.contextId).toBe(contextId);
    expect(Array.isArray(params.state)).toBe(true);
    // The write is single-writer by construction: a client cannot assert an
    // author, so it must not send one.
    expect(Object.keys(params)).toEqual(['contextId', 'state']);
    expect(params).not.toHaveProperty('author');
  });

  it('subscribe delivers the live delta: state decoded, removed false, NO ageMs', async () => {
    const received: Array<{ author: string; state?: Slice; removed?: boolean; ageMs?: number }> = [];
    const unsubscribe = mero.ephemeral.subscribe<Slice>(contextId, (entry) => received.push(entry));
    // The subscription is registered on the live stream and any replay of prior
    // state has drained before we publish the delta we assert on.
    await sleep(2000);

    const nonce = `live-${RUN}`;
    const beforeRaw = rawEvents.length;
    await mero.ephemeral.set<Slice>(contextId, { nonce, cursor: { line: 42, col: 7 } });

    const entry = await waitFor(
      () => received.find((e) => e.state?.nonce === nonce),
      30000,
      'the live presence delta',
    );
    unsubscribe();

    // The default JSON codec round-trips the slice through the node's byte array.
    expect(entry.state).toEqual({ nonce, cursor: { line: 42, col: 7 } });
    expect(entry.author).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/); // bs58 identity key
    // `subscribe` hands callers a real boolean even though the wire omits the field.
    expect(entry.removed).toBe(false);
    // A live delta is fresh at receipt: `ageMs` must be genuinely ABSENT, not 0
    // — the two mean different things downstream.
    expect('ageMs' in entry).toBe(false);
    expect(entry.ageMs).toBeUndefined();

    // Same claims against the untouched wire frame: this is the node's half of
    // the contract, not our normalization.
    const raw = rawEvents
      .slice(beforeRaw)
      .find((e) => e.data?.state && JSON.stringify(e.data.state).length > 0 && !e.data.removed);
    expect(raw).toBeDefined();
    expect('removed' in (raw?.data ?? {})).toBe(false); // absent on upsert, not `false`
    expect('ageMs' in (raw?.data ?? {})).toBe(false); // absent on a live delta, not `0`
    expect(raw?.data?.author).toBe(entry.author);
  });

  it('replay-on-subscribe seeds a fresh subscriber, and the seed carries ageMs', async () => {
    const nonce = `replay-${RUN}`;
    await mero.ephemeral.set<Slice>(contextId, { nonce, cursor: { line: 3, col: 9 } });

    // A second client: a brand-new SSE connection, which is what triggers the
    // node's replay of the context's current presence. (There is deliberately
    // no `get` — subscribing IS the read path.)
    const observer = new MeroJs({ baseUrl: NODE_URL });
    try {
      await observer.authenticate(CREDS);
      const seen: Array<{ author: string; state?: Slice; ageMs?: number }> = [];
      const unsubscribe = observer.ephemeral.subscribe<Slice>(contextId, (e) => seen.push(e));

      const seed = await waitFor(
        () => seen.find((e) => e.ageMs !== undefined),
        30000,
        'the replayed seed entry',
      );
      unsubscribe();

      // The seed is real presence, not an empty marker, and its age is a
      // node-measured relative number bounded by the 7s TTL.
      expect(seed.state?.nonce).toBeTruthy();
      expect(typeof seed.ageMs).toBe('number');
      expect(seed.ageMs).toBeGreaterThanOrEqual(0);
      expect(seed.author).toBeTruthy();
    } finally {
      observer.close();
    }
  });

  it('the unsubscribe function detaches — no further handler calls', async () => {
    let calls = 0;
    const unsubscribe = mero.ephemeral.subscribe<Slice>(contextId, () => {
      calls += 1;
    });
    await mero.ephemeral.set<Slice>(contextId, { nonce: `unsub-${RUN}`, cursor: { line: 0, col: 0 } });
    await waitFor(() => (calls > 0 ? true : undefined), 30000, 'the first handler call');

    unsubscribe();
    const afterDetach = calls;

    // Keep the stream busy: further sets (plus the node's own heartbeat) would
    // reach a still-attached listener.
    await mero.ephemeral.set<Slice>(contextId, { nonce: `unsub2-${RUN}`, cursor: { line: 1, col: 1 } });
    await sleep(3000);
    await mero.ephemeral.set<Slice>(contextId, { nonce: `unsub3-${RUN}`, cursor: { line: 2, col: 2 } });
    await sleep(3000);

    expect(calls).toBe(afterDetach);
  });

  // TTL eviction (a `removed: true` event ~7s after an author goes quiet) is NOT
  // testable here: the node heartbeats its OWN local entry, so a local slice
  // never expires while the node runs. Observing expiry needs a second node whose
  // peer entry can go stale — core covers that in its two-node merobox e2e. Left
  // skipped rather than omitted so the gap is visible, and not faked with a stub.
  it.skip('evicts an author after the 7s TTL (needs 2 nodes — covered by core e2e)', () => {});
});
