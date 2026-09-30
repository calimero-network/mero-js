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
import { resolveSigner, type Signer } from '../signer/signer.js';
import { signCreationWarrant } from '../warrant/creation-warrant.js';
import { signGovernanceWarrant } from '../warrant/governance-warrant.js';
import type { GovernanceOp } from '../warrant/governance-op.js';
import { HTTPError } from '../http-client/web-client.js';
import { hex } from '../crypto/internal.js';
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
   *
   * Mutually exclusive with {@link RelayClientConfig.signer}. A browser should
   * prefer the signer: a secret that exists as a string can be read by anything
   * on the origin, and a warrant-signing key held as a non-extractable
   * `CryptoKey` cannot.
   */
  deviceSecret?: string;
  /**
   * The author device's signer — use instead of
   * {@link RelayClientConfig.deviceSecret} when the key cannot be exported.
   */
  signer?: Signer;
  /**
   * Where nonces come from. See {@link NonceSource} — a reset replays.
   *
   * A client whose storage may be cleared between sessions should wrap its
   * counter in `createRecoveringNonceSource`, which asks the node where the
   * sequence actually stands before the first mint instead of restarting at 1.
   */
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
  /**
   * How many times a `429` is waited out before it reaches the caller.
   * Defaults to 3; `0` surfaces rate limits immediately.
   *
   * Safe to retry because the relay's ingress limiter runs before the node sees
   * the request, so a throttled warrant's nonce is not spent.
   */
  rateLimitRetries?: number;
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

/** What a relay says about its ability to create contexts in one group. */
export interface CreationDescription {
  /** The account a creation warrant must name as `executor`, hex. */
  executorAccount: string;
  /** The group, hex. */
  groupId: string;
  /**
   * Whether the relay has standing to act for members of this group (a
   * `RelayTee` role or `CAN_AUTHOR_ON_BEHALF`). It needs no create rights of
   * its own — those are checked on the author.
   */
  canCreateOnBehalf: boolean;
  /**
   * Whether the author holds `CAN_CREATE_CONTEXT` (or admin) here. Present only
   * when `describeCreation` was given an `author`.
   */
  authorMayCreate?: boolean;
}

/** What {@link RelayClient.createContext} creates. */
export interface CreateContextInput {
  /** The group to create the context in, hex. */
  groupId: string;
  /** The application to create it with, hex (32 bytes). */
  applicationId: string;
  /** The JSON the app's `init()` receives — run as the author's account. */
  initArgs?: unknown;
  /** Which service of a multi-service bundle; absent for the default. */
  serviceName?: string;
  /** A display name for the context. */
  name?: string;
  /**
   * The seed the context id is derived from, hex (32 bytes). Random when
   * absent, which is what almost every caller wants.
   */
  seed?: string;
}

/** Where a delegated creation landed. */
export interface CreatedContext {
  /** The new context's id, hex. */
  contextId: string;
  /** The group it was created in, hex. */
  groupId: string;
  /** The relay's identity in the new context, hex. */
  memberPublicKey: string;
}

/** What a relay says about publishing governance ops for members of one group. */
export interface GovernanceDescription {
  /** The account a governance warrant must name as `executor`, hex. */
  executorAccount: string;
  /** The group asked about, hex. */
  groupId: string;
  /**
   * Whether the relay may act for members here (a `RelayTee` role or
   * `CAN_AUTHOR_ON_BEHALF`). It needs no right to the op itself: that is
   * checked on the author, as the op is applied as the author.
   */
  canActOnBehalf: boolean;
}

/** What {@link RelayClient.govern} publishes. */
export interface GovernInput {
  /**
   * Where the op is published, hex: the group itself for a group op, the
   * **namespace** for a root op (creating, moving or deleting a subgroup).
   */
  groupId: string;
  /** The op, from one of the encoders (`memberAddedOp`, `groupCreatedOp`, ...). */
  op: GovernanceOp;
}

/** Where a delegated governance op landed. */
export interface GovernResult {
  /** The group the op acted on, hex: the new subgroup, for a creation. */
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
 * endpoint means one of several unrelated things — no grant on the relay, the
 * relay is a TEE replica (`ReadOnlyTee`) or a `ReadOnly` member (neither ever
 * relays), the author is
 * not a member or is read-only in the context, or the nonce was already spent
 * — and they send a caller somewhere completely different: ask an admin, pick
 * a relay the namespace admits in `relay` mode, ask for an invitation, or just
 * retry. Collapsing them into "forbidden" makes a retryable replay look
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

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `Retry-After`, as milliseconds — seconds or an HTTP date, per RFC 9110.
 *
 * Returns `null` when the header is absent or unusable, so the caller falls back
 * to its own backoff rather than treating a malformed header as "retry now".
 */
function retryAfterMs(headers: Headers | undefined): number | null {
  const raw = headers?.get?.('Retry-After');
  if (!raw) return null;
  const seconds = Number.parseInt(raw, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(raw);
  if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  return null;
}

export class RelayClient {
  private readonly baseUrl: string;
  private executorAccount: string | undefined;
  private readonly config: RelayClientConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  /** How many times a 429 is waited out before it is raised. */
  private readonly rateLimitRetries: number;

  constructor(config: RelayClientConfig) {
    this.config = config;
    this.baseUrl = config.relayUrl.replace(/\/+$/, '');
    this.executorAccount = config.executorAccount;
    const injected = config.fetch;
    this.fetchImpl = injected
      ? (input: RequestInfo | URL, init?: RequestInit) => injected(input, init)
      : (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init);
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.rateLimitRetries = config.rateLimitRetries ?? 3;
  }

  /**
   * The relay's origin, trailing slash stripped.
   *
   * Exposed because a relay **is a node**: the same origin that answers the
   * intents routes also answers `/auth/challenge`, `/auth/token`, `/sse` and
   * `/ws`. Anything building an observing session over this relay needs the
   * URL, and asking the caller to pass it a second time is how the two drift.
   */
  get relayUrl(): string {
    return this.baseUrl;
  }

  /** The author's account, hex — whose consent every warrant here carries. */
  get authorAccount(): string {
    return this.config.authorAccount;
  }

  /**
   * The author's `AccountProof<DeviceCert>`, hex.
   *
   * The same credential `login()` wants, which is why it is readable: a caller
   * that already handed it to this client should not have to hand an identical
   * copy to the login as well, where the two could disagree.
   */
  get authorProof(): string {
    return this.config.authorProof;
  }

  /**
   * The author device's signer.
   *
   * A {@link Signer} and never the secret: this returns something that can
   * *sign*, so no caller of a `RelayClient` gains the ability to read a key
   * that was passed in as `deviceSecret`. That asymmetry is the point — the
   * login needs a signature, not key material.
   */
  async authorSigner(): Promise<Signer> {
    return resolveSigner(this.config.deviceSecret, this.config.signer, 'deviceSecret');
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
      signer: await resolveSigner(
        this.config.deviceSecret,
        this.config.signer,
        'deviceSecret',
      ),
    });

    const body = await this.json<{ data: { rootHash: string; returns: T | null } }>(
      'POST',
      `/admin-api/contexts/${encodeURIComponent(contextId)}/intents`,
      { method, argsJson, warrant, authorProof: this.config.authorProof },
    );
    return { rootHash: body.data.rootHash, returns: body.data.returns ?? null };
  }

  /**
   * Ask the relay what it can do about creating contexts in `groupId`.
   *
   * Pass `author` (an account, hex) to also learn whether that account may
   * create here — `authorMayCreate` is present only then.
   */
  async describeCreation(
    groupId: string,
    opts: { author?: string } = {},
  ): Promise<CreationDescription> {
    const query = opts.author ? `?author=${encodeURIComponent(opts.author)}` : '';
    const body = await this.json<{ data: CreationDescription }>(
      'GET',
      `/admin-api/groups/${encodeURIComponent(groupId)}/context-intents${query}`,
    );
    return body.data;
  }

  /**
   * Create a context in a group through the relay, as the author.
   *
   * Always asks {@link describeCreation} first — with the author, so both
   * standing checks happen before anything is signed. A relay without standing
   * in the group, or an author without `CAN_CREATE_CONTEXT`, is refused here as
   * an {@link IntentRefusedError} *before* a nonce is taken: the nonce source
   * is monotonic, and a warrant nobody will spend burns one for nothing.
   *
   * The creation warrant's nonce is spent in the new context's per-device
   * ledger — the same one later `execute` calls in that context draw from — so
   * it comes from the configured {@link NonceSource} like any other warrant.
   *
   * Sealing: nothing here is plaintext-specific. The request goes through the
   * injected `fetch`, so a `createAttestedSealedFetch` seals it exactly as it
   * seals `execute`. Whether the relay *accepts* it sealed is the node's call:
   * a proxy-auth relay only admits sealed requests for routes `merod` serves
   * without a credential, so `/admin-api/groups/:id/context-intents` must be on
   * that list on the core side or the request comes back
   * `403 sealed_route_unguarded`.
   */
  async createContext(input: CreateContextInput): Promise<CreatedContext> {
    const described = await this.describeCreation(input.groupId, {
      author: this.config.authorAccount,
    });
    if (!described.canCreateOnBehalf) {
      throw new IntentRefusedError(
        `the relay (${described.executorAccount}) has no standing to act for members of group ` +
          `${described.groupId}; an admin must admit it as a relay or grant it CAN_AUTHOR_ON_BEHALF ` +
          '(checked before signing — no nonce was spent)',
        false,
        403,
      );
    }
    if (described.authorMayCreate === false) {
      throw new IntentRefusedError(
        `the author (${this.config.authorAccount}) may not create contexts in group ` +
          `${described.groupId}; it needs CAN_CREATE_CONTEXT or admin ` +
          '(checked before signing — no nonce was spent)',
        false,
        403,
      );
    }
    const executor = this.checkedExecutor(described.executorAccount);

    const initArgs = input.initArgs ?? {};
    const nonce = await this.config.nonces.next();
    const ttl = this.config.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    const { warrant } = await signCreationWarrant({
      group: input.groupId,
      seed: input.seed,
      authorAccount: this.config.authorAccount,
      executor,
      applicationId: input.applicationId,
      serviceName: input.serviceName,
      name: input.name,
      initArgs,
      nonce,
      notAfter: BigInt(Math.floor(Date.now() / 1000)) + BigInt(ttl),
      deviceSecret: this.creationSecret(),
    });

    const body = await this.json<{ data: CreatedContext }>(
      'POST',
      `/admin-api/groups/${encodeURIComponent(input.groupId)}/context-intents`,
      { warrant, authorProof: this.config.authorProof, initArgs },
    );
    return {
      contextId: body.data.contextId,
      groupId: body.data.groupId,
      memberPublicKey: body.data.memberPublicKey,
    };
  }

  /**
   * Ask the relay whether it may publish governance ops for members of
   * `groupId`, and which account a warrant must name.
   */
  async describeGovernance(groupId: string): Promise<GovernanceDescription> {
    const body = await this.json<{ data: GovernanceDescription }>(
      'GET',
      `/admin-api/groups/${encodeURIComponent(groupId)}/governance-intents`,
    );
    return body.data;
  }

  /**
   * Publish one governance op through the relay, as the author.
   *
   * The warrant commits to the op's exact bytes and is scoped to `groupId`, so
   * the relay can neither change what the op does nor spend it elsewhere. Every
   * peer applies the op as the author, so the author's own rights decide
   * (`MANAGE_MEMBERS` to add a member, `CAN_CREATE_SUBGROUP` to create a
   * subgroup, and so on); a lack of them comes back as an
   * {@link IntentRefusedError} from the relay.
   *
   * Always asks {@link describeGovernance} first and refuses *before* taking a
   * nonce when the relay has no standing, for the reason `createContext` does.
   * The nonce comes from the configured {@link NonceSource}; it is spent in a
   * per-group ledger, and a monotonic source is correct for it as for every
   * other warrant.
   */
  async govern(input: GovernInput): Promise<GovernResult> {
    const described = await this.describeGovernance(input.groupId);
    if (!described.canActOnBehalf) {
      throw new IntentRefusedError(
        `the relay (${described.executorAccount}) has no standing to act for members of group ` +
          `${described.groupId}; an admin must admit it as a relay or grant it CAN_AUTHOR_ON_BEHALF ` +
          '(checked before signing, no nonce was spent)',
        false,
        403,
      );
    }
    const executor = this.checkedExecutor(described.executorAccount);

    const nonce = await this.config.nonces.next();
    const ttl = this.config.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    const warrant = await signGovernanceWarrant({
      scope: input.groupId,
      op: input.op,
      authorAccount: this.config.authorAccount,
      executor,
      nonce,
      notAfter: BigInt(Math.floor(Date.now() / 1000)) + BigInt(ttl),
      deviceSecret: this.creationSecret(),
    });

    const body = await this.json<{ data: GovernResult }>(
      'POST',
      `/admin-api/groups/${encodeURIComponent(input.groupId)}/governance-intents`,
      { warrant, authorProof: this.config.authorProof, op: hex(input.op.bytes) },
    );
    return { groupId: body.data.groupId };
  }

  /**
   * The executor a warrant must name: the one the relay answered with, which a
   * configured account must agree with. Remembered for later calls.
   */
  /**
   * The hex device secret the creation and governance warrant signers take:
   * unlike `signWarrant` they have no `Signer` form yet, so a client configured
   * with only a `signer` cannot mint them.
   */
  private creationSecret(): string {
    if (!this.config.deviceSecret) {
      throw new Error(
        'creating a context or governing through a relay needs deviceSecret: its warrant signer takes no Signer yet',
      );
    }
    return this.config.deviceSecret;
  }

  private checkedExecutor(answered: string): string {
    const configured = this.config.executorAccount;
    if (configured && configured.toLowerCase() !== answered.toLowerCase()) {
      throw new Error(
        `configured executorAccount ${configured} is not the relay's account ` +
          `${answered}; a warrant naming it would be unspendable`,
      );
    }
    this.executorAccount = answered;
    return answered;
  }

  /**
   * One request, waiting out a rate limit rather than failing the caller.
   *
   * The relay's ingress limits the delegated-execution routes to 20 requests a
   * second per source IP, burst 40 — tighter than everything else it serves,
   * because those two routes are the ones it answers to anonymous callers.
   *
   * Retrying a 429 is safe here in a way retrying most refusals is not: the
   * limiter sits *first* in the middleware chain, so a throttled request never
   * reached the node and its warrant nonce was never spent. The same bytes can
   * go again. Contrast the spent-nonce 403 below, which needs a fresh warrant.
   *
   * `Retry-After` is honoured when the ingress sends one; otherwise the wait
   * doubles from a little over the limiter's own window, which is the shortest
   * delay that can actually clear.
   */
  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    let wait = 250;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.jsonOnce<T>(method, path, body);
      } catch (err) {
        const limited = err instanceof HTTPError && err.status === 429;
        if (!limited || attempt >= this.rateLimitRetries) throw err;
        const after = retryAfterMs(err.headers);
        await sleep(after ?? wait);
        wait *= 2;
      }
    }
  }

  private async jsonOnce<T>(method: string, path: string, body?: unknown): Promise<T> {
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
