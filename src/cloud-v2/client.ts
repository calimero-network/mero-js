/**
 * Client for the Calimero cloud (release-v2): one app = one replicated log on
 * attested nodes; this client verifies the node, seals every request to it,
 * signs people in with passkeys and machines with API keys.
 *
 * ```ts
 * const cloud = new CalimeroClient({ baseUrl, policy: { verifyQuote } });
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

  private async request(method: string, path: string, body?: unknown, raw?: Uint8Array): Promise<Response> {
    const headers: Record<string, string> = {};
    if (this.auth) headers.authorization = `Bearer ${this.auth}`;
    let payload: BodyInit | undefined;
    if (raw) {
      headers['content-type'] = 'application/wasm';
      payload = raw as unknown as BodyInit;
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    return this.sealed(`${this.base}/${path}`, { method, headers, body: payload });
  }

  private async json<T>(method: string, path: string, body?: unknown, raw?: Uint8Array): Promise<T> {
    const response = await this.request(method, path, body, raw);
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

  async uploadBundle(wasm: Uint8Array): Promise<string> {
    const { hash } = await this.json<{ hash: string }>('POST', 'bundles', undefined, wasm);
    return hash;
  }

  /** Upload a blob for `app`: `blobId` is base58 (what apps print), `id` hex. */
  uploadBlob(app: string, data: Uint8Array): Promise<{ blobId: string; id: string; size: number }> {
    return this.json('POST', `apps/${app}/blobs`, undefined, data);
  }

  /** One of `app`'s blobs, by id (base58 or hex). */
  async downloadBlob(app: string, id: string): Promise<Uint8Array> {
    const response = await this.request('GET', `apps/${app}/blobs/${id}`);
    if (!response.ok) {
      const text = await response.text();
      const value = text ? JSON.parse(text) : {};
      throw new CalimeroError(response.status, value.error ?? 'ERROR', value.message ?? '', value.details ?? {});
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async createApp(
    name: string,
    bundle: string,
    options: {
      org?: string;
      access?: Record<string, unknown>;
      confirmMethods?: string[];
      /** Arguments for the app's `init`. A failed init rejects with code `INIT_FAILED`. */
      initArgs?: unknown;
    } = {},
  ): Promise<string> {
    const { appId } = await this.post<{ appId: string }>('apps', { name, bundle, ...options });
    return appId;
  }

  /** Call a method. A retry with the same `idempotencyKey` is answered once. */
  call(app: string, method: string, args: unknown = {}, idempotencyKey?: string): Promise<CallResult> {
    return this.post(`apps/${app}/intents`, { method, args, idempotencyKey });
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
      return this.post(`apps/${app}/intents`, {
        method,
        args,
        idempotencyKey,
        confirm: { challengeId: d.challengeId, assertion },
      });
    }
  }

  /** Run a read-only method: strong by default, or stale from any replica. */
  view(app: string, method: string, args: unknown = {}, options: { stale?: boolean; minIndex?: number } = {}): Promise<ViewResult> {
    return this.post(`apps/${app}/views`, {
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
    const response = await this.sealed(`${this.base}/apps/${app}/events?from=${from}`, { headers, signal });
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

  async createTeam(org: string, name: string, join: 'everyone' | 'invite', parent?: string): Promise<string> {
    const { teamId } = await this.post<{ teamId: string }>(`orgs/${org}/teams`, { name, join, parent });
    return teamId;
  }

  async invite(org: string, role: 'guest' | 'member' | 'admin', teams: string[] = []): Promise<string> {
    const { token } = await this.post<{ token: string }>(`orgs/${org}/invites`, { role, teams });
    return token;
  }

  redeemInvite(token: string): Promise<Record<string, unknown>> {
    return this.post(`invites/${token}/redeem`);
  }

  removeMember(org: string, account: string): Promise<Record<string, unknown>> {
    return this.delete(`orgs/${org}/members/${account}`);
  }
}
