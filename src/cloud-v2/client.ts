/**
 * Client for the Calimero cloud (release-v2): one app = one replicated log on
 * attested nodes; this client verifies the node, seals every request to it,
 * signs people in with passkeys and machines with API keys.
 *
 * ```ts
 * const cloud = new CalimeroClient({ baseUrl, policy: { release: { minReleaseVersion: '2.3.109' } } });
 * await cloud.signIn(browserPasskey());
 * const { result } = await cloud.call(appId, 'set', { key: 'a', value: '1' });
 * ```
 */

import { hex } from '../crypto/internal.js';
import { SealedTransportError, createSealedFetch } from '../sealed/sealed.js';
import { fetchAttestedKey, type CloudPolicy } from './attestation.js';
import { CalimeroError, ConfirmCancelled, ConfirmRequired, UnavailableError, errorFrom } from './errors.js';
import { fromB64url, type PasskeyProvider } from './passkey.js';

export {
  AppError,
  ArgsTooLarge,
  CalimeroError,
  ConfirmCancelled,
  ConfirmRequired,
  IdempotencyMismatch,
  LoginRequired,
  NotFound,
  TrapError,
  UnavailableError,
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

/**
 * A key for a call the caller gave none, made once so every retry shares it.
 * `getRandomValues`, not `randomUUID`, which a page outside a secure context lacks.
 */
function newIdempotencyKey(): string {
  return hex(crypto.getRandomValues(new Uint8Array(16)));
}

/** How a 503 is retried (D70): with the same key, exponential backoff, at most this many times. */
export interface CloudRetryOptions {
  /** Retries after the first attempt. Default 3. */
  retries?: number;
  /** The first backoff; each retry doubles it. Default 250 ms. */
  baseDelayMs?: number;
}

export interface CalimeroClientOptions {
  /** One node of the cluster. */
  baseUrl: string;
  policy: CloudPolicy;
  /** Fetch that carries attestation and envelopes. Defaults to global `fetch`. */
  fetch?: typeof fetch;
  /** How calls and views retry a 503. */
  retry?: CloudRetryOptions;
}

export class CalimeroClient {
  private readonly base: string;
  private readonly sealed: typeof fetch;
  private auth: string | undefined;
  private current: CalimeroSession | undefined;
  private readonly retries: number;
  private readonly baseDelayMs: number;

  constructor(options: CalimeroClientOptions) {
    this.base = options.baseUrl.replace(/\/+$/, '');
    this.retries = options.retry?.retries ?? 3;
    this.baseDelayMs = options.retry?.baseDelayMs ?? 250;
    const raw = options.fetch ?? ((input, init) => fetch(input, init));
    this.sealed = createSealedFetch({
      baseUrl: this.base,
      transportPublicKey: () => fetchAttestedKey(this.base, options.policy, raw),
      fetch: raw,
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

  private async request(
    method: string,
    path: string,
    body?: unknown,
    raw?: Uint8Array,
    contentType = 'application/wasm',
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
    try {
      return await this.sealed(`${this.base}/${path}`, { method, headers, body: payload });
    } catch (error) {
      throw sealedError(error);
    }
  }

  private async json<T>(
    method: string,
    path: string,
    body?: unknown,
    raw?: Uint8Array,
    contentType?: string,
  ): Promise<T> {
    const response = await this.request(method, path, body, raw, contentType);
    if (!response.ok) throw await refusal(response);
    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  /**
   * {@link json} for a call or a view: a 503 is sent again, the same request
   * with the same idempotency key, after an exponential backoff (or the pause
   * the node asked for, if longer), at most `retries` times (D70). Every other
   * status is final. The last 503 surfaces as {@link UnavailableError}.
   */
  private async retried<T>(method: string, path: string, body: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.json<T>(method, path, body);
      } catch (error) {
        if (!(error instanceof UnavailableError) || attempt >= this.retries) throw error;
        const backoff = this.baseDelayMs * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, Math.max(backoff, (error.retryAfter ?? 0) * 1000)));
      }
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

  /** Swap the refresh token for a new session. */
  async refresh(): Promise<CalimeroSession> {
    if (!this.current) throw new Error('no session to refresh');
    const session = await this.post<CalimeroSession>('auth/refresh', { refreshToken: this.current.refreshToken });
    this.useSession(session);
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
    const response = await this.request('GET', `apps/${seg(app)}/blobs/${seg(id)}`);
    if (!response.ok) throw await refusal(response);
    return new Uint8Array(await response.arrayBuffer());
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

  /**
   * Move an app to another release of its package (`{ version }`), another
   * package, or a bundle hash, running its migration. Answers the upgrade's
   * entry; a failed migration rejects with code `UPGRADE_FAILED` (422).
   * Where the owner holds app upgrades, the node asks for the owner's approval
   * (`412 CONFIRM_REQUIRED`), which `passkey` gives.
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
    return this.confirmed<CallResult>('POST', path, { method, args, idempotencyKey: key }, passkey, (body) =>
      this.retried<CallResult>('POST', path, body),
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
  async *events(app: string, from = 0, signal?: AbortSignal): AsyncGenerator<CloudEvent> {
    const headers: Record<string, string> = {};
    if (this.auth) headers.authorization = `Bearer ${this.auth}`;
    const response = await this.sealed(`${this.base}/apps/${seg(app)}/events?from=${from}`, { headers, signal });
    if (!response.ok) throw await refusal(response);
    if (!response.body) throw new CalimeroError(response.status, 'EVENTS', 'the event stream has no body');
    const reader = response.body.getReader();
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

  async deleteAlias(alias: string): Promise<void> {
    await this.delete(`auth/aliases/${seg(alias)}`);
  }

  // ---------------------------------------------------------------- organizations

  async createOrg(name: string): Promise<string> {
    const { orgId } = await this.post<{ orgId: string }>('orgs', { name });
    return orgId;
  }

  /** The organization, with the teams this caller reaches or manages. */
  getOrg(org: string): Promise<Record<string, unknown>> {
    return this.get(`orgs/${seg(org)}`);
  }

  /**
   * Delete an organization with its teams, invites and apps (its owner only).
   * The node asks for the owner's passkey (`412 CONFIRM_REQUIRED`), which `passkey` gives.
   */
  async deleteOrg(org: string, passkey: PasskeyProvider): Promise<void> {
    await this.deleteConfirmed(`orgs/${seg(org)}`, passkey);
  }

  /** Add a member, or change their role. */
  async setMember(org: string, account: string, role: 'guest' | 'member' | 'admin' | 'owner'): Promise<void> {
    await this.post(`orgs/${seg(org)}/members`, { account, role });
  }

  removeMember(org: string, account: string): Promise<Record<string, unknown>> {
    return this.delete(`orgs/${seg(org)}/members/${seg(account)}`);
  }

  /**
   * Set v1's capability bits: for a member (`account`), for a member of one
   * team (`account` and `team`), or the organization's default (neither).
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
