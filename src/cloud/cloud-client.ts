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

import { HTTPError } from '../http-client/web-client.js';

/** Where the hosted cloud lives when a caller names no other. */
const DEFAULT_CLOUD_BASE_URL = 'https://cloud.calimero.network';

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
  /** `'assigned'` (admitted pending confirm) or `'active'`. */
  status: string;
  /** Whether this relay holds `CAN_AUTHOR_ON_BEHALF` on the namespace. */
  authorshipReady: boolean;
  lastSeenAt?: string | null;
  confirmedAt?: string | null;
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
    options: { body?: unknown; anonymous?: boolean; parse?: 'json' | 'none' } = {},
  ): Promise<T> {
    if (!options.anonymous && !this.session) {
      throw new Error(
        'Not signed in to Calimero Cloud: call signInWithGoogle() or construct the client with a sessionToken',
      );
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
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
