/**
 * The delegated half of connecting: an account, a certified device, and a relay
 * that writes on their behalf.
 *
 * Kept deliberately apart from the node-login path in `MeroContext`. That path
 * is a redirect flow with token adoption, single-use refresh tokens and node-URL
 * trust validation — none of which applies here, because there is no session
 * token at all. A delegated client authenticates every request from a warrant it
 * signs itself. Weaving the two together would put a token-rotation decision in
 * front of a flow that has no tokens.
 *
 * Per-tab on purpose. The record lives in `sessionStorage`, so two tabs can hold
 * two different connections — one a node you run, one a relay you do not — with
 * the same application code in both.
 */
import {
  attestRelayNodeKey,
} from '../relay-attestation/index.js';
import {
  cloudNodeReleaseUrl,
  createAttestedSealedFetch,
  createSignedReleaseVerifier,
  DEFAULT_RELEASE_MIRROR,
  fetchNodeRelease,
  fetchNodeReleaseVersion,
  type DcapVerify,
  type VerifyTransportQuote,
} from '../sealed/index.js';
import {
  createMeroClient,
  defaultAudience,
  type ExecuteResult,
  type ExecuteTransport,
  type MeroClient,
} from '../transport/index.js';
import {
  login,
} from '../login/index.js';
import {
  SseClient,
} from '../events/index.js';
import {
  type ExecuteParams,
} from '../rpc/index.js';

/** Where the per-tab record lives. */
const KEY = 'calimero.delegated.connection';
/**
 * Where the enrolled credential lives when there is no relay for it yet.
 *
 * Separate from {@link KEY}, and deliberately not "a connection with a null
 * relay": a record under that key means a usable client can be built from it,
 * and every reader relies on that. An account that has just enrolled is a
 * member of nothing, so the cloud names no relay for it and there is nothing to
 * build — but the certificate is real and must survive, or the only way to
 * bootstrap from an invitation would be to enrol again.
 */
const CREDENTIAL_KEY = 'calimero.delegated.credential';

/**
 * What a delegated connection needs to be rebuilt after a reload.
 *
 * `deviceSecret` is here because the device key is what signs warrants, and a
 * reload that could not sign would be a dead session. It is a per-tab secret for
 * a certificate the account can revoke — not the account root, which never
 * leaves the wallet's origin.
 */
/**
 * What the wallet certified: an account, a device it trusts, and the key that
 * device signs with. Everything except somewhere to send the result.
 *
 * Split out of {@link DelegatedSession} because it is reachable one step
 * earlier. An account that has just enrolled holds exactly this and no relay —
 * it is a member of nothing, so the cloud has no relay to name — and this is the
 * input that resolves one from an invitation instead.
 */
export interface DelegatedCredential {
  /** The author's account id, hex. */
  account: string;
  /** The author's `AccountProof<DeviceCert>`, hex borsh. */
  credential: string;
  /** The certified device's ed25519 signing secret, hex. */
  deviceSecret: string;
}

export interface DelegatedSession extends DelegatedCredential {
  /**
   * The relay to write through — a node origin, or `null` for none yet.
   *
   * **`null` is a logged-in state, not a broken one.** A brand-new account is a
   * member of nothing, so the cloud names no relay for it — and that is the
   * normal condition of an account that has just been created, because being
   * signed in is how you come to be invited in the first place. Refusing to
   * connect without a relay locked a new account out of the only path that
   * would earn it one.
   *
   * What it does NOT mean is that writes quietly do nothing. There is no
   * client at all without a URL ({@link buildDelegatedClient} returns `null`),
   * so `mero` stays `null`, the session is authenticated, and anything reaching
   * for `rpc.execute` is told the relay is missing. A placeholder URL would be
   * the one unacceptable answer: it would look connected and refuse every
   * warrant.
   */
  relayUrl: string | null;
  /**
   * The relay's executor account, hex, when the app knows it — the cloud's
   * machine page names it beside the relay's address.
   *
   * Founding a namespace through a relay names the relay's account (and its
   * node key) in the warrant, and a namespace that does not exist yet cannot be
   * asked for them.
   * Without this the account learns it from a namespace it is already in, so a
   * brand-new account would have to join one first; with it, the account founds
   * on `relayUrl` directly.
   */
  executorAccount?: string | null;
  /**
   * No `contextId`, deliberately.
   *
   * Which context to talk to is a CHOICE, made after connecting and changeable
   * without reconnecting — a node routinely holds several and comparing two of
   * them is ordinary use. It lives where the node-login path already keeps it
   * (`setContextId` / `getContextId`), and `admin.getContexts()` on this very
   * client answers what the choices are, caller-scoped by the request proof. A
   * copy here would be a second source of truth that a context switch would
   * immediately make stale, and it would make connecting depend on a value
   * nobody could type.
   */
}

export function readDelegatedSession(): DelegatedSession | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DelegatedSession) : null;
  } catch {
    // Private mode, blocked site data, or a half-written record. Treat all
    // three as "not connected" rather than throwing during render.
    return null;
  }
}

export function saveDelegatedSession(s: DelegatedSession): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Non-fatal: the client still works for this page view, it just will not
    // survive a reload. Better than refusing to connect.
  }
}

export function clearDelegatedSession(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear if storage is unavailable */
  }
}

/**
 * The enrolled credential, whether or not a relay was ever found for it.
 *
 * A connected session is authoritative: it carries the same three fields and a
 * relay, so it is read first and the standalone record is the fallback. Without
 * that order a stale record from an earlier enrolment could out-rank the account
 * actually connected.
 */
export function readDelegatedCredential(): DelegatedCredential | null {
  const session = readDelegatedSession();
  if (session) {
    const { account, credential, deviceSecret } = session;
    return { account, credential, deviceSecret };
  }
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CREDENTIAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DelegatedCredential>;
    // A half-written record is worse than none: it would be carried into a
    // signing call and fail as a malformed credential, somewhere that cannot say
    // where the bad value came from.
    if (!parsed.account || !parsed.credential || !parsed.deviceSecret) return null;
    return parsed as DelegatedCredential;
  } catch {
    return null;
  }
}

export function saveDelegatedCredential(c: DelegatedCredential): void {
  try {
    sessionStorage.setItem(CREDENTIAL_KEY, JSON.stringify(c));
  } catch {
    /* this page view still holds it; it just will not survive a reload */
  }
}

export function clearDelegatedCredential(): void {
  try {
    sessionStorage.removeItem(CREDENTIAL_KEY);
  } catch {
    /* nothing to clear if storage is unavailable */
  }
}

/**
 * A warrant nonce is spent on the node, so the counter must outlive the page.
 *
 * In `localStorage`, not session: a reload that restarted from zero would
 * replay a spent nonce and be refused. Keyed by relay and context because the
 * ledger the node keeps is per `(context, author device)`.
 *
 * This is the client-side half of core #4018. The node can answer "where does
 * my sequence stand" — `POST /contexts/{id}/warrant-nonce` with the caller's own
 * `authorProof` — but that route is mounted on the protected router, so a
 * delegated client on a relay cannot reach it. Until it moves, holding the
 * counter locally is the only option, and losing storage means burning refusals
 * until the counter catches up.
 */
export function persistedNonces(relayUrl: string) {
  // ONE sequence per relay, not one per context. A client is rebuilt whenever
  // the chosen context changes, and every client calls `execute` for any
  // context — so a per-context counter handed the same (context, device) ledger
  // two sequences, and whichever lagged was refused as a replay. The ledger is a
  // window that accepts any unseen nonce above its floor, so a single rising
  // sequence shared by every context only ever skips, which is free.
  const key = nonceKey(relayUrl);
  return {
    next: async (): Promise<bigint> => {
      let n = 0n;
      try {
        n = readNonceFloor(relayUrl);
      } catch {
        n = 0n;
      }
      try {
        localStorage.setItem(key, String(n + 1n));
      } catch {
        /* unpersisted: this page view still advances in memory */
      }
      return n;
    },
  };
}

function nonceKey(relayUrl: string): string {
  return `calimero.nonce.${relayUrl}`;
}

/**
 * Where this relay's sequence stands: its own counter, or — the first time,
 * before one exists — the highest of the per-context counters an earlier build
 * kept, so moving to one sequence replays nothing.
 */
function readNonceFloor(relayUrl: string): bigint {
  const own = localStorage.getItem(nonceKey(relayUrl));
  if (own !== null) return BigInt(own);
  const legacy = `${nonceKey(relayUrl)}.`;
  let max = 0n;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith(legacy)) continue;
    const v = BigInt(localStorage.getItem(k) ?? '0');
    if (v > max) max = v;
  }
  return max;
}

/**
 * Record that `nonce` is spent for this device, so later intents start above
 * it. A creation warrant's nonce is spent in the NEW context's own window; one
 * sequence per relay covers that context like any other.
 */
export function markContextNonceSpent(relayUrl: string, _contextId: string, nonce: bigint): void {
  try {
    if (readNonceFloor(relayUrl) <= nonce) localStorage.setItem(nonceKey(relayUrl), String(nonce + 1n));
  } catch {
    /* unpersisted: the first write meets a spent nonce once, and retries above it */
  }
}

const RELAY_NODE_KEY_PREFIX = 'calimero.delegated.relay-node-key.';

function relayOrigin(relayUrl: string): string {
  return relayUrl.replace(/\/+$/, '');
}

/**
 * Pin a relay's device signing key, hex (32 bytes), learned out of band.
 *
 * `login()` binds the session to this key, and it must never be read from the
 * relay being logged in to — the answering party would choose what the device
 * signs about. Until the cloud publishes it (mdma#312), it comes from the
 * relay's operator.
 */
export function pinRelayNodeKey(relayUrl: string, nodeKey: string): void {
  localStorage.setItem(RELAY_NODE_KEY_PREFIX + relayOrigin(relayUrl), nodeKey.trim().toLowerCase());
}

/** The pinned key for a relay, or `null` if none was pinned. */
export function readPinnedRelayNodeKey(relayUrl: string): string | null {
  try {
    const v = localStorage.getItem(RELAY_NODE_KEY_PREFIX + relayOrigin(relayUrl));
    return v && /^[0-9a-f]{64}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

function isLoopback(relayUrl: string): boolean {
  try {
    const { hostname } = new URL(relayUrl);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

/** The one relay image trusted: no shell, so nobody reads the TD. */
const TRUSTED_RELAY_PROFILE = 'locked-read-only';
/**
 * The oldest relay release trusted: the first that serves delegated context
 * creation and governance at the namespace-op schema this client signs.
 */
const MIN_RELAY_RELEASE = '2.3.99';

let loadedDcap: Promise<DcapVerify> | undefined;

/**
 * `verify` out of a dynamically imported `@phala/dcap-qvl`, whatever shape the
 * bundler gave the module.
 *
 * The package is CommonJS (`module.exports = { verify, … }`). Node and Rollup
 * expose its keys as named exports; a browser pre-bundle — Vite's dev optimizer
 * among them — hands back a namespace whose only export is `default`. Reading
 * only the named export there yields `undefined`, the quote check throws, no
 * relay key is learned, and every admin read on a hosted relay goes out with no
 * credential.
 */
function dcapVerifyFrom(mod: unknown): DcapVerify {
  const ns = mod as { verify?: unknown; default?: { verify?: unknown } };
  const verify = typeof ns.verify === 'function' ? ns.verify : ns.default?.verify;
  if (typeof verify !== 'function') {
    throw new TypeError('@phala/dcap-qvl loaded without a verify function');
  }
  return verify as DcapVerify;
}

/**
 * Thrown by every step of learning a relay's key that only moves bytes: reading
 * the release the relay names, fetching that release, loading the quote
 * library, reaching the relay for its quote. Such a step failing says nothing
 * about the relay's image, so the attempt is worth making again.
 *
 * Anything else thrown while learning the key is the verification itself
 * saying no, and that is final.
 */
class RelayKeyTransportError extends Error {
  constructor(readonly step: string, readonly cause: unknown) {
    super(`${step}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'RelayKeyTransportError';
  }
}

/** `step` run so that whatever it throws is a transport failure. */
async function transport<T>(step: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    throw e instanceof RelayKeyTransportError ? e : new RelayKeyTransportError(step, e);
  }
}

/**
 * `fetch` for the relay's own endpoints, failing as transport on no answer or
 * a non-2xx one. The response is still handed back on a non-2xx status — the
 * caller's own reading of it stays what it was — but the attempt is marked, so
 * whatever the caller then throws about it is read as transport too.
 */
function relayFetch(marked: { failure: unknown }): typeof fetch {
  return async (input, init) => {
    let response: Response;
    try {
      response = await globalThis.fetch(input, init);
    } catch (e) {
      marked.failure = e;
      throw new RelayKeyTransportError(`reaching ${String(input)}`, e);
    }
    if (!response.ok) marked.failure ??= new Error(`${String(input)} answered HTTP ${response.status}`);
    return response;
  };
}

/**
 * A verifier for a hosted relay's quote: the signed mero-tee release it says it
 * runs (fetched from the public mirror, trusted only for its signature), Intel's
 * chain, and all five registers of that release's image.
 *
 * The cloud's mirror is the only source a browser can read. The same two files
 * are assets of the mero-tee GitHub release, but GitHub serves release assets
 * from `release-assets.githubusercontent.com` with no CORS header (and
 * `github.com/.../releases/download` redirects there with none either), so a
 * page cannot read them. A mirror that does not answer is therefore waited out
 * by the caller ({@link learnRelayNodeKey}) rather than routed around.
 *
 * `@phala/dcap-qvl` is loaded on the first quote it checks: it is most of the
 * weight, and an app that never meets a real relay never needs it. A failed
 * download is forgotten, so the next attempt tries again.
 */
function relayQuoteVerifier(relayUrl: string, fetchRelay: typeof fetch): VerifyTransportQuote {
  const verify: VerifyTransportQuote = async (attestation) => {
    const dcapVerify = await transport('loading the quote verifier', () => {
      loadedDcap ??= import('@phala/dcap-qvl').then(
        (mod) => dcapVerifyFrom(mod),
        (error: unknown) => {
          loadedDcap = undefined;
          throw error;
        },
      );
      return loadedDcap;
    });
    return createSignedReleaseVerifier({
      dcapVerify,
      // Fetched only. Its signature, its version and the quote's registers are
      // all checked by the verifier after this returns, and none of that is a
      // transport question.
      release: () =>
        transport('fetching the release the relay runs', async () =>
          fetchNodeRelease(
            cloudNodeReleaseUrl(DEFAULT_RELEASE_MIRROR, await fetchNodeReleaseVersion(relayUrl, { fetch: fetchRelay })),
          ),
        ),
      profile: TRUSTED_RELAY_PROFILE,
      minReleaseVersion: MIN_RELAY_RELEASE,
    })(attestation);
  };
  return Object.assign(verify, { includeCollateral: true as const });
}

/**
 * One attempt at a relay's node key, and what became of it:
 *
 * - `learned`: verified (or already pinned), and pinned now;
 * - `unavailable`: something on the way did not answer — the relay, the release
 *   mirror, the quote library's download. Nothing was decided; try again.
 * - `refused`: the relay answered and its proof did not hold — a quote that is
 *   not of a trusted image, not bound to this request, a mock from a hosted
 *   relay. Trying again cannot change that answer into a yes, and must not.
 */
export type RelayNodeKeyAttempt =
  | { kind: 'learned'; nodeKey: string }
  | { kind: 'unavailable'; error: unknown }
  | { kind: 'refused'; error: unknown };

/**
 * The relay's node key: the pinned one, or else learned from the relay's TEE
 * attestation (see mero-js `attestRelayNodeKey`) and pinned for next time.
 *
 * A mock quote proves nothing about hardware, so one is accepted only from a
 * loopback relay — a local rig. A real one must be a signed release of the
 * trusted profile ({@link relayQuoteVerifier}).
 *
 * `fresh` skips the pin and attests now, for a step that hands the relay
 * something it keeps — founding a namespace through it. A pinned key was
 * checked once, on some earlier day, against whatever answered then.
 */
export async function attemptRelayNodeKey(
  relayUrl: string,
  options: { fresh?: boolean } = {},
): Promise<RelayNodeKeyAttempt> {
  const pinned = options.fresh ? null : readPinnedRelayNodeKey(relayUrl);
  if (pinned) return { kind: 'learned', nodeKey: pinned };
  const marked: { failure: unknown } = { failure: null };
  const fetchRelay = relayFetch(marked);
  try {
    // A loopback relay is a dev rig answering with mock quotes; anything else
    // must prove its image.
    const local = isLoopback(relayUrl);
    const { nodeKey } = await attestRelayNodeKey({
      relayUrl,
      allowMock: local,
      fetch: fetchRelay,
      ...(local ? {} : { verify: relayQuoteVerifier(relayUrl, fetchRelay) }),
    });
    pinRelayNodeKey(relayUrl, nodeKey);
    return { kind: 'learned', nodeKey };
  } catch (e) {
    if (e instanceof RelayKeyTransportError || marked.failure) return { kind: 'unavailable', error: e };
    return { kind: 'refused', error: e };
  }
}

/**
 * The relay's node key: the pinned one, or else learned from the relay's TEE
 * attestation in one attempt; `null` when that attempt did not learn it, for
 * whatever reason. Callers that must end up with the key use
 * {@link learnRelayNodeKey}.
 */
export async function resolveRelayNodeKey(relayUrl: string): Promise<string | null> {
  const attempt = await attemptRelayNodeKey(relayUrl);
  if (attempt.kind === 'learned') return attempt.nodeKey;
  console.warn('[mero-js] could not learn the relay node key from its attestation', attempt.error);
  return null;
}

/**
 * How long to wait before each retry of an unavailable relay key: quickly at
 * first, for a blip or a cold cache, then every 30 s for as long as it takes.
 */
export const RELAY_NODE_KEY_RETRY_MS: readonly number[] = [1_000, 2_000, 5_000, 10_000, 30_000];

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done);
  });
}

/**
 * The relay's node key, however long the way to it is down.
 *
 * One failed fetch of the release used to cost the whole session: no key, so no
 * relay session, so every admin read and every event stream unauthenticated
 * until a reload. A transport failure here is now waited out with backoff
 * ({@link RELAY_NODE_KEY_RETRY_MS}) until the key is learned or `signal` aborts.
 *
 * A refusal ends it at once with `null`. A quote that did not verify is an
 * answer, and asking again is not how it becomes a different one.
 */
export async function learnRelayNodeKey(
  relayUrl: string,
  options: { signal?: AbortSignal } = {},
): Promise<string | null> {
  const { signal } = options;
  for (let failures = 0; !signal?.aborted; failures += 1) {
    const attempt = await attemptRelayNodeKey(relayUrl);
    if (attempt.kind === 'learned') return attempt.nodeKey;
    if (attempt.kind === 'refused') {
      console.warn("[mero-js] refusing the relay's attestation; its node key stays unknown", attempt.error);
      return null;
    }
    const wait = RELAY_NODE_KEY_RETRY_MS[Math.min(failures, RELAY_NODE_KEY_RETRY_MS.length - 1)]!;
    console.warn(
      `[mero-js] could not reach what proves the relay's node key; retrying in ${wait / 1000} s`,
      attempt.error,
    );
    await pause(wait, signal);
  }
  return null;
}

/** Milliseconds-since-epoch a JWT expires at, or `null` if unreadable. */
function jwtExpiryMs(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------- sealing
//
// Everything a delegated session sends a hosted relay is sealed to the relay's
// attested TD (mero-js `createAttestedSealedFetch`), so TLS that ends at the
// relay's ingress, and whoever holds its certificate, reads none of it: not the
// login, not the token, not a query or its result, not an event.
//
// A relay whose node leaves auth to its proxy, and has no
// `[server.sealed] forward_auth`, cannot guard a logged-in route inside the
// envelope and answers `403 sealed_route_unguarded` from inside it. Only then
// does a request go out plain, as it always did before sealing: that answer is
// sealed under the session, so nobody on the way can forge it to force the
// downgrade. Anything else that goes wrong, an attestation refused or a relay
// that does not answer, fails the request; it never falls back.

const sealedFetches = new Map<string, typeof fetch>();

/** Forget every relay's sealed transport. For tests. */
export function forgetRelaySealing(): void {
  sealedFetches.clear();
}

/** Whether a sealed answer is the TD saying it cannot guard this route sealed. */
async function isUnguardedRefusal(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  try {
    const body = (await response.clone().json()) as { error?: { code?: unknown } };
    return body.error?.code === 'sealed_route_unguarded';
  } catch {
    return false;
  }
}

/** Whether `request` needs a session the relay's proxy checks: a token, or a login. */
function needsSession(request: Request): boolean {
  return request.headers.has('authorization') || new URL(request.url).pathname.startsWith('/auth/');
}

function sealedRelayFetch(relayUrl: string): typeof fetch {
  const plain: typeof fetch = (input, init) => globalThis.fetch(input, init);
  const sealed = createAttestedSealedFetch({
    baseUrl: relayUrl,
    verify: relayQuoteVerifier(relayUrl, plain),
    fetch: plain,
  });
  // Set once the TD has said it cannot guard a logged-in call: those go plain
  // straight away instead of paying a refused round trip each.
  let unguarded = false;
  return async (input, init) => {
    const request = new Request(input, init);
    if (unguarded && needsSession(request)) return plain(request);
    const response = await sealed(request.clone());
    if (!(await isUnguardedRefusal(response))) return response;
    if (!unguarded) {
      unguarded = true;
      console.warn(
        `[mero-js] ${relayOrigin(relayUrl)} cannot guard logged-in calls sealed (no forward_auth); ` +
          'they go over its TLS until it does',
      );
    }
    return plain(request);
  };
}

/**
 * The `fetch` a delegated session uses for `relayUrl`: sealed to its attested
 * TD, one per relay so its session is shared. `undefined` for a loopback relay,
 * a dev rig answering mock quotes, which keeps the global `fetch`.
 */
export function relayTransportFetch(relayUrl: string): typeof fetch | undefined {
  if (isLoopback(relayUrl)) return undefined;
  const origin = relayOrigin(relayUrl);
  let found = sealedFetches.get(origin);
  if (!found) {
    found = sealedRelayFetch(relayUrl);
    sealedFetches.set(origin, found);
  }
  return found;
}

/**
 * A lazily minted `account_proof` session on the relay.
 *
 * A hosted relay's `/admin-api/` sits behind the node's forward-auth, which
 * knows no request proof — it answers a Bearer token or 401. Logging in with
 * the device certificate is how a keyholder gets that token. Minted on first
 * use and re-minted once it has expired. On failure it yields `undefined`, the
 * admin request then goes out unauthenticated and the node's 401 is what the
 * caller sees; the next call tries to log in again.
 */
function relaySession(s: DelegatedSession & { relayUrl: string }, nodeKey: string) {
  let token: string | null = null;
  let inflight: Promise<string | undefined> | null = null;
  return async (): Promise<string | undefined> => {
    const exp = token ? jwtExpiryMs(token) : null;
    if (token && (exp === null || exp - Date.now() > 30_000)) return token;
    if (!inflight) {
      inflight = login({
        nodeUrl: s.relayUrl,
        // Sealed: the token is the session, and the TLS ends outside the TD.
        fetch: relayTransportFetch(s.relayUrl),
        node: nodeKey,
        deviceSecret: s.deviceSecret,
        accountProof: s.credential,
        audience: defaultAudience(),
      })
        .then((minted) => {
          token = minted.accessToken;
          return token;
        })
        .catch((e: unknown) => {
          console.warn('[mero-js] relay login failed', e);
          token = null;
          return undefined;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };
}

// ------------------------------------------------------------- reads by query
//
// mero-js's relay transport sends every `execute` as an `/intents` warrant: a
// nonce spent, a signature, and the relay running the method as a write even
// when it only reads. An account session may not use `/jsonrpc` on a relay
// (403, measured on prod), but it may `POST /admin-api/contexts/{ctx}/query`
// (`context:query`; 200 on every app in the prod journeys), which runs a method
// the app's ABI declares read-only and refuses any other with a 409.
//
// A call carries no marker of which it is — generated ABI clients call
// `execute({ contextId, method, argsJson })` for both — so the node's own
// answer is what tells them apart: a method is tried as a query first, and a
// 409 says it is a write, remembered per relay, context and method so the
// probe is paid once. Any other failure of the query is not an answer about
// the method, so the call falls back to the warrant, which reads too.

type MethodKind = 'read' | 'write';
/** What the node said each `relay|context|method` is; survives client rebuilds. */
const methodKinds = new Map<string, MethodKind>();

/** Forget what was learned about which methods read. For tests. */
export function forgetMethodKinds(): void {
  methodKinds.clear();
}

/** Core's refusal of a query for a method the ABI does not declare read-only. */
function isNotAView(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { status?: unknown }).status === 409;
}

/**
 * `client.rpc` with reads routed through `client.admin.queryContext`: the
 * session-authenticated query for a method the node knows as a view, the
 * warrant for everything else. Only for a client with a session, since the
 * query route wants one.
 */
function readsThroughQuery(client: MeroClient, relayUrl: string): ExecuteTransport {
  const inner = client.rpc;
  const origin = relayOrigin(relayUrl);
  const run = async <T,>(params: ExecuteParams): Promise<ExecuteResult<T>> => {
    const key = `${origin}|${params.contextId}|${params.method}`;
    if (methodKinds.get(key) !== 'write') {
      try {
        const { returns } = await client.admin.queryContext(params.contextId, {
          method: params.method,
          // The node defaults a warrant's missing `argsJson` to `{}`; the same here.
          argsJson: params.argsJson ?? {},
        });
        methodKinds.set(key, 'read');
        // No root hash: a read changes nothing, and `undefined` is "unknown
        // here", never "nothing changed" (see mero-js `ExecuteResult`).
        return { returns: returns as T, transport: 'relay' };
      } catch (e) {
        if (isNotAView(e)) methodKinds.set(key, 'write');
      }
    }
    return inner.executeWithMetadata<T>(params);
  };
  return {
    get kind() {
      return inner.kind;
    },
    get canSubscribe() {
      return inner.canSubscribe;
    },
    execute: async <T,>(params: ExecuteParams): Promise<T> => (await run<T>(params)).returns,
    executeWithMetadata: run,
    migrateMyEntries: (contextId) => inner.migrateMyEntries(contextId),
    countMyPending: (contextId) => inner.countMyPending(contextId),
  };
}

/**
 * An event stream that opens nothing: for a hosted relay whose node key is not
 * attested yet.
 *
 * A hosted relay's `/sse` sits behind forward-auth that knows a Bearer token
 * and nothing else, so the proof-authenticated stream mero-js builds without a
 * node key is answered 401 `missing_token` — not one of the terminal auth
 * errors, so `SseClient` reconnected on a timer for as long as the key stayed
 * unknown. The hooks take `client.events` and connect without asking, so the
 * stream handed out meanwhile is a real `SseClient` whose connect waits for a
 * close instead of fetching: it holds its subscriptions, emits no error, and
 * reaches the network never. The client built once the key is learned brings
 * the session-backed stream, and the hooks' effects move onto it.
 */
function dormantEvents(relayUrl: string): SseClient {
  return new SseClient({
    baseUrl: relayUrl,
    authorize: async () => ({}),
    fetch: (_url, init) =>
      new Promise<Response>((_, reject) => {
        const abort = () => reject(Object.assign(new Error('the stream was closed before the relay was attested'), { name: 'AbortError' }));
        if (init?.signal?.aborted) return abort();
        init?.signal?.addEventListener('abort', abort, { once: true });
      }),
  });
}

/**
 * The relay client as a delegated session uses it: `rpc` reading by query when
 * the client has a session, and no events until the relay is attested.
 * Everything else is the client's own, `this` kept.
 */
function delegatedClient(client: MeroClient, opts: { relayUrl: string; session: boolean; attested: boolean }): MeroClient {
  const rpc = opts.session ? readsThroughQuery(client, opts.relayUrl) : null;
  let dormant: SseClient | null = null;
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'rpc' && rpc) return rpc;
      if (!opts.attested) {
        if (prop === 'canSubscribe') return false;
        if (prop === 'events') return (dormant ??= dormantEvents(opts.relayUrl));
        if (prop === 'close') {
          return () => {
            dormant?.close();
            target.close();
          };
        }
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * Build the client a delegated session talks through.
 *
 * The result is a relay-transport `MeroClient`. Its `rpc.execute` takes the same
 * named arguments a node client's does, which is what lets a generated ABI
 * client — and every hook that only calls `execute` — work unchanged. What it
 * also has is `admin` and `events`, pointed at the relay and authenticated as
 * the account by the device certificate, so the caller-scoped reads answer this
 * account's own contexts and namespaces rather than the node's.
 */
export function buildDelegatedClient(
  s: DelegatedSession,
  // Kept for callers; the client no longer depends on the chosen context.
  _contextId: string | null,
): MeroClient | null {
  // No relay, no client — and deliberately no placeholder either.
  //
  // A relay-transport client IS a URL plus a credential; with no URL there is
  // nothing to post an intent to. `null` propagates as "not connected for
  // writing" while the session stays authenticated, which is the honest shape
  // for a brand-new account: it exists, it has a certificate, and it has not
  // been invited anywhere yet. A stand-in URL would make every write fail as a
  // refused warrant against a node that was never chosen.
  if (!s.relayUrl) return null;
  const nodeKey = readPinnedRelayNodeKey(s.relayUrl);
  const client = createMeroClient({
    transport: 'relay',
    // Every request sealed to the relay's attested TD: intents, admin reads,
    // queries, the login and events (see `relayTransportFetch`).
    fetch: relayTransportFetch(s.relayUrl),
    relay: {
      relayUrl: s.relayUrl,
      authorAccount: s.account,
      authorProof: s.credential,
      deviceSecret: s.deviceSecret,
      // One sequence per relay, whatever context is chosen: `execute` takes a
      // context per call, so the nonce source must not depend on this one.
      nonces: persistedNonces(s.relayUrl),
    },
    // The certificate authenticates the requests too, not just the writes.
    //
    // This is the whole of what reads and events need: the device key signs each
    // request, and the node verifies it against the account's certificate with no
    // store read and no prior relationship. Measured against a node built from
    // core `aecba573b`: `listNamespaces` and `getContexts` answer `200` and are
    // caller-scoped, `/sse` answers `200`, and a real write arrives on the stream
    // as a `StateMutation` frame.
    //
    // What this replaces is a session minted by `login()` plus the relay node's
    // signing key learned out of band — two inputs, one of which the cloud does
    // not publish, for an answer the certificate already gives.
    proof: { credential: s.credential, deviceSecret: s.deviceSecret },
    // A session, when this relay's node key is pinned. A hosted relay's
    // forward-auth accepts a Bearer token and not the proof above, so without
    // one every admin read there is a 401. Given a session the client uses it
    // for every admin call; a relay with no pinned key keeps the proof path.
    session: nodeKey ? relaySession({ ...s, relayUrl: s.relayUrl }, nodeKey) : undefined,
    // Events too. `/sse` on a relay sits behind the same forward-auth, so the
    // proof above gets a 401 there; with the node key the client observes
    // through its own device-certificate login instead.
    observe: nodeKey ? { nodeKey } : undefined,
  });
  // Events wait for the relay's node key on a hosted relay, whose forward-auth
  // answers the proof-only stream 401 and would have it reconnect forever. A
  // loopback relay is a dev rig that takes the proof as a node does.
  return delegatedClient(client, {
    relayUrl: s.relayUrl,
    session: nodeKey !== null,
    attested: nodeKey !== null || isLoopback(s.relayUrl),
  });
}

// ------------------------------------------------------------------ relay map
//
// An account's namespaces may be served by different relays. A relay admits
// the account to a namespace and then serves that namespace's contexts, so the
// client keeps, per account, which relay serves which namespace and context:
//
//   namespaces: { <namespace id>: <relay url> }  — learned when a join succeeds
//   contexts:   { <context id>:   <relay url> }  — learned from each relay's
//                                                  caller-scoped listing
//
// In localStorage, beside the pinned node keys: URLs and ids only, nothing
// secret, and it has to survive a reload for the open context to find its
// relay. Losing it costs a re-listing, not access.

const RELAY_MAP_PREFIX = 'calimero.delegated.relays.';

export interface RelayMap {
  namespaces: Record<string, string>;
  contexts: Record<string, string>;
}

export function readRelayMap(account: string): RelayMap {
  try {
    const raw = localStorage.getItem(RELAY_MAP_PREFIX + account);
    const parsed = raw ? (JSON.parse(raw) as Partial<RelayMap>) : {};
    return { namespaces: parsed.namespaces ?? {}, contexts: parsed.contexts ?? {} };
  } catch {
    return { namespaces: {}, contexts: {} };
  }
}

function writeRelayMap(account: string, map: RelayMap): void {
  try {
    localStorage.setItem(RELAY_MAP_PREFIX + account, JSON.stringify(map));
  } catch {
    /* unpersisted: this page view still routes from what it lists */
  }
}

/** Record the relay that admitted this account to a namespace (and, when known, the context it came for). */
export function rememberRelay(
  account: string,
  relayUrl: string,
  at: { namespaceId?: string; contextId?: string },
): void {
  const map = readRelayMap(account);
  const url = relayOrigin(relayUrl);
  if (at.namespaceId) map.namespaces[at.namespaceId] = url;
  if (at.contextId) map.contexts[at.contextId] = url;
  writeRelayMap(account, map);
}

/** The relay that serves a context, if this account has learned it. */
export function relayForContext(account: string, contextId: string): string | null {
  return readRelayMap(account).contexts[contextId] ?? null;
}

/**
 * A session moving to `next`, keeping the relay's executor account the previous
 * one knew when both are the same relay.
 *
 * A join hands back a session built from the admitting node alone, which has no
 * executor on it. When that node is the relay the account was already on — the
 * one the cloud assigned it, say — dropping the executor would cost nothing
 * today (the joined namespace can answer for it) but leaves the session knowing
 * less than it did. On a different relay the old executor is the wrong account,
 * so it is left behind.
 */
export function carryExecutorAccount(prev: DelegatedSession | null, next: DelegatedSession): DelegatedSession {
  if (next.executorAccount || !prev?.executorAccount || !prev.relayUrl || !next.relayUrl) return next;
  if (relayOrigin(prev.relayUrl) !== relayOrigin(next.relayUrl)) return next;
  return { ...next, executorAccount: prev.executorAccount };
}

/** Every relay this account is known to use: the session's, and each in the map. */
export function knownRelays(s: DelegatedSession): string[] {
  const map = readRelayMap(s.account);
  const all = [s.relayUrl, ...Object.values(map.namespaces), ...Object.values(map.contexts)]
    .filter((u): u is string => typeof u === 'string' && u.length > 0)
    .map(relayOrigin);
  return [...new Set(all)];
}

type ListedContext = Awaited<ReturnType<MeroClient['admin']['getContexts']>>['contexts'][number];

/**
 * This account's contexts on every relay it knows, each tagged with the relay
 * that listed it — and that relay recorded as the one serving it.
 *
 * Each relay answers only for itself and only for this caller, so the union is
 * exactly the account's contexts across relays. A relay that cannot be reached
 * or logged in to is skipped (its contexts simply do not appear), not fatal.
 */
export async function listDelegatedContexts(
  s: DelegatedSession,
): Promise<Array<ListedContext & { relayUrl: string }>> {
  const out: Array<ListedContext & { relayUrl: string }> = [];
  const map = readRelayMap(s.account);
  for (const relayUrl of knownRelays(s)) {
    try {
      if (!(await resolveRelayNodeKey(relayUrl))) continue;
      const client = buildDelegatedClient({ ...s, relayUrl }, null);
      if (!client) continue;
      const { contexts } = await client.admin.getContexts();
      for (const c of contexts ?? []) {
        out.push({ ...c, relayUrl });
        map.contexts[c.id] = relayUrl;
      }
    } catch (e) {
      console.warn(`[mero-js] could not list contexts on ${relayUrl}`, e);
    }
  }
  writeRelayMap(s.account, map);
  return out;
}

type ListedNamespace = Awaited<ReturnType<MeroClient['admin']['listNamespaces']>>[number];

/**
 * This account's namespaces on every relay it knows, each tagged with the relay
 * that listed it and recorded as that namespace's relay. Same rules as
 * {@link listDelegatedContexts}: each relay answers for itself and this caller
 * only (`namespace:list-own`); an unreachable relay is skipped.
 */
export async function listDelegatedNamespaces(
  s: DelegatedSession,
): Promise<Array<ListedNamespace & { relayUrl: string }>> {
  const out: Array<ListedNamespace & { relayUrl: string }> = [];
  const seen = new Set<string>();
  const map = readRelayMap(s.account);
  for (const relayUrl of knownRelays(s)) {
    try {
      if (!(await resolveRelayNodeKey(relayUrl))) continue;
      const client = buildDelegatedClient({ ...s, relayUrl }, null);
      if (!client) continue;
      for (const ns of await client.admin.listNamespaces()) {
        if (seen.has(ns.namespaceId)) continue;
        seen.add(ns.namespaceId);
        out.push({ ...ns, relayUrl });
        map.namespaces[ns.namespaceId] ??= relayUrl;
      }
    } catch (e) {
      console.warn(`[mero-js] could not list namespaces on ${relayUrl}`, e);
    }
  }
  writeRelayMap(s.account, map);
  return out;
}
