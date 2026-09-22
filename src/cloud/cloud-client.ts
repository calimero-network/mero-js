/**
 * Calimero Cloud (MDMA) client.
 *
 * # Why the SDK knows about the cloud at all
 *
 * Delegated execution lets an account that holds one signing key write into a
 * context without running a node — but only through a *relay*, and a relay is
 * something the client has to be told about. A warrant names an executor
 * account, so a client that cannot discover which relay serves its namespace,
 * and which account that relay writes as, cannot mint a usable warrant at all.
 *
 * For a self-hosted namespace the operator hands those two facts over out of
 * band. For the hosted tier the cloud is the directory: the user signs in, the
 * cloud knows which namespaces they own and which attested TEE nodes are
 * assigned to each, and it answers with the relay's URL and executor account.
 * That is what this client is for — it is the discovery half of
 * {@link RelayClient}, not a second way to talk to a node.
 *
 * # What it deliberately is not
 *
 * It never sees a warrant, a device secret, or an intent. Discovery goes
 * through the cloud; the write goes straight from the client to the relay. A
 * cloud that proxied intents would read every method and argument its users
 * ever sent, and would be a throughput bottleneck on a path that has no reason
 * to involve it.
 */

import {
  resolveRoot,
  resolveRootPair,
  signAccountLink,
  signAccountLogin,
  type RootSource,
} from '../account/index.js';
import { HTTPError } from '../http-client/web-client.js';
import type { Signer } from '../signer/signer.js';
import {
  routingProofHeaders,
  type DiscoveryChallenge,
  type RoutingChallenge,
  type RoutingCredential,
} from './routing-proof.js';

/**
 * The hosted cloud's **API** when a caller names no other.
 *
 * `manager.cloud.calimero.network`, not `cloud.calimero.network`: the latter
 * serves the React app, which answers an API call with 405 and an HTML body.
 * Every method on this client is an API call, so the bare `new CloudClient()`
 * used to fail at the first request with a parse error rather than at
 * construction — and the URL it was talking to looked right in the message.
 *
 * The web origin still exists in this package: the consent screen in
 * `link-redirect.ts` is a page a person visits, and that one is the app.
 */
const DEFAULT_CLOUD_BASE_URL = 'https://manager.cloud.calimero.network';

export interface CloudClientConfig {
  cloudBaseUrl?: string;
  /**
   * An MDMA session token to start out authenticated with — from a previous
   * {@link CloudClient.signInWithGoogle}, persisted by the app.
   *
   * Sessions are 7-day JWTs with a rolling refresh, so a stored one is usually
   * still live and re-running the Google flow on every launch is avoidable.
   */
  sessionToken?: string;
  /**
   * Called whenever the session token changes — a sign-in, an explicit
   * refresh, or a rolling refresh the server performed mid-request. Persist it
   * here; errors thrown are swallowed so a storage failure cannot mask the
   * response the caller is waiting for.
   */
  onSession?: (session: CloudSession | null) => void | Promise<void>;
  /** Injected for tests and non-browser runtimes. Defaults to global `fetch`. */
  fetch?: typeof fetch;
  /** Per-request timeout. Defaults to 10s, as the node clients do. */
  timeoutMs?: number;
  /**
   * The device credential to prove an account with on the routing read.
   *
   * Nothing to do with {@link sessionToken}: a cloud session says who is signed
   * in, this says which account holds the key. A joiner has the second and
   * cannot have the first — see `routing-proof.ts` for why that is not an
   * oversight.
   *
   * Omitting it leaves {@link CloudClient.getNamespaceRouting} anonymous, which
   * the cloud still answers while `require_routing_proof` is off. Supply it and
   * the read is attributed; the cloud verifies a supplied proof either way, so
   * a wrong one surfaces immediately rather than on the day the flag flips.
   */
  routingCredential?: RoutingCredential;
}

/** Who is signed in, and until when. */
export interface CloudSession {
  sessionToken: string;
  /** Epoch **seconds**, as MDMA reports it — not milliseconds. */
  expiresAt: number;
  user: { email: string; name?: string; picture?: string };
}

/** One namespace the signed-in user owns. */
export interface CloudNamespace {
  namespaceId: string;
  /** Always equal to `namespaceId`; MDMA keeps it for wire compatibility. */
  groupId: string;
  /** `'enabled' | 'disabled' | 'none'` — `'none'` means HA was never enabled. */
  haStatus: string;
  haEnabledAt?: string | null;
  contexts: string[];
  fleetReplicas?: { current?: number; limit?: number } | unknown;
}

/**
 * One attested node the cloud has assigned to a namespace, described as a
 * relay.
 *
 * `authorshipReady` is the field that decides whether a write can happen, and
 * it is reported rather than assumed because it is not the cloud's to grant:
 * `CAN_AUTHOR_ON_BEHALF` is a governance capability, set by an admin of the
 * namespace, and the cloud only relays what the node observed. A relay that is
 * `active` with `authorshipReady: false` is a healthy node waiting for a grant.
 */
export interface CloudRelay {
  peerId: string;
  /** Base URL to present intents to, or `null` when the cloud knows none yet. */
  relayUrl: string | null;
  /** The account a warrant for this relay must name as its `executor`, hex. */
  executorAccount: string | null;
  /**
   * The relay node's ed25519 **device signing key**, hex — or `null`, which is
   * what it is today.
   *
   * A relay is an ordinary node, so it can be logged in to and subscribed to;
   * the login statement has to be signed against this key, supplied separately
   * rather than read from the node being authenticated. The cloud does not
   * publish it yet (mdma #312), so this is `null` on every row and the hosted
   * path reports `canSubscribe === false`.
   *
   * It is parsed rather than omitted so the hosted path needs no API change
   * when the field lands: `connectCloud` already passes it through, and the
   * same call site starts observing. `peerId` is **not** a fallback — it is a
   * libp2p identity, a different key, and signing a statement about it would
   * authenticate nothing.
   *
   * Both plausible spellings are accepted because mdma #312 has not fixed one;
   * if it lands under a third name, this mapping is the single line to change.
   */
  nodeKey: string | null;
  /** `'assigned'` (admitted pending confirm) or `'active'`. */
  status: string;
  /** Whether this relay holds `CAN_AUTHOR_ON_BEHALF` on the namespace. */
  authorshipReady: boolean;
  lastSeenAt?: string | null;
  confirmedAt?: string | null;
}

/**
 * One node serving a namespace, as a caller with no cloud account sees it.
 *
 * The public counterpart to {@link CloudRelay}: same fleet rows, but keyed on a
 * namespace id anyone holding an invitation already has, and answering both
 * things a keyholder needs from a node rather than one of them.
 */
/**
 * One relay that serves an account, as the bootstrap read reports it.
 *
 * `fresh` and a null `relayUrl` are reported rather than filtered, because
 * "your relay is down", "we have no address for it" and "you have no relay"
 * need different actions from a caller and an empty list erases the
 * distinction. A caller looking for somewhere to talk to wants
 * `fresh && relayUrl`; one diagnosing wants the rest.
 */
export interface CloudAccountRelay {
  peerId: string;
  relayUrl: string | null;
  fresh: boolean;
}

export interface CloudNamespaceNode {
  peerId: string;
  /**
   * The node's own account id, hex.
   *
   * Intersect this against the invitation's signed `admitters` list before
   * using the node. That list is a MINT-TIME SNAPSHOT, so a node assigned after
   * an invitation was created is live, healthy, listed here, and still refused
   * with 403 — the cloud cannot know which invitation you hold.
   */
  account: string | null;
  /** Base URL, or `null` when the cloud knows none yet. */
  relayUrl: string | null;
  /** Ready-made admission URL, so a caller never rebuilds the path. */
  admitUrl: string | null;
  /** `'assigned'` (admitted pending confirm) or `'active'`. */
  status: string;
  /** Whether the node's heartbeat for this namespace is recent. */
  fresh: boolean;
  /**
   * Whether a signed join can be presented here now.
   *
   * Deliberately independent of {@link CloudNamespaceNode.authorshipReady}:
   * relaying a join the joiner already signed is not authoring on anyone's
   * behalf, so a node with no grant admits perfectly well.
   */
  canAdmit: boolean;
  /** Whether the node holds `CAN_AUTHOR_ON_BEHALF` on the namespace root group. */
  authorshipReady: boolean;
  /**
   * Whether a delegated write can be posted here now — a URL, an account, a
   * fresh heartbeat and the grant.
   *
   * Namespace-level. A context in a RESTRICTED SUBGROUP is governed by that
   * subgroup, so per-context routing remains the exact answer if a write is
   * refused despite this being true.
   */
  canExecute: boolean;
}

/** What {@link CloudClient.getNamespaceRouting} reports. */
export interface CloudNamespaceRouting {
  namespaceId: string;
  /** Usable nodes first, then a stable order, so a polling caller sees no shuffle. */
  nodes: CloudNamespaceNode[];
  /** Whether any listed node can take a join now. */
  servable: boolean;
  /** Whether any listed node can take a delegated write now. */
  writable: boolean;
}

/** One namespace of the caller's that a machine is serving. */
export interface CloudMachineNamespace {
  namespaceId: string;
  /** `'assigned'` (admitted pending confirm) or `'active'`. */
  status: string;
  /** Whether the machine holds `CAN_AUTHOR_ON_BEHALF` on this namespace. */
  authorshipReady: boolean;
  /**
   * Whether the machine's heartbeat for this namespace is recent.
   *
   * The same freshness rule the per-plan fleet cap uses, so a replica that
   * stopped polling reads as stale here rather than continuing to look
   * healthy — otherwise "my writes stopped working" has no visible cause.
   */
  fresh: boolean;
  confirmedAt?: string | null;
  lastSeenAt?: string | null;
}

/**
 * One attested machine serving this account.
 *
 * A narrow view on purpose: the zone, machine type, instance name, public IP
 * and KMS ids are operator data with no client use, and a cloud user is not an
 * operator.
 */
export interface CloudMachine {
  peerId: string;
  relayUrl: string | null;
  executorAccount: string | null;
  /**
   * Whether this machine can write for the caller *somewhere* — a URL, an
   * executor account, and the grant on at least one namespace.
   *
   * Folded here so a client does not re-derive the three-way precondition and
   * get a refusal it cannot explain.
   */
  canExecute: boolean;
  /** Only the caller's own namespaces, even on a machine shared with others. */
  namespaces: CloudMachineNamespace[];
}

/** A Calimero account linked to this cloud login. */
export interface CloudLinkedAccount {
  /** The account id, 64 hex. */
  accountId: string;
  linkedAt?: string | null;
  /**
   * Whether a recovery envelope has been stored for this account, so a UI can
   * say "recoverable" without fetching the blob.
   */
  hasRecoveryEnvelope: boolean;
}

/** What {@link CloudClient.getMyAccounts} reports. */
export interface CloudLinkedAccounts {
  accounts: CloudLinkedAccount[];
  /** How many the caller's plan allows. `null` means no limit. */
  limit: number | null;
}

/** A single-use challenge to sign with an account root. */
export interface AccountLinkChallenge {
  /** Sign this verbatim — it is an opaque sealed string, not a decodable id. */
  nonce: string;
  /** When it stops being accepted, epoch milliseconds. */
  expiresAtMs: number | null;
}

/** A proof assembled by whoever holds the root, for {@link CloudClient.submitAccountLink}. */
export interface AccountLinkProof {
  /** The account being claimed, 64 hex. */
  accountId: string;
  /** The root that names it, 64 hex. */
  rootPublicKey: string;
  /** The challenge that was signed. */
  nonce: string;
  /** `signAccountLink`'s output — standard base64. */
  signature: string;
}

/** Where to send someone so a cloud login can consent to linking an account. */
export interface AccountLinkHandoff {
  /** The cloud portal URL to open — a new tab, a popup, or the system browser. */
  url: string;
  /** The account the consent will be for, echoed so a caller can show it. */
  accountId: string;
}

/** What comes back on the callback: a grant, a refusal, or neither. */
export interface AccountLinkCallback {
  /** The grant to spend with {@link CloudClient.linkAccountWithGrant}. */
  grant?: string;
  /** The account the grant is for, as the portal echoed it. */
  accountId?: string;
  /** `'denied'` when the person cancelled. Absent on success. */
  error?: string;
}

/** A single-use challenge for an account root to sign itself in with. */
export interface AccountLoginChallenge {
  /** Sign this verbatim. Opaque and sealed by the cloud; nonces live ~2 minutes. */
  nonce: string;
  /** When it stops being accepted, epoch milliseconds. */
  expiresAtMs: number;
}

/** A proof assembled by whoever holds the root, for {@link CloudClient.submitAccountLogin}. */
export interface AccountLoginProof {
  /**
   * The root that names the account, 64 hex.
   *
   * No `accountId` field, unlike {@link AccountLinkProof}: the cloud derives
   * the account from this key rather than accepting one alongside it, so there
   * is nothing a caller could state that the signature would then contradict.
   */
  rootPublicKey: string;
  /** The challenge that was signed. */
  nonce: string;
  /** `signAccountLogin`'s output — standard base64. */
  signature: string;
}

/** The outcome of {@link CloudClient.linkAccount}. */
export interface CloudAccountLink {
  accountId: string;
  linkedAt?: string | null;
  /**
   * True when this account was already linked to this same login, which the
   * cloud treats as a 200 no-op rather than an error. A caller re-running
   * onboarding gets success, not a confusing failure.
   */
  alreadyLinked: boolean;
}

export interface EnableHAOptions {
  groupId: string;
  contextId: string;
  redirectUrl?: string;
}

export interface DisableHAOptions {
  groupId: string;
  contextId: string;
  redirectUrl?: string;
}

/** Response headers MDMA uses to hand back a rolling-refreshed session. */
const REFRESH_HEADER = 'x-mdma-session-refresh';
const REFRESH_EXPIRES_HEADER = 'x-mdma-session-expires';

export class CloudClient {
  private baseUrl: string;
  private session: CloudSession | null = null;
  private readonly onSession?: CloudClientConfig['onSession'];
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly routingCredential?: RoutingCredential;

  constructor(config: CloudClientConfig = {}) {
    this.baseUrl = (config.cloudBaseUrl || DEFAULT_CLOUD_BASE_URL).replace(/\/+$/, '');
    this.onSession = config.onSession;
    // Bound through an arrow function: an unbound `globalThis.fetch` throws
    // "Illegal invocation" in a browser, the same reason the node HTTP clients
    // wrap it.
    const injected = config.fetch;
    this.fetchImpl = injected
      ? (input: RequestInfo | URL, init?: RequestInit) => injected(input, init)
      : (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init);
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.routingCredential = config.routingCredential;

    if (config.sessionToken) {
      // Expiry unknown until the server tells us; 0 means "do not reason about
      // it locally", never "expired" — the server is the only judge and it
      // answers 401 when it disagrees.
      this.session = {
        sessionToken: config.sessionToken,
        expiresAt: 0,
        user: { email: '' },
      };
    }
  }

  /** The current session, or `null` when nobody is signed in. */
  getSession(): CloudSession | null {
    return this.session;
  }

  /** Whether a session token is held. Says nothing about the server agreeing. */
  isSignedIn(): boolean {
    return this.session !== null;
  }

  /**
   * Exchange a Google OAuth2 ID token for an MDMA session.
   *
   * The app owns the Google flow (One Tap, an auth-code popup, a native
   * browser) and hands the resulting ID token here once. Everything after this
   * uses the returned session token, so the Google credential does not have to
   * be kept or re-minted per call.
   */
  async signInWithGoogle(idToken: string): Promise<CloudSession> {
    const body = await this.request<{
      session_token: string;
      expires_at: number;
      user: { email: string; name?: string; picture?: string };
    }>('POST', '/api/auth/google', { body: { id_token: idToken }, anonymous: true });
    return this.adoptSession(body);
  }

  /**
   * Sign in as a Calimero account, proving it with its root key.
   *
   * The password-free counterpart to {@link signInWithGoogle}: no Google, no
   * password, no server-held secret — the cloud mints a challenge, the account
   * root signs it, and the session that comes back is the same MDMA session
   * token every other cloud route already accepts.
   *
   * Doing this **once** is what makes an account's later device proofs mean
   * something. A routing read shows that the caller holds a device the root
   * certified, but certificates are public, so it can never show that anyone
   * held the root; the cloud records this claim and from then on knows the
   * account behind those reads was claimed by its owner. The claim is recorded
   * even when the session is refused.
   *
   * @param root the account root: its 64-hex secret, or a `Signer` over a root
   *   this process may use and cannot read — the form a phrase-held root in a
   *   browser takes. Either way nothing but a signature over the cloud's nonce
   *   travels.
   *
   * A `403` means either the signature did not verify, or the account is not
   * linked to a cloud login: ownership alone says who you are, and the link
   * says what you are entitled to. Anyone can mint a root offline, so a session
   * on the proof alone would authenticate perfectly and authorize nothing. The
   * ownership claim is recorded either way, so linking later needs no re-proof.
   */
  async signInWithAccount(root: RootSource): Promise<CloudSession> {
    const { signer, publicKey } = await resolveRoot(root);
    const { nonce } = await this.getAccountLoginChallenge();
    return this.submitAccountLogin({
      rootPublicKey: publicKey,
      nonce,
      signature: await signAccountLogin({ signer, nonce }),
    });
  }

  /**
   * Mint a challenge for an account root to sign.
   *
   * Public, and deliberately so: the caller has no session — obtaining one is
   * what this exchange does. The nonce is not a capability, it is the thing a
   * capability gets demonstrated against, and demonstrating it needs the root.
   *
   * Split out of {@link signInWithAccount} for the case that call cannot serve:
   * a root held by a hardware key, a desktop app or an air-gapped machine,
   * which signs without the secret ever reaching this process.
   */
  async getAccountLoginChallenge(): Promise<AccountLoginChallenge> {
    const body = await this.request<{ nonce: string; expires_at_ms: number }>(
      'GET',
      '/api/auth/account/challenge',
      { anonymous: true },
    );
    return { nonce: body.nonce, expiresAtMs: body.expires_at_ms };
  }

  /** Post a proof assembled elsewhere. The other half of {@link getAccountLoginChallenge}. */
  async submitAccountLogin(proof: AccountLoginProof): Promise<CloudSession> {
    const body = await this.request<{
      session_token: string;
      expires_at: number;
      user: { email: string; name?: string; picture?: string };
    }>('POST', '/api/auth/account', {
      body: {
        root_public_key: proof.rootPublicKey,
        nonce: proof.nonce,
        signature: proof.signature,
      },
      anonymous: true,
    });
    return this.adoptSession(body);
  }

  /**
   * Refresh the session token explicitly.
   *
   * Rarely needed: MDMA rolling-refreshes on ordinary authenticated calls and
   * this client adopts the replacement automatically. Use it when an app wants
   * a fresh token before going idle rather than on the next request.
   */
  async refreshSession(): Promise<CloudSession> {
    const body = await this.request<{
      session_token: string;
      expires_at: number;
      user: { email: string; name?: string; picture?: string };
    }>('POST', '/api/auth/refresh');
    return this.adoptSession(body);
  }

  /**
   * Revoke this session server-side and forget it locally.
   *
   * Local state is cleared even if the server call fails: the caller asked to
   * be signed out, and keeping a token they believe is gone is the worse of the
   * two failures.
   */
  async signOut(): Promise<void> {
    try {
      if (this.session) await this.request<void>('POST', '/api/auth/logout', { parse: 'none' });
    } finally {
      this.session = null;
      void this.notifySession(null);
    }
  }

  /** Namespaces the signed-in user owns. */
  async getMyNamespaces(): Promise<CloudNamespace[]> {
    const rows = await this.request<Array<Record<string, unknown>>>(
      'GET',
      '/api/cloud/me/namespaces',
    );
    return rows.map((row) => ({
      namespaceId: String(row.namespace_id ?? row.group_id ?? ''),
      groupId: String(row.group_id ?? row.namespace_id ?? ''),
      haStatus: String(row.ha_status ?? 'none'),
      haEnabledAt: (row.ha_enabled_at as string | null | undefined) ?? null,
      contexts: Array.isArray(row.contexts) ? (row.contexts as string[]) : [],
      fleetReplicas: row.fleet_replicas,
    }));
  }

  /**
   * The relays serving one namespace: where to present an intent, and as whom.
   *
   * Everything a client needs in order to mint a warrant it can actually
   * spend. Filter on `authorshipReady` before signing — a warrant presented to
   * a relay with no grant is refused *after* the author has burned a nonce from
   * its monotonic sequence on it.
   */
  async getNamespaceRelays(namespaceId: string): Promise<CloudRelay[]> {
    const body = await this.request<{ relays?: Array<Record<string, unknown>> }>(
      'GET',
      `/api/cloud/me/namespaces/${encodeURIComponent(namespaceId)}/relays`,
    );
    return (body.relays ?? []).map((row) => ({
      peerId: String(row.peer_id ?? ''),
      relayUrl: (row.relay_url as string | null | undefined) ?? null,
      executorAccount: (row.executor_account as string | null | undefined) ?? null,
      nodeKey:
        (row.node_key as string | null | undefined) ??
        (row.node_public_key as string | null | undefined) ??
        null,
      status: String(row.status ?? ''),
      authorshipReady: row.authorship_ready === true,
      lastSeenAt: (row.last_seen_at as string | null | undefined) ?? null,
      confirmedAt: (row.confirmed_at as string | null | undefined) ?? null,
    }));
  }

  /**
   * The first relay for `namespaceId` that can actually run an intent, or
   * `null`.
   *
   * "Can actually run one" is three conditions, and a client that checks fewer
   * gets a refusal it cannot explain: the cloud must know a URL, the relay must
   * have reported the executor account a warrant has to name, and the grant
   * must be in place.
   */
  async findExecutingRelay(namespaceId: string): Promise<CloudRelay | null> {
    const relays = await this.getNamespaceRelays(namespaceId);
    return (
      relays.find((r) => r.authorshipReady && r.relayUrl !== null && r.executorAccount !== null) ??
      null
    );
  }

  /**
   * Where to reach a namespace without owning it: one read, both verbs.
   *
   * **Anonymous.** A joiner is by construction not the namespace owner and holds
   * no cloud session — needing one is exactly what this path exists to avoid.
   * Discovery is not authorization: merod refuses an `/admit` call unless the
   * relaying node's account is on the invitation's signed `admitters` list, and
   * refuses an intent unless the warrant is genuinely the member's, so naming a
   * node grants the caller nothing it did not already have.
   *
   * A keyholder resolves a namespace to a node ONCE and then admits, reads and
   * posts intents against that same node, which is why admission and writability
   * are answered together rather than across two endpoints — the per-context
   * read needs a context id a joiner does not yet have.
   *
   * An empty `nodes` list is a state, not an error: a namespace with no fleet
   * assignment has no cloud node, and the joiner must use one of the
   * invitation's other admitters — another admin's node, or a self-hosted peer.
   */
  async getNamespaceRouting(namespaceId: string): Promise<CloudNamespaceRouting> {
    const body = await this.request<{
      namespace_id?: unknown;
      admitters?: Array<Record<string, unknown>>;
      servable?: unknown;
      writable?: unknown;
    }>('GET', `/api/cloud/namespaces/${encodeURIComponent(namespaceId)}/admitters`, {
      anonymous: true,
      headers: await this.routingProof(namespaceId),
    });
    return {
      namespaceId: String(body.namespace_id ?? namespaceId),
      nodes: (body.admitters ?? []).map((row) => ({
        peerId: String(row.peer_id ?? ''),
        account: (row.account as string | null | undefined) ?? null,
        relayUrl: (row.relay_url as string | null | undefined) ?? null,
        admitUrl: (row.admit_url as string | null | undefined) ?? null,
        status: String(row.status ?? ''),
        fresh: row.fresh === true,
        canAdmit: row.can_admit === true,
        authorshipReady: row.authorship_ready === true,
        canExecute: row.can_execute === true,
      })),
      servable: body.servable === true,
      writable: body.writable === true,
    };
  }

  /**
   * Ask the cloud for a challenge to prove an account against.
   *
   * Public and unauthenticated on purpose, and safe to be: the nonce is sealed
   * and bound to this one namespace, so it is not a capability — it is the
   * thing a capability gets demonstrated against. A caller with no credential
   * gains nothing by holding one.
   *
   * {@link getNamespaceRouting} calls this for you when the client was
   * constructed with a `routingCredential`. Call it directly only to sign a
   * challenge somewhere this client cannot reach the key.
   */
  async getRoutingChallenge(namespaceId: string): Promise<RoutingChallenge> {
    const body = await this.request<{
      namespace_id?: unknown;
      nonce?: unknown;
      expires_at_ms?: unknown;
    }>('GET', `/api/cloud/namespaces/${encodeURIComponent(namespaceId)}/challenge`, {
      anonymous: true,
    });
    return {
      namespaceId: String(body.namespace_id ?? namespaceId),
      nonce: String(body.nonce ?? ''),
      expiresAtMs: Number(body.expires_at_ms ?? 0),
    };
  }

  /**
   * The proof headers for one routing read, or nothing when no credential was
   * configured.
   *
   * A challenge per read rather than a cached one: they expire in about two
   * minutes and are single-namespace, so caching would trade one cheap request
   * for a class of expiry bug that only shows up on a slow client.
   */
  private async routingProof(
    namespaceId: string,
  ): Promise<Record<string, string> | undefined> {
    if (!this.routingCredential) return undefined;
    const challenge = await this.getRoutingChallenge(namespaceId);
    return routingProofHeaders(challenge, this.routingCredential);
  }

  /**
   * Ask the cloud for a challenge bound to one ACCOUNT.
   *
   * Public and unauthenticated like {@link getRoutingChallenge}: an account id
   * is `H(genesis(root_pk))` and travels in the clear in every device-link op,
   * so naming one here reveals nothing and authorises nothing. MDMA re-derives
   * the account from the certificate and refuses a mismatch.
   */
  async getAccountRelaysChallenge(accountId: string): Promise<DiscoveryChallenge> {
    const body = await this.request<{
      account_id?: unknown;
      nonce?: unknown;
      expires_at_ms?: unknown;
    }>('GET', `/api/cloud/accounts/${encodeURIComponent(accountId)}/challenge`, {
      anonymous: true,
    });
    return {
      accountId: String(body.account_id ?? accountId),
      nonce: String(body.nonce ?? ''),
      expiresAtMs: Number(body.expires_at_ms ?? 0),
    };
  }

  /**
   * Which relays serve this account — the bootstrap, and nothing more.
   *
   * A device holding a certificate can resolve a namespace it can *name*
   * ({@link getNamespaceRouting}) and can ask a node it can *reach* what its
   * account belongs to. It starts with neither. This closes that one gap.
   *
   * **It does not return namespaces, deliberately.** The node answers that from
   * the governance DAG, scoped to the calling account: log in at one of these
   * relays with an account proof and read its namespace listing. A cloud-side
   * copy would be a second source of truth built from rows that linger for an
   * account which left a namespace.
   *
   * So the sequence is: this → log in at a relay → ask it what you are in.
   *
   * Proven with the **device certificate**, not a cloud session, so it needs a
   * `routingCredential` and throws without one rather than returning an empty
   * list — "you configured no credential" and "you have no relays" are
   * different answers and must not look alike.
   */
  async getAccountRelays(accountId: string): Promise<CloudAccountRelay[]> {
    if (!this.routingCredential) {
      throw new Error(
        'getAccountRelays needs a routingCredential: construct the client with the device ' +
          'certificate and its signing secret, since this read is proven by the device, not by a session.',
      );
    }
    const challenge = await this.getAccountRelaysChallenge(accountId);
    const body = await this.request<{
      account_id?: unknown;
      relays?: Array<Record<string, unknown>>;
    }>('GET', `/api/cloud/accounts/${encodeURIComponent(accountId)}/relays`, {
      anonymous: true,
      headers: await routingProofHeaders(challenge, this.routingCredential),
    });
    return (body.relays ?? []).map((row) => ({
      peerId: String(row.peer_id ?? ''),
      relayUrl: (row.relay_url as string | null | undefined) ?? null,
      fresh: row.fresh === true,
    }));
  }

  /**
   * The node to send a signed join to, chosen from those an invitation names.
   *
   * Pass the invitation's `admitters` and the intersection is done here, because
   * skipping it is the failure this method exists to prevent: the cloud lists
   * every node assigned to the namespace, while `admitters` is a snapshot signed
   * when the invitation was minted. A node added afterwards looks perfect in
   * every field here and answers 403.
   *
   * Omit `admitters` only for an invitation that names none — an empty list on
   * the wire authorises any node to admit.
   */
  async findAdmitter(
    namespaceId: string,
    admitters?: readonly string[],
  ): Promise<CloudNamespaceNode | null> {
    const { nodes } = await this.getNamespaceRouting(namespaceId);
    const allowed =
      admitters && admitters.length > 0 ? new Set(admitters.map((a) => a.toLowerCase())) : null;
    return (
      nodes.find(
        (n) =>
          n.canAdmit &&
          (allowed === null || (n.account !== null && allowed.has(n.account.toLowerCase()))),
      ) ?? null
    );
  }

  /**
   * Every attested machine currently serving something this account owns.
   *
   * The account-wide view of the same rows {@link getNamespaceRelays} returns
   * per namespace, keyed by machine — so a UI can answer "what is running for
   * me?" in one call. `canExecute` folds the three-way precondition, so a
   * caller does not re-derive it.
   *
   * Only the caller's own namespaces appear on each machine. A plan's
   * `usersPerMachine` is greater than one, so a fleet node routinely serves
   * several accounts at once.
   */
  async getMyMachines(): Promise<CloudMachine[]> {
    const body = await this.request<{ machines?: Array<Record<string, unknown>> }>(
      'GET',
      '/api/cloud/me/machines',
    );
    return (body.machines ?? []).map((row) => ({
      peerId: String(row.peer_id ?? ''),
      relayUrl: (row.relay_url as string | null | undefined) ?? null,
      executorAccount: (row.executor_account as string | null | undefined) ?? null,
      canExecute: row.can_execute === true,
      namespaces: (Array.isArray(row.namespaces) ? row.namespaces : []).map((n) => {
        const ns = n as Record<string, unknown>;
        return {
          namespaceId: String(ns.namespace_id ?? ''),
          status: String(ns.status ?? ''),
          authorshipReady: ns.authorship_ready === true,
          fresh: ns.fresh === true,
          confirmedAt: (ns.confirmed_at as string | null | undefined) ?? null,
          lastSeenAt: (ns.last_seen_at as string | null | undefined) ?? null,
        };
      }),
    }));
  }

  /**
   * Claim a namespace under this account, proving ownership.
   *
   * The cloud has no other way to learn a namespace exists — namespaces are
   * created on a node, and there is deliberately no "create namespace" in the
   * cloud. `ownershipProof` comes from
   * `admin.issueNamespaceOwnershipProof(namespaceId, …)` on a node that is a
   * **direct admin** of that namespace; merod refuses to issue one otherwise.
   *
   * Pass merod's response object straight through. The cloud accepts core's
   * `signerPublicKey`/`signedPayload` casing as well as snake_case, so there is
   * no re-keying step — and getting that wrong used to surface as a `422`
   * naming three missing fields.
   *
   * Idempotent for the same account. A namespace already claimed by someone
   * else is a `409`; a replayed proof nonce is a `403`.
   */
  async claimNamespace(namespaceId: string, ownershipProof: unknown): Promise<void> {
    await this.request<unknown>('POST', '/api/cloud/namespaces/claim', {
      body: { namespace_id: namespaceId, ownership_proof: ownershipProof },
    });
  }

  /**
   * Ask the fleet to host a claimed namespace — the step that gets a relay
   * assigned.
   *
   * Takes no body: {@link claimNamespace} already established ownership, and
   * this is the separate "now host it" half. Idempotent.
   *
   * Not to be confused with {@link enableHA}, which opens the cloud's web flow
   * in a browser tab for a user to complete by hand. This is the API call.
   */
  async enableNamespaceHa(namespaceId: string): Promise<unknown> {
    return this.request<unknown>(
      'POST',
      `/api/cloud/namespaces/${encodeURIComponent(namespaceId)}/enable-ha`,
      { body: {} },
    );
  }

  /**
   * Stop hosting a claimed namespace.
   *
   * The fleet's own reconcile loop does the rest: each assigned node notices
   * the namespace is no longer assigned to it and **self-leaves**, which makes
   * core evict it and purge its local data and keys. So this is not just a
   * billing flip.
   */
  async disableNamespaceHa(namespaceId: string): Promise<unknown> {
    return this.request<unknown>(
      'POST',
      `/api/cloud/namespaces/${encodeURIComponent(namespaceId)}/disable-ha`,
      { body: {} },
    );
  }

  /**
   * The node assigned to the signed-in user, or `null`.
   *
   * @deprecated Use {@link getMyMachines}. This reads the cloud's retired
   * `NodeAssignment` ledger, which nothing has written since the v1
   * retirement, so it answers `null` for every namespace-native account —
   * which reads as "you have no machine" when the truth is "that is no longer
   * how a machine is assigned".
   */
  async getMyNode(): Promise<Record<string, unknown> | null> {
    const body = await this.request<{ node: Record<string, unknown> | null }>(
      'GET',
      '/api/cloud/me/node',
    );
    return body.node ?? null;
  }

  enableHA(options: EnableHAOptions): void {
    const params = new URLSearchParams({
      group_id: options.groupId,
      context_id: options.contextId,
    });
    if (options.redirectUrl) {
      params.set('redirect_url', options.redirectUrl);
    }
    window.open(`${this.baseUrl}/enable-ha?${params.toString()}`);
  }

  disableHA(options: DisableHAOptions): void {
    const params = new URLSearchParams({
      group_id: options.groupId,
      context_id: options.contextId,
    });
    if (options.redirectUrl) {
      params.set('redirect_url', options.redirectUrl);
    }
    window.open(`${this.baseUrl}/disable-ha?${params.toString()}`);
  }

  /** Record a freshly-issued session and tell the app to persist it. */
  /**
   * Link a Calimero account to this cloud login, proving possession of its root.
   *
   * Two hops, folded into one call because they are useless apart: fetch a
   * single-use challenge, then sign it with the account root and post the proof.
   * The secret never leaves this process — only a signature over a nonce the
   * cloud minted does.
   *
   * This is the binding the cloud bills against. A relay does not need it to run
   * an intent; the cloud needs it to know whose plan a hosted node is spending,
   * and to sign that account back in later.
   *
   * @param root the account root: its 64-hex secret — from
   *   {@link generateAccountRoot}, a restored recovery phrase, or a desktop app
   *   or hardware key that already holds one — or a `Signer` over a root this
   *   process cannot read, which is what a phrase-held browser root is.
   *
   * Idempotent for the same login. An account already linked to a *different*
   * cloud login is a `409`; a replayed or expired challenge is a `403`; and
   * exceeding the plan's account limit is a `402`.
   */
  async linkAccount(root: RootSource): Promise<CloudAccountLink> {
    const { signer, publicKey, accountId } = await resolveRoot(root);
    const { nonce } = await this.getAccountLinkChallenge();
    return this.submitAccountLink({
      accountId,
      rootPublicKey: publicKey,
      nonce,
      signature: await signAccountLink({ signer, nonce }),
    });
  }

  /**
   * Mint a single-use challenge for an account root to sign.
   *
   * The split half of {@link linkAccount}, for the case that call cannot serve:
   * a root held by a desktop app, a hardware key or an air-gapped machine, which
   * signs without the secret ever reaching this process. Fetch the challenge
   * here, have the holder sign it, then hand the proof to
   * {@link submitAccountLink}.
   *
   * Bound to the signed-in login and short-lived, so it is not a standing
   * capability if it leaks — but it IS single-use, so a challenge fetched and
   * abandoned is spent.
   */
  async getAccountLinkChallenge(): Promise<AccountLinkChallenge> {
    const body = await this.request<{
      nonce: string;
      expires_at_ms?: number | null;
    }>('GET', '/api/cloud/me/accounts/challenge');
    return { nonce: body.nonce, expiresAtMs: body.expires_at_ms ?? null };
  }

  /**
   * Post a proof assembled elsewhere. The other half of
   * {@link getAccountLinkChallenge}.
   *
   * `accountId` must be the account `rootPublicKey` names — the cloud refuses a
   * valid signature by a key that names a different account, or a caller could
   * prove one root and link somebody else's account. Derive both from the same
   * key rather than letting a user type either.
   */
  async submitAccountLink(proof: AccountLinkProof): Promise<CloudAccountLink> {
    const body = await this.request<Record<string, unknown>>(
      'POST',
      '/api/cloud/me/accounts',
      {
        body: {
          account_id: proof.accountId,
          root_public_key: proof.rootPublicKey,
          nonce: proof.nonce,
          signature: proof.signature,
        },
      },
    );
    return {
      accountId: String(body.account_id ?? proof.accountId),
      linkedAt: (body.linked_at as string | null | undefined) ?? null,
      alreadyLinked: body.already_linked === true,
    };
  }

  /**
   * Where to send someone to authorise linking this account, and what to expect
   * back. Pairs with {@link readAccountLinkCallback} and
   * {@link linkAccountWithGrant}.
   *
   * This exists because a browser app is in a bind: it holds an account root and
   * can never hold a *first* cloud session, since only Google issues one. So the
   * person goes to the cloud, where they are signed in, and consents there. What
   * comes back is a grant — consent to link this one account, spendable only by
   * whoever can sign with its root.
   *
   * @param callbackUrl where the portal sends the person back. Must be an origin
   *   the cloud allows; unlisted ones are refused when the grant is minted, not
   *   here. The grant arrives in the URL **fragment**, which browsers do not
   *   send to servers.
   *
   * Static, so it needs no client and no session: there is nothing to
   * authenticate as yet.
   */
  static accountLinkHandoff(options: {
    /** The cloud portal's origin, e.g. `https://cloud.calimero.network`. */
    portalUrl: string;
    /** The account to be linked, 64 hex — derive it, never let a user type it. */
    accountId: string;
    /** Where to come back to. */
    callbackUrl: string;
  }): AccountLinkHandoff {
    const portal = options.portalUrl.replace(/\/+$/, '');
    const query = new URLSearchParams({
      'link-account': options.accountId,
      'callback-url': options.callbackUrl,
    });
    return { url: `${portal}/?${query.toString()}`, accountId: options.accountId };
  }

  /**
   * Read the portal's answer out of a callback URL's fragment.
   *
   * Returns `{}` when there is nothing to read, so it is safe to call on every
   * load — which is how a redirected app finds out it has been sent back.
   *
   * @param href defaults to the current location, when there is one.
   */
  static readAccountLinkCallback(href?: string): AccountLinkCallback {
    const source = href ?? (typeof window === 'undefined' ? '' : window.location.href);
    if (!source) return {};
    let hash: string;
    try {
      hash = new URL(source).hash;
    } catch {
      return {};
    }
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const grant = params.get('grant');
    const accountId = params.get('account');
    const error = params.get('error');
    const out: AccountLinkCallback = {};
    if (grant) out.grant = grant;
    if (accountId) out.accountId = accountId;
    if (error) out.error = error;
    return out;
  }

  /**
   * Spend a link grant: sign it with the account root and post the pair.
   *
   * Anonymous, and it has to be — the app doing this holds no cloud session,
   * which is the whole reason the grant exists. The grant carries the consenting
   * login sealed inside it, so nothing here names one; a caller-supplied email
   * would be a field to lie in.
   *
   * The signature is an ordinary account-link signature with the grant as the
   * nonce, so the same {@link signAccountLink} every other link path uses signs
   * this one. Both halves are required: a grant without the key links nothing,
   * which is what makes it safe to carry through a browser redirect.
   *
   * A `403` means the grant was bad, expired, already spent, or signed by a key
   * that names a different account; `409` that the account belongs to another
   * login; `402` that the plan is full.
   */
  async linkAccountWithGrant(options: {
    grant: string;
    /** The root of the account the grant names, 64 hex. */
    rootSecret?: string;
    /**
     * The root's signer — use instead of `rootSecret` when the root is a key
     * this process may use and cannot read.
     */
    signer?: Signer;
  }): Promise<CloudAccountLink> {
    const { signer, publicKey, accountId } = await resolveRootPair(
      options.rootSecret,
      options.signer,
    );
    const body = await this.request<Record<string, unknown>>(
      'POST',
      '/api/cloud/accounts/link',
      {
        body: {
          grant: options.grant,
          root_public_key: publicKey,
          signature: await signAccountLink({
            signer,
            nonce: options.grant,
          }),
        },
        anonymous: true,
      },
    );
    return {
      accountId: String(body.account_id ?? accountId),
      linkedAt: (body.linked_at as string | null | undefined) ?? null,
      alreadyLinked: body.already_linked === true,
    };
  }

  /** The accounts linked to this login, and how many the plan allows. */
  async getMyAccounts(): Promise<CloudLinkedAccounts> {
    const body = await this.request<{
      accounts?: Array<Record<string, unknown>>;
      limit?: number | null;
    }>('GET', '/api/cloud/me/accounts');
    return {
      accounts: (body.accounts ?? []).map((row) => ({
        accountId: String(row.account_id ?? ''),
        linkedAt: (row.linked_at as string | null | undefined) ?? null,
        hasRecoveryEnvelope: row.has_recovery_envelope === true,
      })),
      limit: body.limit ?? null,
    };
  }

  private adoptSession(body: {
    session_token: string;
    expires_at: number;
    user: { email: string; name?: string; picture?: string };
  }): CloudSession {
    this.session = {
      sessionToken: body.session_token,
      expiresAt: body.expires_at,
      user: body.user,
    };
    void this.notifySession(this.session);
    return this.session;
  }

  private async notifySession(session: CloudSession | null): Promise<void> {
    try {
      await this.onSession?.(session);
    } catch {
      // A failing persistence callback must not mask the call's own result.
    }
  }

  private async request<T>(
    method: string,
    path: string,
    options: {
      body?: unknown;
      anonymous?: boolean;
      parse?: 'json' | 'none';
      /** Extra request headers. Never overrides `Authorization` — see below. */
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    if (!options.anonymous && !this.session) {
      throw new Error(
        'Not signed in to Calimero Cloud: call signInWithGoogle() or construct the client with a sessionToken',
      );
    }

    // Caller headers go in FIRST, so the lines below win on any collision: a
    // per-call header must never be able to replace the session's
    // `Authorization` or change how the body is parsed.
    const headers: Record<string, string> = {
      ...options.headers,
      Accept: 'application/json',
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (!options.anonymous && this.session) {
      headers.Authorization = `Bearer ${this.session.sessionToken}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (err) {
      // Same shape the node clients use for a transport failure: an `HTTPError`
      // with `status: 0`, so a caller has one error type to handle rather than
      // one per layer.
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

    this.adoptRollingRefresh(response);

    if (!response.ok) {
      const bodyText = await response.text().catch(() => undefined);
      throw new HTTPError(
        response.status,
        response.statusText,
        `${this.baseUrl}${path}`,
        response.headers,
        bodyText,
      );
    }

    if (options.parse === 'none' || response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /**
   * Adopt a session token the server refreshed mid-request.
   *
   * MDMA rotates the token on activity and returns the replacement in a
   * response header rather than making the client ask. Ignoring it costs
   * nothing immediately and then logs the user out a week later, which is the
   * kind of bug that is impossible to reproduce in a short session.
   *
   * The user identity is carried over: the header holds only a token, and the
   * refresh is the same logical session as the sign-in that named the user.
   */
  private adoptRollingRefresh(response: Response): void {
    const token = response.headers.get(REFRESH_HEADER);
    if (!token || !this.session) return;
    const expiresRaw = response.headers.get(REFRESH_EXPIRES_HEADER);
    const expiresAt = Number(expiresRaw);
    this.session = {
      sessionToken: token,
      expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : this.session.expiresAt,
      user: this.session.user,
    };
    void this.notifySession(this.session);
  }
}
