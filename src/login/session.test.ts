/**
 * The handshake, against a stub node.
 *
 * The assertions that matter are not "did it return a token" but the two
 * properties this module exists to hold: it must never ask for permissions, and
 * it must never take the node's identity from the node.
 */

import { describe, expect, it, vi } from 'vitest';

import { generateSessionKey, login } from './session.js';

const DEVICE_SECRET = '09'.repeat(32);
const NODE = '11'.repeat(32);
const CHALLENGE = '22'.repeat(32);
const ACCOUNT_PROOF = 'ab'.repeat(60);

/** A node that answers both calls, recording what it was asked. */
function stubNode(overrides: { challengeBody?: unknown; tokenBody?: unknown } = {}) {
  const calls: { url: string; body?: unknown }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    const payload = url.endsWith('/auth/challenge')
      ? (overrides.challengeBody ?? { challenge: CHALLENGE })
      : (overrides.tokenBody ?? {
          access_token: 'access-tok',
          refresh_token: 'refresh-tok',
        });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const config = (fetchImpl: typeof fetch) => ({
  nodeUrl: 'https://node.example',
  node: NODE,
  deviceSecret: DEVICE_SECRET,
  accountProof: ACCOUNT_PROOF,
  audience: { kind: 'cli' as const },
  fetch: fetchImpl,
});

describe('generateSessionKey', () => {
  it('mints a distinct 32-byte pair each time', async () => {
    const a = await generateSessionKey();
    const b = await generateSessionKey();
    expect(a.secret).toHaveLength(64);
    expect(a.publicKey).toHaveLength(64);
    expect(a.secret).not.toBe(b.secret);
    expect(a.publicKey).not.toBe(b.publicKey);
  });
});

describe('login', () => {
  it('returns both tokens and keeps the session secret', async () => {
    const { fetchImpl } = stubNode();
    const session = await login(config(fetchImpl));
    expect(session.accessToken).toBe('access-tok');
    expect(session.refreshToken).toBe('refresh-tok');
    expect(session.sessionSecret).toHaveLength(64);
    expect(session.sessionKey).toHaveLength(64);
  });

  /**
   * The point of the module. An `account_proof` session carries
   * `context:intent`, `context:query` and `context:subscribe`; asking for
   * anything is either refused or over-broad, and #84 is this mistake already
   * made once in `authenticate()`.
   */
  it('never asks for permissions', async () => {
    const { fetchImpl, calls } = stubNode();
    await login(config(fetchImpl));
    const token = calls.find((c) => c.url.endsWith('/auth/token'));
    expect(token?.body).toBeDefined();
    expect(Object.keys(token!.body as object)).not.toContain('permissions');
  });

  /** Required, and `deny_unknown_fields` means a missing one is a 4xx. */
  it('sends the timestamp the node requires', async () => {
    const { fetchImpl, calls } = stubNode();
    await login(config(fetchImpl));
    const token = calls.find((c) => c.url.endsWith('/auth/token'));
    expect(typeof (token!.body as { timestamp: unknown }).timestamp).toBe('number');
  });

  /**
   * The statement must be signed over the key the request names, or the node
   * refuses it — and confusingly, since the signature itself is valid.
   */
  it('signs over the session key it presents', async () => {
    const { fetchImpl, calls } = stubNode();
    const session = await login(config(fetchImpl));
    const token = calls.find((c) => c.url.endsWith('/auth/token'));
    const body = token!.body as { public_key: string; provider_data: { login_statement: string } };
    expect(body.public_key).toBe(session.sessionKey);
    // The statement's session_key field sits after node + audience tag.
    expect(body.provider_data.login_statement).toContain(session.sessionKey);
  });

  /**
   * The node's identity is a caller input. If this ever read it from the
   * challenge response, whoever answered would choose what the device signs
   * about — the exact replay the `node` field exists to refuse.
   */
  it('takes the node key from the caller, not the challenge response', async () => {
    const { fetchImpl, calls } = stubNode({
      challengeBody: { challenge: CHALLENGE, node: 'ff'.repeat(32) },
    });
    await login(config(fetchImpl));
    const token = calls.find((c) => c.url.endsWith('/auth/token'));
    const statement = (token!.body as { provider_data: { login_statement: string } })
      .provider_data.login_statement;
    expect(statement.startsWith(NODE)).toBe(true);
    expect(statement.startsWith('ff'.repeat(32))).toBe(false);
  });

  it('accepts a challenge wrapped in a data envelope', async () => {
    const { fetchImpl } = stubNode({ challengeBody: { data: { challenge: CHALLENGE } } });
    await expect(login(config(fetchImpl))).resolves.toBeDefined();
  });

  it('refuses when the node issues no challenge', async () => {
    const { fetchImpl } = stubNode({ challengeBody: {} });
    await expect(login(config(fetchImpl))).rejects.toThrow(/no challenge/);
  });

  it('refuses when no session is minted', async () => {
    const { fetchImpl } = stubNode({ tokenBody: {} });
    await expect(login(config(fetchImpl))).rejects.toThrow(/minted no session/);
  });
});
