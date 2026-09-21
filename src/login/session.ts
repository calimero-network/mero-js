/**
 * Obtain a session on a node using only a device key — the handshake around
 * {@link signLoginStatement}.
 *
 * Signing a statement was never the whole job. A client also has to fetch a
 * challenge, mint a session keypair, assemble a request body whose shape it
 * cannot see from here, and read a token out of the reply. Until now every
 * consumer wrote those two HTTP calls by hand, which is how the same three
 * mistakes kept being available to make:
 *
 * 1. **Asking for permissions.** `POST /auth/token` takes an optional
 *    `permissions` list. Left unset, the node grants the account-proof
 *    provider's own scopes — `context:intent`, `context:query`,
 *    `context:subscribe` — which are the whole delegated surface and
 *    deliberately nothing above it. This module never sends the field.
 *    `authenticate()` in this same package hardcodes `['admin']` (#84); a
 *    device-key session would be refused for that and should never ask.
 * 2. **Learning the node's key from the node.** {@link LoginConfig.node} is
 *    required and has no default, because a value read from the challenge
 *    response would let whoever answered choose what the device signs about.
 *    That is the whole attack the field exists to stop, so the awkwardness of
 *    having to supply it is the point rather than something to smooth away.
 * 3. **Losing the refresh token.** A browser tab outlives a short-lived
 *    session, so both tokens are returned. Nothing here refreshes on a timer
 *    (#87, #88 track that); this only makes it possible without a second
 *    breaking change.
 *
 * **The session key never leaves.** It is minted here, the device key signs
 * over it once, and the secret half is handed back to the caller. That is what
 * keeps a device key off the wire for the life of a session: a leaked token
 * cannot be escalated into use of the key that authorised it.
 */

import { HTTPError } from '../http-client/web-client.js';
import { derivePublicKey, hex } from '../crypto/internal.js';
import { signLoginStatement, type Audience } from './login.js';
import { resolveSigner, type Signer } from '../signer/signer.js';

/** Seconds a statement stays valid unless told otherwise. */
const DEFAULT_TTL_SECONDS = 300;

/** A freshly minted ephemeral keypair, hex-encoded. */
export interface SessionKeyPair {
  /** The public half — what the statement is signed over. */
  publicKey: string;
  /** The private half. Held by the caller; never sent anywhere. */
  secret: string;
}

/**
 * Mint the ephemeral keypair a session speaks with.
 *
 * An ed25519 secret *is* 32 random bytes, so this needs no key generation
 * ceremony — `getRandomValues` and the same derivation every other signer here
 * uses. Exported because a caller that wants to persist a session across a page
 * reload needs to mint the pair itself and keep the secret.
 */
export async function generateSessionKey(): Promise<SessionKeyPair> {
  const secret = hex(crypto.getRandomValues(new Uint8Array(32)));
  return { publicKey: hex(await derivePublicKey(secret)), secret };
}

/** What a device needs in order to ask for a session. */
export interface LoginConfig {
  /** The node's base URL, e.g. `https://node.example`. */
  nodeUrl: string;
  /**
   * The node's device signing key, hex (32 bytes), **as this client pinned it**.
   *
   * Learn it out of band — from the node's operator, or a certificate you
   * already trust. Never from the node you are about to log in to: see the
   * module note.
   */
  node: string;
  /**
   * The device's ed25519 signing secret, hex (32 bytes). Never sent.
   *
   * Mutually exclusive with {@link LoginConfig.signer}, and the weaker of the
   * two in a browser — see {@link Signer}.
   */
  deviceSecret?: string;
  /**
   * The device's signer — use instead of {@link LoginConfig.deviceSecret} when
   * the key cannot be exported to hex.
   */
  signer?: Signer;
  /**
   * The device's account proof, hex — the credential certifying that this
   * device belongs to its account.
   *
   * Travels beside the statement and is what settles *which account* is asking.
   * The statement alone proves only that a device key asked, so logging in
   * without this yields a 401 that looks exactly like a bad signature.
   */
  accountProof: string;
  /** The client surface this session is bound to. */
  audience: Audience;
  /**
   * How this client names itself to the node. Defaults to the audience's own
   * spelling, which is the honest answer: a session bound to an origin should
   * say that origin.
   */
  clientName?: string;
  /** Seconds the statement stays valid. Defaults to {@link DEFAULT_TTL_SECONDS}. */
  ttlSeconds?: number;
  /** Injectable for tests and non-browser runtimes. */
  fetch?: typeof fetch;
  /** Per-request timeout. Defaults to 10s. */
  timeoutMs?: number;
}

/** A session minted without a password. */
export interface DelegatedSession {
  /** Bearer token for the delegated surface. */
  accessToken: string;
  /** Presented to renew the access token. See #87/#88 — nothing here schedules it. */
  refreshToken: string;
  /** The session's public half, as the node knows it. */
  sessionKey: string;
  /** The session's private half. The caller keeps this; it was never sent. */
  sessionSecret: string;
}

/** The audience's own spelling, used as the default client name. */
function audienceLabel(audience: Audience): string {
  switch (audience.kind) {
    case 'webOrigin':
      return audience.origin;
    case 'codeSigningId':
      return audience.id;
    case 'cli':
      return 'cli';
  }
}

/**
 * Log in with a device key and return the session.
 *
 * The challenge is fetched immediately before signing on purpose: it is
 * single-use and short-lived, so a statement minted against a stale one is
 * refused before any signature work is done.
 *
 * @throws {HTTPError} if the node refuses the challenge or the token request.
 */
export async function login(config: LoginConfig): Promise<DelegatedSession> {
  const baseUrl = config.nodeUrl.replace(/\/+$/, '');
  const doFetch = config.fetch ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? 10_000;

  const request = async (path: string, init?: RequestInit): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
    } catch (err) {
      throw new HTTPError(
        0,
        err instanceof Error ? err.name : 'NetworkError',
        `${baseUrl}${path}`,
        new Headers(),
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text().catch(() => '');
    if (!response.ok) {
      throw new HTTPError(
        response.status,
        response.statusText,
        `${baseUrl}${path}`,
        response.headers,
        text,
      );
    }
    return text ? (JSON.parse(text) as unknown) : {};
  };

  const challengeBody = (await request('/auth/challenge', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })) as { challenge?: string; data?: { challenge?: string } };
  // The node has spelled this both bare and wrapped in `data`; accept either
  // rather than couple a login to one envelope revision.
  const challenge = challengeBody.challenge ?? challengeBody.data?.challenge;
  if (!challenge) {
    throw new Error('the node issued no challenge');
  }

  const session = await generateSessionKey();
  const issuedAt = Math.floor(Date.now() / 1000);
  const statement = await signLoginStatement({
    node: config.node,
    audience: config.audience,
    challenge,
    sessionKey: session.publicKey,
    issuedAt,
    expiresAt: issuedAt + (config.ttlSeconds ?? DEFAULT_TTL_SECONDS),
    // Resolved once and handed on, so a config carrying a secret and a config
    // carrying a `CryptoKey` take exactly the same path from here down.
    signer: await resolveSigner(config.deviceSecret, config.signer, 'deviceSecret'),
  });

  // `timestamp` is required and the request refuses unknown fields, so a body
  // missing it is rejected during deserialization — before the provider runs,
  // and with an error that names the request shape rather than the login.
  //
  // `permissions` is omitted, not empty: see the module note.
  const tokenBody = (await request('/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      auth_method: 'account_proof',
      public_key: session.publicKey,
      client_name: config.clientName ?? audienceLabel(config.audience),
      timestamp: issuedAt,
      provider_data: {
        challenge,
        login_statement: statement,
        account_proof: config.accountProof,
      },
    }),
  })) as {
    access_token?: string;
    refresh_token?: string;
    data?: { access_token?: string; refresh_token?: string };
  };

  const accessToken = tokenBody.access_token ?? tokenBody.data?.access_token;
  const refreshToken = tokenBody.refresh_token ?? tokenBody.data?.refresh_token;
  if (!accessToken) {
    throw new Error('the node minted no session');
  }

  return {
    accessToken,
    refreshToken: refreshToken ?? '',
    sessionKey: session.publicKey,
    sessionSecret: session.secret,
  };
}
