/**
 * Reading from the relay — because a relay is a node.
 *
 * # What was wrong with "a relay-transport client cannot observe"
 *
 * The first version of this transport reported `canSubscribe === false` for
 * every relay, on the reasoning that a relay serves only `GET`/`POST
 * /admin-api/contexts/:id/intents`. That is true of the *unauthenticated*
 * surface, and it is the wrong conclusion: a relay is an ordinary node that
 * happens to also run intents for other people. The same origin serves
 * `/auth/challenge`, `/auth/token`, `/sse` and `/ws`, and a keyholder holding
 * an `AccountProof<DeviceCert>` can log in to it with {@link login} — the
 * `account_proof` provider grants exactly `context:intent`, `context:query`,
 * `context:subscribe`. Subscribe is in the provider's own default grant, not
 * something extra that has to be asked for, and a delegated write on such a
 * session was observed arriving as a `StateMutation` frame whose `newRoot`
 * matched the write's `rootHash`.
 *
 * So the gap was never "a relay cannot be observed". It is exactly one missing
 * input.
 *
 * # The one missing input, and why it is not filled in from somewhere
 *
 * {@link login} requires the node's device signing key as a *separately
 * supplied* parameter. It is not read out of the challenge response on purpose:
 * a value learned from the party you are about to authenticate to lets whoever
 * answered choose what your device signs a statement about. That is the whole
 * attack the parameter exists to stop.
 *
 * For a self-hosted relay the operator can hand the key over out of band, and
 * this module works today. For a cloud-hosted relay, `CloudRelay` carries
 * `peerId`, `relayUrl`, `executorAccount`, `status` and `authorshipReady` —
 * and no node key. `peerId` is a libp2p identity and is **not** a substitute:
 * signing a statement about a libp2p peer id would be signing about a different
 * key than the one the node authenticates with. That is filed upstream as mdma
 * #312; until it lands, the hosted case has no key and reports
 * `canSubscribe === false` rather than pretending.
 *
 * Nothing here invents a key, and nothing here falls back to "some other node".
 */

import { SseClient } from '../events/sse.js';
import { WsClient } from '../events/ws.js';
import { login, type Audience, type DelegatedSession } from '../login/index.js';
import type { Signer } from '../signer/signer.js';

/** Re-login this long before the access token expires, so a reconnect is not racing it. */
const EXPIRY_SKEW_MS = 30_000;

/**
 * How a relay-transport client observes the relay node.
 *
 * Every field but {@link RelayObserveConfig.nodeKey} has a correct default
 * taken from the `RelayClient` already configured — the author's proof, its
 * signer and the relay's own URL are the same values a login needs, and asking
 * for a second copy is how two copies come to disagree.
 */
export interface RelayObserveConfig {
  /**
   * The relay node's ed25519 device signing key, hex (32 bytes), **as this
   * client pinned it**.
   *
   * Learn it out of band: from the operator of a self-hosted relay, or from a
   * certificate you already trust. Never from the node itself — see the module
   * note.
   *
   * `null` / `undefined` is a first-class answer meaning "nobody told me", and
   * it is what the hosted path passes today (mdma #312). It makes
   * `canSubscribe` false; it never makes the client guess.
   */
  nodeKey?: string | null;
  /**
   * The client surface the session is bound to.
   *
   * Defaults to this runtime's honest self-description: the browser's own
   * `location.origin`, or `{ kind: 'cli' }` where there is no browser. Passing
   * something else is for a client that knows better — a signed native app
   * naming its code-signing identity, say. A wrong audience fails the login
   * loudly rather than quietly widening anything.
   */
  audience?: Audience;
  /** The node to log in to. Defaults to the relay's own URL — they are the same node. */
  nodeUrl?: string;
  /** The author's `AccountProof<DeviceCert>`, hex. Defaults to the relay client's. */
  accountProof?: string;
  /** The device signer. Defaults to the relay client's — the same device authors and observes. */
  signer?: Signer;
  /** How this client names itself to the node. Defaults to the audience's own spelling. */
  clientName?: string;
  /** Seconds the login statement stays valid. Defaults to `login`'s own default. */
  ttlSeconds?: number;
  /** Injected for tests and non-browser runtimes. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** What {@link RelayObserver} needs once the defaults have been resolved. */
export interface ResolvedObserveConfig {
  nodeUrl: string;
  nodeKey: string;
  accountProof: string;
  audience: Audience;
  signer: () => Promise<Signer>;
  clientName?: string;
  ttlSeconds?: number;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * This runtime's honest self-description, used when no audience is given.
 *
 * The origin is taken verbatim from the browser rather than normalized: the
 * node compares it byte for byte, and two spellings of one origin would mean a
 * client that disagrees with itself about which surface a token was for.
 */
export function defaultAudience(): Audience {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
  return origin ? { kind: 'webOrigin', origin } : { kind: 'cli' };
}

/**
 * Milliseconds-since-epoch at which a JWT expires, or `null` if unreadable.
 *
 * Deliberately `null` rather than a fallback guess. `mero-js.ts` has a similar
 * helper that substitutes "an hour from now" when it cannot read `exp`, which
 * is right for a token bundle that will be refreshed reactively on a 401 and
 * wrong here: an unreadable lifetime must mean "mint a fresh session", not
 * "assume an hour and let a dead token take the stream down".
 */
function jwtExpiryMs(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const payload = JSON.parse(atob(b64)) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * A node session over the relay, and the event clients it feeds.
 *
 * The session is minted lazily, on the first thing that actually needs a token.
 * That is not an optimization: `client.events` is a *getter*, so constructing a
 * client would otherwise have to perform two HTTP calls and a signature before
 * anyone had asked to observe anything.
 */
export class RelayObserver {
  private readonly config: ResolvedObserveConfig;
  private session: DelegatedSession | null = null;
  private sessionExpiresAt: number | null = null;
  /** In-flight login, so two surfaces asking at once mint one session, not two. */
  private pending: Promise<DelegatedSession> | null = null;
  private sseClient: SseClient | null = null;
  private wsClient: WsClient | null = null;

  constructor(config: ResolvedObserveConfig) {
    this.config = config;
  }

  /** The node key this observer logs in with. Read for diagnostics. */
  get nodeKey(): string {
    return this.config.nodeKey;
  }

  /**
   * A usable access token, logging in if there is not one.
   *
   * Re-mints once the current token is within {@link EXPIRY_SKEW_MS} of
   * expiring, and on every call when the token's lifetime cannot be read —
   * reconnects are backed off, so an extra handshake costs far less than a
   * stream that silently stops. The refresh token is *held* but not spent:
   * rotating it is tracked in #87/#88 and a second login is correct in the
   * meantime, where re-presenting an unrotated refresh token would not be.
   */
  async accessToken(): Promise<string> {
    const now = Date.now();
    if (
      this.session &&
      this.sessionExpiresAt !== null &&
      this.sessionExpiresAt - EXPIRY_SKEW_MS > now
    ) {
      return this.session.accessToken;
    }
    if (!this.pending) {
      this.pending = this.loginNow().finally(() => {
        this.pending = null;
      });
    }
    const session = await this.pending;
    return session.accessToken;
  }

  private async loginNow(): Promise<DelegatedSession> {
    const session = await login({
      nodeUrl: this.config.nodeUrl,
      node: this.config.nodeKey,
      signer: await this.config.signer(),
      accountProof: this.config.accountProof,
      audience: this.config.audience,
      clientName: this.config.clientName,
      ttlSeconds: this.config.ttlSeconds,
      fetch: this.config.fetch,
      timeoutMs: this.config.timeoutMs,
    });
    this.session = session;
    this.sessionExpiresAt = jwtExpiryMs(session.accessToken);
    return session;
  }

  /**
   * SSE events over the relay node — the same `SseClient` a node client hands
   * out, constructed the same way, so nothing downstream can tell which
   * transport produced it.
   */
  get events(): SseClient {
    if (!this.sseClient) {
      this.sseClient = new SseClient({
        baseUrl: this.config.nodeUrl,
        getAuthToken: () => this.accessToken(),
      });
    }
    return this.sseClient;
  }

  /** WebSocket events over the relay node. @experimental — prefer `events`. */
  get ws(): WsClient {
    if (!this.wsClient) {
      this.wsClient = new WsClient({
        baseUrl: this.config.nodeUrl,
        getAuthToken: () => this.accessToken(),
      });
    }
    return this.wsClient;
  }

  /** Close whatever was opened. Never touches the relay's write path. */
  close(): void {
    this.sseClient?.close();
    this.wsClient?.close();
  }
}
