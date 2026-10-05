// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NODE_KEY = 'ab'.repeat(32);
const RELAY = 'https://node-x.relay.cloud.calimero.network';
const MIRROR = 'https://cloud.calimero.network/api/tee/node-releases/2.3.109';
const SIGNED_RELEASE = { data: { version: '2.3.109', publishedMrtds: '{}', bundle: '{}' } };

const dcapVerify = vi.fn(() => ({ status: 'UpToDate' }));
/** Whether the quote matches the signed release it was checked against. */
let quoteMatchesRelease = true;

// What the verifier is handed is what the quote check calls. A non-function
// here is the hosted-relay failure: the quote never verifies, no key is
// pinned, no session is minted, and every admin read is a 401.
//
// The verifier fetches the signed release first (the `release` it was given,
// through the real mero-js fetchers) and only then checks the quote against
// it, which is the order the real one keeps: transport, then verification.
vi.mock('../sealed/index.js', async (importActual) => ({
  ...(await importActual<typeof import('../sealed/index.js')>()),
  createSignedReleaseVerifier:
    (opts: { dcapVerify: unknown; release: () => Promise<unknown> }) =>
    async (): Promise<boolean> => {
      await opts.release();
      if (typeof opts.dcapVerify !== 'function') throw new TypeError('dcapVerify is not a function');
      (opts.dcapVerify as () => unknown)();
      if (!quoteMatchesRelease) throw new Error('RTMR3 does not match the signed release');
      return true;
    },
}));
vi.mock('../relay-attestation/index.js', async (importActual) => ({
  ...(await importActual<typeof import('../relay-attestation/index.js')>()),
  attestRelayNodeKey: async ({
    relayUrl,
    verify,
    fetch: givenFetch,
  }: {
    relayUrl: string;
    verify?: (a: unknown) => Promise<boolean>;
    fetch?: typeof fetch;
  }) => {
    const response = await (givenFetch ?? fetch)(`${relayUrl}/admin-api/tee/attest`, { method: 'POST' });
    if (!response.ok) throw new Error(`the relay would not attest (HTTP ${response.status})`);
    if (verify && !(await verify({}))) throw new Error("the relay's quote did not verify");
    return { nodeKey: NODE_KEY };
  },
}));

// `@phala/dcap-qvl` is CommonJS (`module.exports = { verify, … }`). A bundler
// that pre-bundles it for the browser — Vite's dev optimizer, for one — hands a
// dynamic import back as a namespace whose only export is `default`, so the
// named `verify` is not there. This is that shape.
vi.mock('@phala/dcap-qvl', () => ({ default: { verify: dcapVerify }, verify: undefined }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** What the cloud mirror does on each request, in order; the last one repeats. */
let mirror: Array<'down' | 504 | 'up'> = ['up'];
let mirrorHits = 0;
/** What the relay's attest endpoint does on each request; the last one repeats. */
let attest: Array<'down' | 'up'> = ['up'];
let attestHits = 0;

function stubNetwork() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${RELAY}/admin-api/tee/info`) {
        return json({ data: { osImage: 'merotee-ubuntu-questing-25-10-locked-read-only-2-3-109' } });
      }
      if (url === `${RELAY}/admin-api/tee/attest`) {
        const step = attest[Math.min(attestHits++, attest.length - 1)];
        if (step === 'down') throw new TypeError('Failed to fetch');
        return json({ data: {} });
      }
      if (url === MIRROR) {
        const step = mirror[Math.min(mirrorHits++, mirror.length - 1)];
        // A 504 from an ingress that adds no CORS header reaches a browser as
        // exactly this: a TypeError, no status.
        if (step === 'down') throw new TypeError('Failed to fetch');
        if (step === 504) return new Response('upstream timeout', { status: 504 });
        return json(SIGNED_RELEASE);
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
}

describe('resolveRelayNodeKey on a hosted relay', () => {
  beforeEach(() => {
    localStorage.clear();
    dcapVerify.mockClear();
    quoteMatchesRelease = true;
    mirror = ['up'];
    mirrorHits = 0;
    attest = ['up'];
    attestHits = 0;
    stubNetwork();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('verifies the quote when the verifier library arrives as a CommonJS default export', async () => {
    const { resolveRelayNodeKey, readPinnedRelayNodeKey } = await import('./session.js');

    await expect(resolveRelayNodeKey(RELAY)).resolves.toBe(NODE_KEY);
    expect(dcapVerify).toHaveBeenCalledTimes(1);
    expect(readPinnedRelayNodeKey(RELAY)).toBe(NODE_KEY);
  });

  it('calls a release mirror that cannot be reached unavailable, not refused, and pins nothing', async () => {
    mirror = ['down'];
    const { attemptRelayNodeKey, readPinnedRelayNodeKey } = await import('./session.js');

    await expect(attemptRelayNodeKey(RELAY)).resolves.toMatchObject({ kind: 'unavailable' });
    expect(readPinnedRelayNodeKey(RELAY)).toBeNull();
  });

  it('calls a release mirror answering 504 unavailable', async () => {
    mirror = [504];
    const { attemptRelayNodeKey } = await import('./session.js');

    await expect(attemptRelayNodeKey(RELAY)).resolves.toMatchObject({ kind: 'unavailable' });
  });

  it('calls a relay that cannot be reached for its quote unavailable', async () => {
    attest = ['down'];
    const { attemptRelayNodeKey } = await import('./session.js');

    await expect(attemptRelayNodeKey(RELAY)).resolves.toMatchObject({ kind: 'unavailable' });
  });

  it('refuses a quote that does not match the signed release, and pins nothing', async () => {
    quoteMatchesRelease = false;
    const { attemptRelayNodeKey, readPinnedRelayNodeKey } = await import('./session.js');

    await expect(attemptRelayNodeKey(RELAY)).resolves.toMatchObject({ kind: 'refused' });
    expect(readPinnedRelayNodeKey(RELAY)).toBeNull();
  });

  it('learns the key once the release mirror answers again, after backing off', async () => {
    vi.useFakeTimers();
    mirror = ['down', 504, 'up'];
    const { learnRelayNodeKey, readPinnedRelayNodeKey } = await import('./session.js');

    const learned = learnRelayNodeKey(RELAY);
    // First attempt fails at once; the second waits 1 s, the third 2 s more.
    await vi.advanceTimersByTimeAsync(999);
    expect(mirrorHits).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mirrorHits).toBe(2);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(learned).resolves.toBe(NODE_KEY);
    expect(mirrorHits).toBe(3);
    expect(readPinnedRelayNodeKey(RELAY)).toBe(NODE_KEY);
  });

  it('keeps retrying an unreachable mirror, settling at one attempt every 30 s', async () => {
    vi.useFakeTimers();
    mirror = ['down'];
    const { learnRelayNodeKey } = await import('./session.js');
    const stop = new AbortController();

    const learned = learnRelayNodeKey(RELAY, { signal: stop.signal });
    // 1 + 2 + 5 + 10 s of backoff: five attempts.
    await vi.advanceTimersByTimeAsync(18_000);
    expect(mirrorHits).toBe(5);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(mirrorHits).toBe(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(mirrorHits).toBe(6);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mirrorHits).toBe(7);

    stop.abort();
    await expect(learned).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mirrorHits).toBe(7);
  });

  it('never retries a refused quote into acceptance: one attempt, then no key', async () => {
    vi.useFakeTimers();
    quoteMatchesRelease = false;
    const { learnRelayNodeKey, readPinnedRelayNodeKey } = await import('./session.js');

    const learned = learnRelayNodeKey(RELAY);
    await expect(learned).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(300_000);

    expect(attestHits).toBe(1);
    expect(dcapVerify).toHaveBeenCalledTimes(1);
    expect(readPinnedRelayNodeKey(RELAY)).toBeNull();
  });
});
