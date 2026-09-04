/**
 * Write to a context through a relay, holding nothing but a signing key.
 *
 * # What this replaces
 *
 * `sdk.rpc.execute` asks a node to run a method *as itself*: it needs a node,
 * that node needs to be a member, and the caller needs a credential on it. For
 * a browser tab, a phone, or an agent, none of those three is available — the
 * runtime cannot compile WASM against materialized state, never received the
 * scope key that seals the deltas, and has no account on anybody's node.
 *
 * This client is the other path. The caller signs a warrant locally, the relay
 * runs the method as the *author's* principal, and the resulting delta is
 * attributed to the author's account and device — their replica slot, their
 * membership, their name in the app. The relay's key signs the envelope and
 * nothing else.
 *
 * # The three preconditions, and why they are checked in this order
 *
 * `describe()` answers the first two in one call, before anything is signed:
 * the relay's executor account (which the warrant must name) and whether it
 * holds `CAN_AUTHOR_ON_BEHALF` on the owning group. The third — that the
 * author's account is a member — only the group knows, and it surfaces as a
 * refusal.
 *
 * Checking before signing is not politeness. A warrant consumes a nonce from a
 * monotonic per-device sequence, and one minted against the wrong executor is
 * unspendable: the number is gone and the write never happened.
 */

import { signWarrant } from '../warrant/warrant.js';
import { HTTPError } from '../http-client/web-client.js';
import type { NonceSource } from './nonce-source.js';

/** How long a freshly minted warrant stays presentable, in seconds. */
const DEFAULT_TTL_SECONDS = 300;

/** Where and as whom to write, plus the key that consents. */
export interface RelayClientConfig {
  /**
   * The relay's base URL — the node's origin, not a path.
   *
   * Discover it from {@link CloudClient.getNamespaceRelays} for a hosted
   * namespace, or take it from the operator for a self-hosted one.
   */
  relayUrl: string;
  /**
   * The account the relay writes as, hex — a warrant's `executor`.
   *
   * An account rather than a key, so one of the relay's processes rotating its
   * signing key does not void warrants already issued to it. Left unset, the
   * first `execute` learns it from {@link RelayClient.describe}.
   */
  executorAccount?: string;
  /** The author's account, hex — whose consent the warrant carries. */
  authorAccount: string;
  /**
   * The author's `AccountProof<DeviceCert>`, hex-encoded borsh.
   *
   * Proves the key that signed the warrant is a device of the account it names.
   * The author sends only its own half; the relay attaches its own.
   */
  authorProof: string;
  /**
   * The author device's ed25519 signing secret, hex (32 bytes).
   *
   * Never transmitted. It signs in this process and only the signature leaves,
   * which is the whole reason a keyholder can author without a node.
   */
  deviceSecret: string;
  /** Where nonces come from. See {@link NonceSource} — a reset replays. */
  nonces: NonceSource;
  /**
   * Seconds a minted warrant stays valid. Defaults to 300.
   *
   * Checked by the relay against its own clock and deliberately never by peers,
   * so this bounds how long *this* request may sit in flight — not how long the
   * network will accept the delta.
   */
  ttlSeconds?: number;
  /** Injected for tests and non-browser runtimes. Defaults to global `fetch`. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** What a relay says about its ability to run intents in one context. */
export interface RelayDescription {
  /** The account a warrant must name as `executor`, hex. */
  executorAccount: string;
  /** Whether the relay holds `CAN_AUTHOR_ON_BEHALF` on the owning group. */
  canAuthorOnBehalf: boolean;
  /** The group whose admin grants that capability, hex. */
  groupId: string;
}

/** Where an accepted intent landed. */
export interface IntentResult<T = unknown> {
  /** The context's scope root after the run — did this change anything? */
  rootHash: string;
  /** The method's own return value. */
  returns: T | null;
}

/**
 * Thrown when a relay refuses an intent, carrying which precondition failed.
 *
 * The distinction is the whole reason this type exists. A `403` from this
 * endpoint means one of three unrelated things — no grant on the relay, the
 * author is not a member, or the nonce was already spent — and they send a
 * caller somewhere completely different: ask an admin, ask for an invitation,
 * or just retry. Collapsing them into "forbidden" makes a retryable replay look
 * like a permissions bug.
 */
export class IntentRefusedError extends Error {
  name = 'IntentRefusedError';

  constructor(
    /** The relay's own explanation, verbatim. */
    public readonly reason: string,
    /** `true` when re-presenting the same intent under a *fresh* warrant may work. */
    public readonly retryable: boolean,
    public readonly status: number,
  ) {
    super(`relay refused the intent (HTTP ${status}): ${reason}`);
  }
}

export class RelayClient {
  private readonly baseUrl: string;
  private executorAccount: string | undefined;
  private readonly config: RelayClientConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: RelayClientConfig) {
    this.config = config;
    this.baseUrl = config.relayUrl.replace(/\/+$/, '');
    this.executorAccount = config.executorAccount;
    const injected = config.fetch;
    this.fetchImpl = injected
      ? (input: RequestInfo | URL, init?: RequestInit) => injected(input, init)
      : (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init);
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  /**
   * Ask the relay what it can do in `contextId`.
   *
   * Cheap and unauthenticated on a relay that serves delegated execution
   * publicly, which is what makes it usable as a precondition check rather than
   * as diagnostics after a failure.
   */
  async describe(contextId: string): Promise<RelayDescription> {
    const body = await this.json<{
      data: { executorAccount: string; canAuthorOnBehalf: boolean; groupId: string };
    }>('GET', `/admin-api/contexts/${encodeURIComponent(contextId)}/intents`);
    // Learned, not merely returned: a client that called `describe` should not
    // then have to pass the account back in to `execute`.
    this.executorAccount = body.data.executorAccount;
    return body.data;
  }

  /**
   * Mint a warrant for `method(args)` and present it to the relay.
   *
   * One intent, once: the warrant authorizes exactly this method and these
   * arguments in exactly this context, and its nonce is spent by the network on
   * apply. Nothing accumulates and nothing is reusable.
   */
  async execute<T = unknown>(
    contextId: string,
    method: string,
    argsJson: unknown = {},
  ): Promise<IntentResult<T>> {
    const executor = this.executorAccount ?? (await this.describe(contextId)).executorAccount;

    const nonce = await this.config.nonces.next();
    const ttl = this.config.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    const warrant = await signWarrant({
      context: contextId,
      authorAccount: this.config.authorAccount,
      executor,
      method,
      argsJson,
      nonce,
      notAfter: BigInt(Math.floor(Date.now() / 1000)) + BigInt(ttl),
      deviceSecret: this.config.deviceSecret,
    });

    const body = await this.json<{ data: { rootHash: string; returns: T | null } }>(
      'POST',
      `/admin-api/contexts/${encodeURIComponent(contextId)}/intents`,
      { method, argsJson, warrant, authorProof: this.config.authorProof },
    );
    return { rootHash: body.data.rootHash, returns: body.data.returns ?? null };
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new HTTPError(
        0,
        err instanceof Error ? err.name : 'NetworkError',
        `${this.baseUrl}${path}`,
        new Headers(),
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      // 400 and 403 are both caller preconditions and core separates them
      // deliberately: 400 means re-sending the same bytes cannot help, 403
      // means the bytes are genuine but authority is missing. Only the spent
      // nonce is worth retrying, and only under a fresh warrant.
      if (response.status === 400 || response.status === 403) {
        const reason = extractReason(text);
        throw new IntentRefusedError(reason, /nonce/i.test(reason), response.status);
      }
      throw new HTTPError(
        response.status,
        response.statusText,
        `${this.baseUrl}${path}`,
        response.headers,
        text,
      );
    }

    return (await response.json()) as T;
  }
}

/** Pull the relay's explanation out of its error body, or fall back to the raw text. */
function extractReason(bodyText: string): string {
  if (!bodyText) return 'no reason given';
  try {
    const parsed = JSON.parse(bodyText) as { error?: unknown; message?: unknown };
    for (const candidate of [parsed.error, parsed.message]) {
      if (typeof candidate === 'string' && candidate) return candidate;
    }
  } catch {
    // Not JSON — the text itself is the best available explanation.
  }
  return bodyText;
}
