/**
 * Client for Calimero 1.0, the confidential cloud: one app = one replicated log on
 * attested nodes; this client verifies the node, seals every request to it,
 * signs people in with passkeys and machines with API keys.
 *
 * ```ts
 * const cloud = new CalimeroClient({ baseUrl, policy: { release: { minReleaseVersion: '2.3.109' } } });
 * await cloud.signIn(browserPasskey());
 * const { result } = await cloud.call(appId, 'set', { key: 'a', value: '1' });
 * ```
 */

import { SealedTransportError, createSealedFetch } from '../sealed/sealed.js';
import { fetchAttestedKey, type AttestationDoc, type CloudPolicy } from './attestation.js';
import { DEFAULT_DIRECTORY, orderNodes, readDirectory } from './directory.js';
import {
  CalimeroError,
  ConfirmCancelled,
  ConfirmRequired,
  LoginRequired,
  UnavailableError,
  WrongNode,
  errorFrom,
} from './errors.js';
import { b64url, fromB64url, type PasskeyProvider } from './passkey.js';
import {
  confirmationCode,
  pageQuery,
  pendingApprovalsFrom,
  type AppsReport,
  type ConsentRequest,
  type ConsentResult,
  type ConsentStarted,
  type OpenConsentOptions,
  type OpsAppsReport,
  type OpsOrgsReport,
  type PageOptions,
  type PendingApprovals,
  type PublisherBindingInfo,
  type PublisherProof,
  type ReleaseRules,
  type ReportedApp,
} from './approvals.js';

export {
  AppError,
  ArgsTooLarge,
  CalimeroError,
  ConfirmCancelled,
  ConfirmRequired,
  IdempotencyMismatch,
  LoginRequired,
  ConsentStale,
  NotFound,
  ReleaseDeadlineError,
  TrapError,
  UnavailableError,
  WrongNode,
  errorFrom,
} from './errors.js';
export type { Committed } from './errors.js';

export interface CalimeroSession {
  accountId: string;
  sessionToken: string;
  expiresAt: number;
  refreshToken: string;
}

export interface CallResult {
  index: number;
  result: unknown;
  events: Array<{ kind: string; data: unknown }>;
}

export interface ViewResult {
  index: number;
  result: unknown;
}

export interface CloudEvent {
  id: string;
  kind: string;
  data: unknown;
}

/** What installing a package release answers. */
export interface PackageInstalled {
  package: string;
  version: string;
  signerId: string;
  /** Service name (`''` for a single-service bundle) -> the bundle hash it runs as. */
  services: Record<string, string>;
}

/** An installed package and its releases. */
export interface PackageInfo {
  package: string;
  signerId: string;
  owner: string;
  latest: string | null;
  versions: Array<{
    version: string;
    mpk: string;
    size: number;
    source: 'registry' | 'upload';
    services: Record<string, string>;
    metadata: unknown;
    outbound: string[];
    installedBy: string;
    installedAt: number;
  }>;
}

/** One app instance as `listApps` answers it. */
export interface AppInfo {
  appId: string;
  name: string;
  owner: string;
  org: string | null;
  bundle: string;
  package: string | null;
  version: string | null;
}

/**
 * An organization-wide upgrade run, as `upgradeOrg`, `upgradeRun` and
 * `retryUpgradeRun` answer it (core's `UpgradeRun`).
 */
export interface UpgradeRun {
  runId: string;
  package: string;
  version: string;
  team?: string;
  cascade: boolean;
  /** The account that started it, or `operator`. */
  by: string;
  startedAt: number;
  apps: string[];
  done: string[];
  /** App id -> why its upgrade failed. */
  failed: Record<string, unknown>;
  finished: boolean;
}

/** One of an app's blobs: `blobId` base58 (what apps print), `id` hex. */
export interface BlobInfo {
  blobId: string;
  id: string;
  size: number;
}

/** One device present in an app (`publishPresence`); `state` hex, `null` once retracted. */
export interface PresenceEntry {
  account: string;
  device: string;
  state: string | null;
}

/** What an organization-wide upgrade targets. */
export interface OrgUpgradeTarget {
  package: string;
  version: string;
  /** Only this team's apps (and, with `cascade`, those of the teams below it). */
  team?: string;
  cascade?: boolean;
  migrate?: string;
}

/**
 * `GET /orgs/{org}`: the organization as the caller sees it. Besides its
 * members, teams and metadata, who may approve its releases, the package
 * signing keys it publishes, and whether a passed release deadline has
 * stopped new work on its own set.
 */
export interface OrgInfo extends Record<string, unknown> {
  /** Accounts holding `APPROVE_RELEASES` there (owner and admins included). */
  releaseApprovers: string[];
  /** The signer ids (`did:key`) bound to it as publisher. */
  publishes: string[];
  /** `null` unless a deadline stopped new work: approve `release` (or newer) to lift it. */
  newWorkStopped: { release: string; after: string } | null;
}

/** One URL path segment, so an id cannot reach another route. */
function seg(value: string): string {
  return encodeURIComponent(value);
}

/**
 * The node refuses an envelope past its 64 MiB sealed cap with `413` in the
 * clear, before opening it, so the refusal arrives as the transport's. To the
 * caller it is the API's `TOO_LARGE`, as the Rust client reports it.
 */
function sealedError(error: unknown): unknown {
  if (error instanceof SealedTransportError && error.status === 413) {
    return errorFrom(413, {
      error: 'TOO_LARGE',
      message: error.message.replace(/^Sealed request refused: /, ''),
    });
  }
  return error;
}

/** Read a refused response's body and map it ({@link errorFrom}). */
async function refusal(response: Response): Promise<CalimeroError> {
  const text = await response.text().catch(() => '');
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text };
  }
  return errorFrom(response.status, body, response.headers.get('retry-after'));
}

/** Server-sent event frames from a response body: `{ id, kind, data }` each, `data` parsed as JSON when it is. */
async function* sseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<CloudEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      let id = '';
      let kind = '';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('id:')) id = line.slice(3).trim();
        else if (line.startsWith('event:')) kind = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!kind && !data) continue;
      let parsed: unknown = data;
      try {
        parsed = JSON.parse(data);
      } catch {
        /* plain text */
      }
      yield { id, kind, data: parsed };
    }
  }
}

/** Bytes as lower-case hex. */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A key for a call the caller gave none, made once so every retry shares it:
 * `node:c-` and 16 random bytes in base64url without padding, as the Rust
 * client mints it. It only has to outlive this client's own retries, so it
 * takes the node's short-lived class: a key starting `node:` is kept 10
 * minutes, a caller's own key 24 hours.
 * `getRandomValues`, not `randomUUID`, which a page outside a secure context lacks.
 */
function newIdempotencyKey(): string {
  return `node:c-${b64url(crypto.getRandomValues(new Uint8Array(16)))}`;
}

/**
 * How a call or a view is sent again while the node is unavailable (D70): with
 * the same key, after a backoff that starts at `baseDelayMs` and doubles up to
 * `maxDelayMs`, no jitter, at most `retries` times. The defaults are the Rust
 * client's: 6 retries, 200 ms doubling, at most 2 s (about 9 s in all, past a
 * leader election).
 */
export interface CloudRetryOptions {
  /** Retries after the first attempt. Default 6. */
  retries?: number;
  /** The first backoff; each retry doubles it. Default 200 ms. */
  baseDelayMs?: number;
  /** The longest backoff. Default 2 s. */
  maxDelayMs?: number;
}

export const DEFAULT_RETRY = { retries: 6, baseDelayMs: 200, maxDelayMs: 2000 } as const;

/** The backoff before retry `retry` (0 for the first): `baseDelayMs` doubling, at most `maxDelayMs`. */
export function retryDelayMs(retry: number, options: { baseDelayMs: number; maxDelayMs: number }): number {
  return Math.min(options.baseDelayMs * 2 ** retry, options.maxDelayMs);
}

export interface CalimeroClientOptions {
  /** One node of the cluster: the one the client talks to first. */
  baseUrl: string;
  /**
   * Other nodes of the same cluster, in the order to move to them when a node
   * answers `421 WRONG_NODE` (its release may not serve this account), or stays
   * unavailable to a call or a view through all its retries. Each is attested
   * under the same `policy` before anything is sent to it. Without them a `421`
   * reaches the caller as {@link WrongNode}.
   */
  nodes?: string[];
  policy: CloudPolicy;
  /** Fetch that carries attestation and envelopes. Defaults to global `fetch`. */
  fetch?: typeof fetch;
  /** How calls and views retry a 503 or a failed connection. */
  retry?: CloudRetryOptions;
}

/** How {@link CalimeroClient.connect} reaches a Calimero Cloud cluster by name. */
export interface CalimeroConnectOptions {
  /** The cluster's name, e.g. `eu-shared-1`. */
  cluster: string;
  /** What every node must attest to before anything is sent to it. */
  policy: CloudPolicy;
  /** The node directory to ask. Default {@link DEFAULT_DIRECTORY}. */
  directory?: string;
  /** Try the nodes in this zone (e.g. `europe-west4-a`) first. */
  zone?: string;
  /** Fetch for the directory, attestation and envelopes. Defaults to global `fetch`. */
  fetch?: typeof fetch;
  /** How calls and views retry a 503 or a failed connection. */
  retry?: CloudRetryOptions;
  /** Randomness for the weighted node order, in [0, 1). Defaults to `Math.random`. */
  random?: () => number;
}

/** Where a client made by {@link CalimeroClient.connect} re-reads its node list. */
interface DirectorySource {
  directory: string;
  cluster: string;
  zone: string | undefined;
  random: () => number;
  /** When the listing is due to be read again (ms since the epoch). */
  due: number;
  /** The re-read under way, if any. */
  reading?: Promise<void>;
}

/**
 * The ceremonies that mint a session, which {@link CalimeroClient.send} never
 * repeats by itself: a sign-in or sign-up is started again by its caller (with
 * the passkey), and a refresh moves through the nodes in
 * {@link CalimeroClient.exchangeRefresh}. A node answers them `421 WRONG_NODE`
 * before it spends the challenge or the refresh token (core #4774).
 */
function ceremony(path: string): boolean {
  return path === 'auth/refresh' || path.startsWith('auth/passkey/');
}

export class CalimeroClient {
  /** Every node this client may use, `baseUrl` first (or as the directory last ordered them). */
  private nodeUrls: string[];
  /** The one in use: an index into {@link nodeUrls}. */
  private at = 0;
  /** A sealed fetch per node, each attesting its own node on first use. */
  private readonly channels = new Map<string, typeof fetch>();
  private readonly policy: CloudPolicy;
  /** The unsealed fetch, for the one route served in the clear (`/attestation`). */
  private readonly raw: typeof fetch;
  private auth: string | undefined;
  private current: CalimeroSession | undefined;
  /** The refresh under way, which every request that needs one shares. */
  private refreshing: Promise<CalimeroSession> | undefined;
  private readonly retry: Required<CloudRetryOptions>;
  /** Rejections of the underlying `fetch` itself: the node could not be reached or dropped the connection. */
  private readonly networkFailures = new WeakSet<object>();
  /** The directory the node list came from, for a client made by {@link connect}. */
  private source: DirectorySource | undefined;

  /**
   * A client for the Calimero Cloud cluster named `cluster`: its node list read
   * from the public node directory, those in `zone` first, each group in
   * weighted-random order. The directory only picks which nodes to try: each is
   * attested under `policy` before anything is sent to it. Throws
   * {@link DirectoryError} when the directory names no usable node.
   *
   * The list is read again in the background after a failover, and at the
   * first request once the directory's `refreshAfterSeconds` has passed.
   */
  static async connect(options: CalimeroConnectOptions): Promise<CalimeroClient> {
    const directory = options.directory ?? DEFAULT_DIRECTORY;
    const random = options.random ?? Math.random;
    const fetcher = options.fetch ?? ((input, init) => fetch(input, init));
    const listing = await readDirectory(directory, options.cluster, fetcher);
    const [baseUrl, ...nodes] = orderNodes(listing.nodes, options.zone, random);
    const client = new CalimeroClient({ baseUrl, nodes, policy: options.policy, fetch: options.fetch, retry: options.retry });
    client.source = {
      directory,
      cluster: options.cluster,
      zone: options.zone,
      random,
      due: Date.now() + listing.refreshAfterSeconds * 1000,
    };
    return client;
  }

  constructor(options: CalimeroClientOptions) {
    const trim = (url: string) => url.replace(/\/+$/, '');
    this.nodeUrls = [...new Set([options.baseUrl, ...(options.nodes ?? [])].map(trim))];
    this.policy = options.policy;
    this.retry = { ...DEFAULT_RETRY, ...options.retry };
    const given = options.fetch ?? ((input, init) => fetch(input, init));
    // `fetch` rejects with a `TypeError` when it gets no answer: the connection
    // was refused, reset or dropped before the response. The sealed fetch passes
    // that rejection on unchanged, so it is recognised here, at its source, and
    // not by its type alone (a bad URL is a `TypeError` too, and is not retried).
    const raw: typeof fetch = async (input, init) => {
      try {
        return await given(input, init);
      } catch (error) {
        if (error instanceof TypeError) this.networkFailures.add(error);
        throw error;
      }
    };
    this.raw = raw;
  }

  /** The node requests go to now: `baseUrl`, until a `421 WRONG_NODE` or a failover moved the client on. */
  get nodeUrl(): string {
    return this.nodeUrls[this.at];
  }

  /** Every node this client may use, in the order it moves through them. */
  get nodes(): string[] {
    return [...this.nodeUrls];
  }

  /** The sealed channel to `url`, attested under the client's policy before its first request. */
  private channel(url: string): typeof fetch {
    let sealed = this.channels.get(url);
    if (!sealed) {
      sealed = createSealedFetch({
        baseUrl: url,
        transportPublicKey: () => fetchAttestedKey(url, this.policy, this.raw),
        fetch: this.raw,
      });
      this.channels.set(url, sealed);
    }
    return sealed;
  }

  /**
   * Move on from node `from` (the one that answered `421 WRONG_NODE`) to the
   * next one. False when there is no other. A request that saw the same node
   * refuse after another request moved on already does not move again.
   */
  private moveOn(from: string): boolean {
    if (this.nodeUrls.length < 2) return false;
    if (this.nodeUrl === from) this.at = (this.at + 1) % this.nodeUrls.length;
    return true;
  }

  /**
   * Fail over from node `from`, where a request's retries ran out, to the next
   * node it has not `tried`. False when it has tried them all. A request whose
   * node another request moved away from already goes to that node, if untried.
   */
  private failOver(from: string, tried: Set<string>): boolean {
    if (this.nodeUrl !== from && !tried.has(this.nodeUrl)) return true;
    const count = this.nodeUrls.length;
    for (let step = 1; step < count; step++) {
      const next = (this.at + step) % count;
      if (!tried.has(this.nodeUrls[next])) {
        this.at = next;
        this.reread();
        return true;
      }
    }
    return false;
  }

  /**
   * Read the node list again from the directory, in the background, for a
   * client made by {@link connect}: the node in use stays first, then the
   * directory's order; a node no longer listed is dropped. A failed read is
   * ignored. One read at a time.
   */
  private reread(): void {
    const source = this.source;
    if (!source || source.reading) return;
    source.reading = readDirectory(source.directory, source.cluster, this.raw)
      .then((listing) => {
        const current = this.nodeUrl;
        const listed = orderNodes(listing.nodes, source.zone, source.random);
        this.nodeUrls = [current, ...listed.filter((url) => url !== current)];
        this.at = 0;
        source.due = Date.now() + listing.refreshAfterSeconds * 1000;
      })
      .catch(() => undefined)
      .finally(() => {
        source.reading = undefined;
      });
  }

  /** Authenticate every request with an API key. */
  useApiKey(key: string): void {
    this.auth = key;
    this.current = undefined;
  }

  useSession(session: CalimeroSession): void {
    this.auth = session.sessionToken;
    this.current = session;
  }

  get session(): CalimeroSession | undefined {
    return this.current;
  }

  /**
   * Send one request to the node in use, with the credential held now, and
   * answer the response, whatever its status. {@link send} judges it.
   */
  private async request(
    method: string,
    path: string,
    body?: unknown,
    raw?: Uint8Array,
    contentType = 'application/wasm',
    signal?: AbortSignal,
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (this.auth) headers.authorization = `Bearer ${this.auth}`;
    let payload: BodyInit | undefined;
    if (raw) {
      headers['content-type'] = contentType;
      payload = raw as unknown as BodyInit;
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    if (this.source && Date.now() >= this.source.due) this.reread();
    const url = this.nodeUrl;
    try {
      return await this.channel(url)(`${url}/${path}`, { method, headers, body: payload, signal });
    } catch (error) {
      throw sealedError(error);
    }
  }

  /**
   * {@link request}, answering what a lost issuing node or a node on the
   * wrong release does to a session: a successful response, or the refusal as a
   * typed error ({@link errorFrom}).
   *
   * - `401 UNAUTHENTICATED` to a request that carried a session: the node that
   *   signed the session may be gone, replaced, or out of reach of the node
   *   asked, which any node of the cluster answers with a refresh. The client
   *   refreshes once, shared by every request that needs it at the same time
   *   ({@link refresh}), and repeats the request once. A refresh that is
   *   refused surfaces as {@link LoginRequired}.
   * - `421 WRONG_NODE`: this node's release may not serve the account. The
   *   client moves to the next node it knows and repeats the request once; with
   *   none, the {@link WrongNode} reaches the caller.
   *
   * Repeating is safe even for a request that is not idempotent: the node
   * answers `401` and `421` when it judges the credential, before it reads what
   * the request asks, so the first attempt ran nothing. The exceptions are the
   * ceremonies that mint a session ({@link ceremony}), never repeated here.
   */
  private async send(
    method: string,
    path: string,
    body?: unknown,
    raw?: Uint8Array,
    contentType?: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    let refreshed = false;
    let moved = false;
    for (;;) {
      const [token, at] = [this.auth, this.nodeUrl];
      const response = await this.request(method, path, body, raw, contentType, signal);
      if (response.ok) return response;
      const error = await refusal(response);
      if (error instanceof WrongNode && !moved) {
        moved = true;
        if (this.moveOn(at) && !ceremony(path)) continue;
      } else if (error instanceof LoginRequired && !refreshed && this.mayRefresh(token, path)) {
        refreshed = true;
        await this.renew(token as string);
        continue;
      }
      throw error;
    }
  }

  /** Whether a `401` to a request sent with `token` is one a refresh may answer. */
  private mayRefresh(token: string | undefined, path: string): boolean {
    return token !== undefined && this.current !== undefined && !ceremony(path);
  }

  /**
   * A fresh session in place of the one `token` belonged to: by the refresh
   * another request already made, or by one this request starts.
   */
  private async renew(token: string): Promise<void> {
    if (this.auth !== token) return;
    await this.refresh();
  }

  private async json<T>(
    method: string,
    path: string,
    body?: unknown,
    raw?: Uint8Array,
    contentType?: string,
  ): Promise<T> {
    const response = await this.send(method, path, body, raw, contentType);
    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  /**
   * {@link json} for a call or a view (D70): while the node answers 503 or
   * cannot be reached, the same request, with the same idempotency key, is sent
   * again after {@link retryDelayMs} (or the pause the node asked for, if
   * longer), at most `retries` times. Every other answer is final.
   *
   * When a node's retries run out, the request fails over to the next node the
   * client knows and its retries start again there, with the same key: the
   * key is kept in the app's replicated log, so the cluster answers it once
   * whichever node it reaches. Each node is tried once per request. The last
   * failure surfaces as {@link UnavailableError}: the node's 503, or reason
   * `network` for a connection that failed, whose `committed` is `'unknown'`.
   *
   * `once` sends the request exactly once, to the node in use (the confirmed
   * attempt of {@link callConfirmed}, whose challenge is single-use).
   */
  private async retried<T>(method: string, path: string, body: Record<string, unknown>, once = false): Promise<T> {
    const retries = once ? 0 : this.retry.retries;
    const tried = new Set<string>();
    for (;;) {
      let unavailable: UnavailableError | undefined;
      let node = this.nodeUrl;
      for (let attempt = 0; ; attempt++) {
        node = this.nodeUrl;
        tried.add(node);
        try {
          return await this.json<T>(method, path, body);
        } catch (error) {
          if (error instanceof UnavailableError) unavailable = error;
          else if (error instanceof TypeError && this.networkFailures.has(error)) {
            unavailable = new UnavailableError('NETWORK', `the node could not be reached: ${error.message}`, {}, undefined, error);
          } else throw error;
        }
        if (attempt >= retries) break;
        const backoff = retryDelayMs(attempt, this.retry);
        await new Promise((resolve) => setTimeout(resolve, Math.max(backoff, (unavailable.retryAfter ?? 0) * 1000)));
      }
      if (once || !this.failOver(node, tried)) throw unavailable;
    }
  }

  post<T = Record<string, unknown>>(path: string, body: unknown = {}): Promise<T> {
    return this.json<T>('POST', path, body);
  }

  get<T = Record<string, unknown>>(path: string): Promise<T> {
    return this.json<T>('GET', path);
  }

  put<T = Record<string, unknown>>(path: string, body: unknown = {}): Promise<T> {
    return this.json<T>('PUT', path, body);
  }

  delete<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
    return this.json<T>('DELETE', path, body);
  }

  // ---------------------------------------------------------------- identity

  /** Create an account with a new passkey, and sign in. */
  async signUp(passkey: PasskeyProvider, name: string): Promise<CalimeroSession> {
    const begin = await this.post<{ challengeId: string; options: Record<string, unknown> }>(
      'auth/passkey/register/begin',
      { name },
    );
    const registration = await passkey.create(begin.options);
    const session = await this.post<CalimeroSession>('auth/passkey/register/finish', {
      challengeId: begin.challengeId,
      registration,
    });
    this.useSession(session);
    return session;
  }

  /** Sign in with an existing passkey. */
  async signIn(passkey: PasskeyProvider): Promise<CalimeroSession> {
    const begin = await this.post<{ challengeId: string; options: { challenge: string; rpId: string } }>(
      'auth/passkey/login/begin',
    );
    const assertion = await passkey.get(fromB64url(begin.options.challenge), begin.options.rpId);
    const session = await this.post<CalimeroSession>('auth/passkey/login/finish', {
      challengeId: begin.challengeId,
      assertion,
    });
    this.useSession(session);
    return session;
  }

  /**
   * Swap the refresh token for a new session, on whichever node the client
   * uses: any node of the cluster takes it. A refresh token is used once, so
   * calls made while one refresh is under way share it rather than sending the
   * same token again (which would revoke the session).
   */
  refresh(): Promise<CalimeroSession> {
    if (!this.refreshing) {
      const pending = this.exchangeRefresh();
      this.refreshing = pending;
      const clear = () => {
        if (this.refreshing === pending) this.refreshing = undefined;
      };
      pending.then(clear, clear);
    }
    return this.refreshing;
  }

  private async exchangeRefresh(): Promise<CalimeroSession> {
    const current = this.current;
    if (!current) throw new Error('no session to refresh');
    let session: CalimeroSession | undefined;
    // A node that may not serve the account answers `421 WRONG_NODE` before it
    // spends the refresh token (core #4774), so the same token goes to the next
    // node (`send` moved there already): once per node, at most.
    for (let tried = 1; session === undefined; tried++) {
      try {
        session = await this.post<CalimeroSession>('auth/refresh', { refreshToken: current.refreshToken });
      } catch (error) {
        if (!(error instanceof WrongNode) || tried >= this.nodeUrls.length) throw error;
      }
    }
    // A sign-in or another session taken while this one was refreshing wins.
    if (this.current === current) this.useSession(session);
    return session;
  }

  async signOut(): Promise<void> {
    await this.post('auth/logout');
    this.auth = undefined;
    this.current = undefined;
  }

  /** End every session of the signed-in account, on every device, this one too. */
  async signOutEverywhere(): Promise<void> {
    await this.post('auth/logout-all');
    this.auth = undefined;
    this.current = undefined;
  }

  me(): Promise<Record<string, unknown>> {
    return this.get('auth/me');
  }

  /** Add another passkey (another device) to the signed-in account; answers its credential id. */
  async addPasskey(passkey: PasskeyProvider): Promise<string> {
    const begin = await this.post<{ challengeId: string; options: Record<string, unknown> }>('auth/passkeys/add/begin');
    const registration = await passkey.create(begin.options);
    const { credentialId } = await this.post<{ credentialId: string }>('auth/passkeys/add/finish', {
      challengeId: begin.challengeId,
      registration,
    });
    return credentialId;
  }

  /** Remove one of the account's passkeys (not the last). */
  async removePasskey(credentialId: string): Promise<void> {
    await this.delete(`auth/passkeys/${seg(credentialId)}`);
  }

  /** Name one of the account's passkeys (a device label); `''` clears the name. */
  async labelPasskey(credentialId: string, label: string): Promise<void> {
    await this.post(`auth/passkeys/${seg(credentialId)}`, { label });
  }

  /** What this account uses (apps, bundle bytes, API keys, owned orgs), with the cluster's quotas. */
  usage(): Promise<Record<string, unknown>> {
    return this.get('auth/usage');
  }

  /**
   * The node's attestation document, unverified: for display only. Every
   * request this client sends is sealed to a key it verified itself first.
   */
  async attestation(): Promise<AttestationDoc> {
    const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const response = await this.raw(`${this.nodeUrl}/attestation?nonce=${nonce}`);
    if (!response.ok) throw await refusal(response);
    return (await response.json()) as AttestationDoc;
  }

  /** The account's API keys (never the keys themselves). */
  async listApiKeys(): Promise<Array<Record<string, unknown>>> {
    const { keys } = await this.get<{ keys: Array<Record<string, unknown>> }>('auth/apikeys');
    return keys;
  }

  async revokeApiKey(keyId: string): Promise<void> {
    await this.delete(`auth/apikeys/${seg(keyId)}`);
  }

  /** Create an API key for an agent or server. The key is returned once. */
  createApiKey(options: {
    label?: string;
    apps?: string[];
    methods?: string[];
    readOnly?: boolean;
    allowConfirm?: boolean;
    ttlSecs?: number;
  }): Promise<{ keyId: string; key: string }> {
    return this.post('auth/apikeys', options);
  }

  // ---------------------------------------------------------------- apps

  /** Upload a raw WASM bundle (development clusters only); answers its hash. */
  async uploadBundle(wasm: Uint8Array): Promise<string> {
    const { hash } = await this.json<{ hash: string }>('POST', 'bundles', undefined, wasm);
    return hash;
  }

  /** Upload a blob for `app`: `blobId` is base58 (what apps print), `id` hex. */
  uploadBlob(app: string, data: Uint8Array): Promise<{ blobId: string; id: string; size: number }> {
    return this.json('POST', `apps/${seg(app)}/blobs`, undefined, data);
  }

  /** One of `app`'s blobs, by id (base58 or hex). */
  async downloadBlob(app: string, id: string): Promise<Uint8Array> {
    const response = await this.send('GET', `apps/${seg(app)}/blobs/${seg(id)}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  /** `app`'s blobs. */
  async listBlobs(app: string): Promise<BlobInfo[]> {
    const { blobs } = await this.get<{ blobs: BlobInfo[] }>(`apps/${seg(app)}/blobs`);
    return blobs;
  }

  /** One of `app`'s blobs' id and size; `NotFound` if the app has no such blob. */
  blobInfo(app: string, id: string): Promise<BlobInfo> {
    return this.get(`apps/${seg(app)}/blobs/${seg(id)}/info`);
  }

  /** Delete one of `app`'s blobs (its owner, or an admin of its organization). */
  async deleteBlob(app: string, id: string): Promise<void> {
    await this.delete(`apps/${seg(app)}/blobs/${seg(id)}`);
  }

  // ---------------------------------------------------------------- packages

  /** Install a signed `.mpk` package file. */
  uploadPackage(mpk: Uint8Array): Promise<PackageInstalled> {
    return this.json('POST', 'packages', undefined, mpk, 'application/octet-stream');
  }

  /** Install `package@version` from the cluster's registry; every node that runs it verifies it. */
  installPackage(pkg: string, version: string): Promise<PackageInstalled> {
    return this.post('packages/install', { package: pkg, version });
  }

  /** Installed packages and their versions. */
  async packages(): Promise<PackageInfo[]> {
    const { packages } = await this.get<{ packages: PackageInfo[] }>('packages');
    return packages;
  }

  /** One installed package and its versions. */
  package(pkg: string): Promise<PackageInfo> {
    return this.get(`packages/${seg(pkg)}`);
  }

  /** Uninstall one version, or the whole package. Refused while an app runs it. */
  uninstallPackage(pkg: string, version?: string): Promise<Record<string, unknown>> {
    return this.delete(version === undefined ? `packages/${seg(pkg)}` : `packages/${seg(pkg)}/${seg(version)}`);
  }

  // ---------------------------------------------------------------- app instances

  /** Apps this caller reaches, optionally only those of one package or bundle. */
  async listApps(filter: { package?: string; bundle?: string } = {}): Promise<AppInfo[]> {
    const q = new URLSearchParams();
    if (filter.package) q.set('package', filter.package);
    if (filter.bundle) q.set('bundle', filter.bundle);
    const query = q.toString();
    const { apps } = await this.get<{ apps: AppInfo[] }>(query ? `apps?${query}` : 'apps');
    return apps;
  }

  getApp(app: string): Promise<Record<string, unknown>> {
    return this.get(`apps/${seg(app)}`);
  }

  /** Delete an app instance (its owner, or an admin of its organization). */
  async deleteApp(app: string): Promise<void> {
    await this.delete(`apps/${seg(app)}`);
  }

  /** Who may reach the app: `{ kind: 'owner' | 'org' | 'public' | 'accounts' | 'team', ... }`. */
  async setAccess(app: string, access: Record<string, unknown>): Promise<void> {
    await this.post(`apps/${seg(app)}/access`, { access });
  }

  /** Set the app instance's metadata (its owner, or an admin of its organization); at most 16 KiB. */
  async setAppMetadata(app: string, metadata: unknown): Promise<void> {
    await this.post(`apps/${seg(app)}/metadata`, { metadata });
  }

  /** What the app's storage holds: `{ keys, bytes, blobs, blobBytes }`. */
  appStorage(app: string): Promise<Record<string, unknown>> {
    return this.get(`apps/${seg(app)}/storage`);
  }

  /** The ABI the app's bundle embeds: `{ bundle, abi }`. */
  appAbi(app: string): Promise<Record<string, unknown>> {
    return this.get(`apps/${seg(app)}/abi`);
  }

  /**
   * Hand the app to another account (an organization's app only to one of its
   * members). The owner approves with `passkey`.
   */
  async transferApp(app: string, to: string, passkey: PasskeyProvider): Promise<void> {
    await this.postConfirmed(`apps/${seg(app)}/transfer`, { to }, passkey);
  }

  /**
   * Move an app to another release of its package (`{ version }`), another
   * package, or a bundle hash, running its migration. Answers the upgrade's
   * entry; a failed migration rejects with code `UPGRADE_FAILED` (422).
   * Where owners hold app upgrades, the node asks for the approval of
   * whoever the package's manifest names (`412 CONFIRM_REQUIRED`), which
   * `passkey` gives. Refused (`403`) to a session opened on an app's
   * frontend: an app asks its user with {@link requestConsent} instead. Past
   * a release deadline its approver has not met: {@link ReleaseDeadlineError}.
   */
  upgradeApp(
    app: string,
    target: { version?: string; package?: string; service?: string; bundle?: string; migrate?: string },
    passkey?: PasskeyProvider,
  ): Promise<{ index: number; status: string; error: unknown }> {
    const path = `apps/${seg(app)}/upgrade`;
    return passkey ? this.postConfirmed(path, target, passkey) : this.post(path, target);
  }

  /**
   * POST `body` to `path`, answering a `412 CONFIRM_REQUIRED` with `passkey`'s
   * assertion over the node's challenge (deleting an org, approving a release, ...).
   */
  postConfirmed<T>(path: string, body: Record<string, unknown>, passkey: PasskeyProvider): Promise<T> {
    return this.confirmed<T>('POST', path, body, passkey);
  }

  /** {@link postConfirmed} for a DELETE (deleting an organization). */
  deleteConfirmed<T>(path: string, passkey: PasskeyProvider, body: Record<string, unknown> = {}): Promise<T> {
    return this.confirmed<T>('DELETE', path, body, passkey);
  }

  private async confirmed<T>(
    method: 'POST' | 'DELETE',
    path: string,
    body: Record<string, unknown>,
    passkey: PasskeyProvider,
    send: (body: Record<string, unknown>) => Promise<T> = (b) => this.json<T>(method, path, b),
  ): Promise<T> {
    try {
      return await send(body);
    } catch (error) {
      if (!(error instanceof ConfirmRequired)) throw error;
      const d = error.details as { challengeId: string; challenge: string; rpId: string; allowCredentials?: string[] };
      let assertion: Awaited<ReturnType<PasskeyProvider['get']>>;
      try {
        assertion = await passkey.get(fromB64url(d.challenge), d.rpId, d.allowCredentials);
      } catch (declined) {
        // WebAuthn rejects a prompt the user dismissed with `NotAllowedError`
        // (`AbortError` when it was aborted); anything else is a real failure.
        const name = (declined as { name?: unknown } | null)?.name;
        if (name === 'NotAllowedError' || name === 'AbortError') throw new ConfirmCancelled(declined);
        throw declined;
      }
      return send({ ...body, confirm: { challengeId: d.challengeId, assertion } });
    }
  }

  /**
   * Create an app instance from a bundle hash, or from a package release
   * (`{ package, version?, service? }`, installed from the registry first if
   * the cluster lacks it).
   */
  async createApp(
    name: string,
    bundle: string | { package: string; version?: string; service?: string },
    options: {
      org?: string;
      access?: Record<string, unknown>;
      confirmMethods?: string[];
      /** Arguments for the app's `init`. A failed init rejects with code `INIT_FAILED`. */
      initArgs?: unknown;
    } = {},
  ): Promise<string> {
    const target = typeof bundle === 'string' ? { bundle } : bundle;
    const { appId } = await this.post<{ appId: string }>('apps', { name, ...target, ...options });
    return appId;
  }

  /**
   * Call a method. A retry with the same `idempotencyKey` is answered once.
   * Without one, the client makes one, so its own retries of a 503 share it.
   */
  call(app: string, method: string, args: unknown = {}, idempotencyKey?: string): Promise<CallResult> {
    const key = idempotencyKey ?? newIdempotencyKey();
    return this.retried('POST', `apps/${seg(app)}/intents`, { method, args, idempotencyKey: key });
  }

  /**
   * Call a method that needs the account holder's approval: the node returns a
   * challenge over this exact call, which `passkey` signs. A declined prompt
   * rejects with {@link ConfirmCancelled}.
   */
  async callConfirmed(
    app: string,
    method: string,
    args: unknown,
    passkey: PasskeyProvider,
    idempotencyKey?: string,
  ): Promise<CallResult> {
    const path = `apps/${seg(app)}/intents`;
    const key = idempotencyKey ?? newIdempotencyKey();
    // The confirmed attempt goes out exactly once: its challenge is single-use,
    // so a resend would be refused on the challenge, not answered from the key.
    return this.confirmed<CallResult>('POST', path, { method, args, idempotencyKey: key }, passkey, (body) =>
      this.retried<CallResult>('POST', path, body, body.confirm !== undefined),
    );
  }

  /** Run a read-only method: strong by default, or stale from any replica. */
  view(app: string, method: string, args: unknown = {}, options: { stale?: boolean; minIndex?: number } = {}): Promise<ViewResult> {
    return this.retried('POST', `apps/${seg(app)}/views`, {
      method,
      args,
      consistency: options.stale ? 'stale' : 'strong',
      minIndex: options.minIndex ?? 0,
    });
  }

  /** Committed events from index `from`, then live, until `signal` aborts. */
  events(app: string, from = 0, signal?: AbortSignal): AsyncGenerator<CloudEvent> {
    return this.stream(`apps/${seg(app)}/events?from=${from}`, signal);
  }

  /** A server-sent event stream on `path`, sealed like every other answer. */
  private async *stream(path: string, signal?: AbortSignal): AsyncGenerator<CloudEvent> {
    const response = await this.send('GET', path, undefined, undefined, undefined, signal);
    if (!response.body) throw new CalimeroError(response.status, 'EVENTS', 'the event stream has no body');
    yield* sseFrames(response.body);
  }

  // ---------------------------------------------------------------- presence

  /**
   * Publish this device's presence in `app`: `state` (at most 4 KiB) or `null`
   * to retract it. The newest `seq` wins; send the same `seq` and state again
   * as a heartbeat, since an entry not refreshed within 7 s is gone.
   */
  async publishPresence(app: string, seq: number, state: Uint8Array | null): Promise<void> {
    await this.post(`apps/${seg(app)}/presence`, { seq, state: state === null ? null : toHex(state) });
  }

  /** Who is present in `app` now. */
  async presence(app: string): Promise<PresenceEntry[]> {
    const { present } = await this.get<{ present: PresenceEntry[] }>(`apps/${seg(app)}/presence`);
    return present;
  }

  /**
   * Presence as a stream until `signal` aborts: a `snapshot` event (`data` the
   * entries present), then a `presence` event (`data` one entry) per change.
   */
  presenceStream(app: string, signal?: AbortSignal): AsyncGenerator<CloudEvent> {
    return this.stream(`apps/${seg(app)}/presence/stream`, signal);
  }

  // ---------------------------------------------------------------- aliases

  /** Name an app (its id or context id) for this account. */
  async setAlias(alias: string, app: string): Promise<void> {
    await this.put(`auth/aliases/${seg(alias)}`, { app });
  }

  /** This account's aliases, alias → app id. */
  async aliases(): Promise<Record<string, string>> {
    const { aliases } = await this.get<{ aliases: Record<string, string> }>('auth/aliases');
    return aliases;
  }

  /** The app an alias names. */
  async alias(alias: string): Promise<string> {
    const { appId } = await this.get<{ appId: string }>(`auth/aliases/${seg(alias)}`);
    return appId;
  }

  async deleteAlias(alias: string): Promise<void> {
    await this.delete(`auth/aliases/${seg(alias)}`);
  }

  // ---------------------------------------------------------------- organizations

  async createOrg(name: string): Promise<string> {
    const { orgId } = await this.post<{ orgId: string }>('orgs', { name });
    return orgId;
  }

  /** The organization, with the teams this caller reaches or manages. */
  getOrg(org: string): Promise<OrgInfo> {
    return this.get(`orgs/${seg(org)}`);
  }

  /**
   * Delete an organization with its teams, invites and apps (its owner only).
   * The node asks for the owner's passkey (`412 CONFIRM_REQUIRED`), which `passkey` gives.
   */
  async deleteOrg(org: string, passkey: PasskeyProvider): Promise<void> {
    await this.deleteConfirmed(`orgs/${seg(org)}`, passkey);
  }

  /** Set the organization's metadata (an admin, or a holder of `MANAGE_METADATA`); at most 16 KiB. */
  async setOrgMetadata(org: string, metadata: unknown): Promise<void> {
    await this.post(`orgs/${seg(org)}/metadata`, { metadata });
  }

  /** Set a member's metadata (theirs, or an admin's); `null` clears it. */
  async setMemberMetadata(org: string, account: string, metadata: unknown): Promise<void> {
    await this.post(`orgs/${seg(org)}/members/${seg(account)}/metadata`, { metadata });
  }

  /**
   * Upgrade every app of `org` that runs `target.package` to `target.version`
   * (optionally one team's, with `cascade` the teams below it). The org's owner,
   * or a holder of `MANAGE_APPLICATION`, approves the whole run with `passkey`.
   * Answers the run; {@link upgradeRun} follows it.
   */
  upgradeOrg(org: string, target: OrgUpgradeTarget, passkey: PasskeyProvider): Promise<UpgradeRun> {
    return this.postConfirmed(`orgs/${seg(org)}/upgrade`, { ...target }, passkey);
  }

  /** An organization-wide upgrade run: its apps, those done and those that failed. */
  upgradeRun(org: string, run: string): Promise<UpgradeRun> {
    return this.get(`orgs/${seg(org)}/upgrades/${seg(run)}`);
  }

  /** Run the apps that failed in `run` again, as a new run, approved with `passkey`. */
  retryUpgradeRun(org: string, run: string, passkey: PasskeyProvider): Promise<UpgradeRun> {
    return this.postConfirmed(`orgs/${seg(org)}/upgrades/${seg(run)}/retry`, {}, passkey);
  }

  /**
   * Approve a mero-tee release to hold the apps of `org`, or of this account
   * outside any organization (`org` `null`); `approved: false` withdraws it.
   * Until then, nodes on that release get none of those apps' data. For an
   * organization, a member holding `APPROVE_RELEASES` approves with `passkey`;
   * the node binds the release's measurements itself. Refused (`403`) to a
   * session opened on an app's frontend: an app asks its user with
   * {@link requestConsent} instead.
   */
  async approveRelease(
    org: string | null,
    version: string,
    passkey: PasskeyProvider,
    approved = true,
  ): Promise<Record<string, unknown>> {
    const path = org === null ? 'auth/releases' : `orgs/${seg(org)}/releases`;
    return this.postConfirmed(path, { version, approved }, passkey);
  }

  /**
   * Approve the URL prefixes apps from `pkg`'s publisher may call out to, for
   * `org`'s apps or this account's own (`org` `null`). `prefixes` `'manifest'`
   * (the default) approves every prefix the package's latest release declares;
   * `replace` sets exactly `prefixes`, which is how one is revoked. Approved
   * with `passkey`. Refused (`403`) to a session opened on an app's frontend:
   * an app asks with {@link requestConsent} (`kind: 'outbound'`) instead.
   */
  async approveOutbound(
    org: string | null,
    pkg: string,
    passkey: PasskeyProvider,
    options: { prefixes?: string[] | 'manifest'; replace?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    const path = org === null ? 'auth/outbound' : `orgs/${seg(org)}/outbound`;
    return this.postConfirmed(
      path,
      { package: pkg, prefixes: options.prefixes ?? 'manifest', replace: options.replace ?? false },
      passkey,
    );
  }

  // ---------------------------------------------------------------- approvals

  /**
   * One page of the report of a scope's apps: an organization's (any member;
   * `404` to anyone else) or, with `org` `null`, the account's own outside any
   * organization (a session bound to an app's frontend: that package's apps).
   * The governance, the scope's approved releases, the releases the cluster's
   * nodes run and whether each is approved, and per app its release, newer
   * releases it may move to, last upgrade and replicas.
   */
  appsReport(org: string | null, page: PageOptions = {}): Promise<AppsReport> {
    const path = org === null ? 'auth/apps' : `orgs/${seg(org)}/apps`;
    return this.get(`${path}${pageQuery(page)}`);
  }

  /** {@link appsReport}, every page, with the apps of all of them in `apps`. */
  async appsReportAll(org: string | null): Promise<AppsReport> {
    const first = await this.appsReport(org);
    const apps: ReportedApp[] = [...first.apps];
    let next = first.next;
    while (next !== null) {
      const page = await this.appsReport(org, { after: next });
      apps.push(...page.apps);
      next = page.next;
    }
    return { ...first, apps, next: null };
  }

  /** `GET /releases`: the cluster's governance and every release deadline. Public. */
  releaseRules(): Promise<ReleaseRules> {
    return this.get('releases');
  }

  /**
   * What waits for a decision in a scope (`org`, or the account's own apps
   * with `null`): mero-tee releases the cluster's nodes run that the scope has
   * not approved, apps with newer releases of their package, and whether a
   * passed deadline stops new work. Read over the sealed channel; act on an
   * item by sending the user to the consent page ({@link requestConsent},
   * `releaseConsent`, `upgradeConsent`).
   */
  async pendingApprovals(org: string | null = null): Promise<PendingApprovals> {
    const [report, rules] = await Promise.all([this.appsReportAll(org), this.releaseRules()]);
    return pendingApprovalsFrom(report, rules);
  }

  /**
   * Ask the node to ask the user: a release, upgrade or outbound approval
   * that only the account holder may make, decided on the node's own consent
   * page, never in the app. Needs a passkey session (a session bound to the
   * app's frontend is fine). Send the person to the answer's `url`; the page
   * sends them back to `returnTo?request_id=…&result=approved|declined`
   * (`consentReturn`), and {@link consentResult} confirms the decision.
   */
  requestConsent(request: ConsentRequest): Promise<ConsentStarted> {
    return this.post('consent/requests', request);
  }

  /**
   * {@link requestConsent}, then send the browser to the consent page
   * (`navigate`, by default `window.location.assign`). Pass `navigate` itself
   * or {@link OpenConsentOptions}, whose `confirm` runs first with the node's
   * answer so the app can show the person its `code`; when it answers `false`
   * the page is not opened. When the node sends a `code` that is not
   * {@link confirmationCode} of `requestId`, it throws `CalimeroError`
   * (`CONSENT_CODE_MISMATCH`) and does not navigate. Answers the request
   * once `navigate` returns (or `confirm` declines): with a popup
   * (`url => window.open(url)`), poll it with {@link waitForConsent}.
   */
  async openConsentPage(
    request: ConsentRequest,
    navigateOrOptions: ((url: string) => void) | OpenConsentOptions = {},
  ): Promise<ConsentStarted> {
    const options = typeof navigateOrOptions === 'function' ? { navigate: navigateOrOptions } : navigateOrOptions;
    const navigate =
      options.navigate ??
      ((url: string) => {
        const w = (globalThis as { window?: { location: { assign(url: string): void } } }).window;
        if (!w) throw new Error('no window to open the consent page in; pass `navigate`');
        w.location.assign(url);
      });
    const started = await this.requestConsent(request);
    if (started.code !== undefined) {
      const expected = await confirmationCode(started.requestId);
      if (started.code !== expected) {
        throw new CalimeroError(200, 'CONSENT_CODE_MISMATCH', 'the consent page code does not match the request', {
          requestId: started.requestId,
          code: started.code,
          expected,
        });
      }
    }
    if (options.confirm && !(await options.confirm(started))) return started;
    navigate(started.url);
    return started;
  }

  /** The decision on a consent request (any node answers, for the account that asked). */
  consentResult(requestId: string): Promise<ConsentResult> {
    return this.get(`consent/${seg(requestId)}/result`);
  }

  /**
   * Poll {@link consentResult} until the request is decided, every
   * `intervalMs` (2 s), until `signal` aborts or `expiresAt` (Unix seconds)
   * passes, when it answers the last `pending` result.
   */
  async waitForConsent(
    requestId: string,
    options: { intervalMs?: number; signal?: AbortSignal; expiresAt?: number } = {},
  ): Promise<ConsentResult> {
    const interval = options.intervalMs ?? 2000;
    for (;;) {
      const result = await this.consentResult(requestId);
      if (result.status !== 'pending') return result;
      if (options.signal?.aborted) return result;
      if (options.expiresAt !== undefined && Date.now() / 1000 >= options.expiresAt) return result;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  /** `GET /publishers/{signerId}`: the cluster name and binding generation a key signs to bind it next. */
  publisherBinding(signerId: string): Promise<PublisherBindingInfo> {
    return this.get(`publishers/${seg(signerId)}`);
  }

  /**
   * Bind a package signing key to `org`, which then approves the node images
   * every instance of the key's packages runs on, and upgrades those whose
   * package declares `upgrades: publisher`. `proof` is the key's signature
   * over `publisherBindingMessage(cluster, org, signerId, generation)`; a
   * member holding `APPROVE_RELEASES` sends it with `passkey`.
   */
  bindPublisher(org: string, proof: PublisherProof, passkey: PasskeyProvider): Promise<Record<string, unknown>> {
    return this.postConfirmed(`orgs/${seg(org)}/publishers`, { ...proof }, passkey);
  }

  /**
   * Upgrade every instance of `pkg` whose release declares `upgrades:
   * publisher`, whoever owns it, as its publisher `org` (a
   * `MANAGE_APPLICATION` holder there), with one passkey approval. Answers
   * the run, kept on the publisher.
   */
  upgradePublished(
    org: string,
    pkg: string,
    target: { version: string; migrate?: string },
    passkey: PasskeyProvider,
  ): Promise<UpgradeRun> {
    return this.postConfirmed(`orgs/${seg(org)}/packages/${seg(pkg)}/upgrade`, { ...target }, passkey);
  }

  // ---------------------------------------------------------------- operator

  /** `GET /ops/apps`: what every app runs, without names or accounts. Operator token (`useApiKey`). */
  opsApps(page: PageOptions = {}): Promise<OpsAppsReport> {
    return this.get(`ops/apps${pageQuery(page)}`);
  }

  /** `GET /ops/orgs`: each organization's approved releases. Operator token. */
  opsOrgs(page: PageOptions = {}): Promise<OpsOrgsReport> {
    return this.get(`ops/orgs${pageQuery(page)}`);
  }

  /**
   * Announce when work on images older than `version` ends: from `after` on,
   * a scope that has not approved it (or newer) starts no new work. Operator
   * token.
   */
  async setReleaseDeadline(version: string, after: Date | string): Promise<void> {
    const at = typeof after === 'string' ? after : after.toISOString();
    await this.post(`ops/releases/${seg(version)}/deadline`, { after: at });
  }

  /** Lift a release's deadline. Operator token. */
  async liftReleaseDeadline(version: string): Promise<void> {
    await this.delete(`ops/releases/${seg(version)}/deadline`);
  }

  /** Add a member, or change their role. */
  async setMember(org: string, account: string, role: 'guest' | 'member' | 'admin' | 'owner'): Promise<void> {
    await this.post(`orgs/${seg(org)}/members`, { account, role });
  }

  removeMember(org: string, account: string): Promise<Record<string, unknown>> {
    return this.delete(`orgs/${seg(org)}/members/${seg(account)}`);
  }

  /**
   * Set capability bits ({@link ORG_CAPABILITIES}): for a member (`account`),
   * for a member of one team (`account` and `team`), or the organization's
   * default (neither).
   */
  async setCapabilities(org: string, capabilities: number, at: { account?: string; team?: string } = {}): Promise<void> {
    await this.post(`orgs/${seg(org)}/capabilities`, { capabilities, ...at });
  }

  async createTeam(org: string, name: string, join: 'everyone' | 'invite', parent?: string): Promise<string> {
    const { teamId } = await this.post<{ teamId: string }>(`orgs/${seg(org)}/teams`, { name, join, parent });
    return teamId;
  }

  getTeam(org: string, team: string): Promise<Record<string, unknown>> {
    return this.get(`orgs/${seg(org)}/teams/${seg(team)}`);
  }

  /**
   * Rename, change who may join, set the app's metadata, or move the team:
   * `parent: null` moves it to the top, an absent `parent` leaves it.
   */
  async updateTeam(
    org: string,
    team: string,
    update: { name?: string; join?: 'everyone' | 'invite'; parent?: string | null; metadata?: unknown },
  ): Promise<void> {
    await this.post(`orgs/${seg(org)}/teams/${seg(team)}`, update);
  }

  /** Delete a team, the teams below it and their apps. */
  async deleteTeam(org: string, team: string): Promise<void> {
    await this.delete(`orgs/${seg(org)}/teams/${seg(team)}`);
  }

  /** Add a member to a team, or change their row: role, lead, capability bits. */
  async setTeamMember(
    org: string,
    team: string,
    account: string,
    row: { role?: 'lead' | 'member' | 'readOnly'; lead?: boolean; capabilities?: number } = {},
  ): Promise<void> {
    await this.post(`orgs/${seg(org)}/teams/${seg(team)}/members`, { account, ...row });
  }

  async removeTeamMember(org: string, team: string, account: string): Promise<void> {
    await this.delete(`orgs/${seg(org)}/teams/${seg(team)}/members/${seg(account)}`);
  }

  async invite(
    org: string,
    role: 'guest' | 'member' | 'admin',
    teams: string[] = [],
    options: { ttlSecs?: number; uses?: number } = {},
  ): Promise<string> {
    const { token } = await this.post<{ token: string }>(`orgs/${seg(org)}/invites`, { role, teams, ...options });
    return token;
  }

  redeemInvite(token: string): Promise<Record<string, unknown>> {
    return this.post(`invites/${seg(token)}/redeem`);
  }
}
