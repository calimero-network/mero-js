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

import { createSealedFetch } from '../sealed/sealed.js';
import { fetchAttestedKey, type CloudPolicy } from './attestation.js';
import { fromB64url, type PasskeyProvider } from './passkey.js';

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

export class CalimeroError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(`${status} ${code}: ${message}`);
    this.name = 'CalimeroError';
  }
}

export interface CalimeroClientOptions {
  /** One node of the cluster. */
  baseUrl: string;
  policy: CloudPolicy;
  /** Fetch that carries attestation and envelopes. Defaults to global `fetch`. */
  fetch?: typeof fetch;
}

export class CalimeroClient {
  private readonly base: string;
  private readonly sealed: typeof fetch;
  private auth: string | undefined;
  private current: CalimeroSession | undefined;

  constructor(options: CalimeroClientOptions) {
    this.base = options.baseUrl.replace(/\/+$/, '');
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
    return this.sealed(`${this.base}/${path}`, { method, headers, body: payload });
  }

  private async json<T>(
    method: string,
    path: string,
    body?: unknown,
    raw?: Uint8Array,
    contentType?: string,
  ): Promise<T> {
    const response = await this.request(method, path, body, raw, contentType);
    const text = await response.text();
    const value = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new CalimeroError(response.status, value.error ?? 'ERROR', value.message ?? '', value.details ?? {});
    }
    return value as T;
  }

  post<T = Record<string, unknown>>(path: string, body: unknown = {}): Promise<T> {
    return this.json<T>('POST', path, body);
  }

  get<T = Record<string, unknown>>(path: string): Promise<T> {
    return this.json<T>('GET', path);
  }

  delete<T = Record<string, unknown>>(path: string): Promise<T> {
    return this.json<T>('DELETE', path);
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
    if (!response.ok) {
      const text = await response.text();
      const value = text ? JSON.parse(text) : {};
      throw new CalimeroError(response.status, value.error ?? 'ERROR', value.message ?? '', value.details ?? {});
    }
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
   * package, or a bundle hash, running its migration. Answers the entry's status.
   */
  upgradeApp(
    app: string,
    target: { version?: string; package?: string; service?: string; bundle?: string; migrate?: string },
  ): Promise<{ index: number; status: string; error: unknown }> {
    return this.post(`apps/${seg(app)}/upgrade`, target);
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

  /** Call a method. A retry with the same `idempotencyKey` is answered once. */
  call(app: string, method: string, args: unknown = {}, idempotencyKey?: string): Promise<CallResult> {
    return this.post(`apps/${seg(app)}/intents`, { method, args, idempotencyKey });
  }

  /**
   * Call a method that needs the account holder's approval: the node returns a
   * challenge over this exact call, which `passkey` signs.
   */
  async callConfirmed(
    app: string,
    method: string,
    args: unknown,
    passkey: PasskeyProvider,
    idempotencyKey?: string,
  ): Promise<CallResult> {
    try {
      return await this.call(app, method, args, idempotencyKey);
    } catch (error) {
      if (!(error instanceof CalimeroError) || error.code !== 'CONFIRM_REQUIRED') throw error;
      const d = error.details as { challengeId: string; challenge: string; rpId: string; allowCredentials?: string[] };
      const assertion = await passkey.get(fromB64url(d.challenge), d.rpId, d.allowCredentials);
      return this.post(`apps/${seg(app)}/intents`, {
        method,
        args,
        idempotencyKey,
        confirm: { challengeId: d.challengeId, assertion },
      });
    }
  }

  /** Run a read-only method: strong by default, or stale from any replica. */
  view(app: string, method: string, args: unknown = {}, options: { stale?: boolean; minIndex?: number } = {}): Promise<ViewResult> {
    return this.post(`apps/${seg(app)}/views`, {
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
    if (!response.ok || !response.body) {
      throw new CalimeroError(response.status, 'EVENTS', 'event stream refused');
    }
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

  // ---------------------------------------------------------------- organizations

  async createOrg(name: string): Promise<string> {
    const { orgId } = await this.post<{ orgId: string }>('orgs', { name });
    return orgId;
  }

  /** The organization, with the teams this caller reaches or manages. */
  getOrg(org: string): Promise<Record<string, unknown>> {
    return this.get(`orgs/${seg(org)}`);
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
