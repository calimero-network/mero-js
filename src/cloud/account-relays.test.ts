import { describe, it, expect } from 'vitest';

import { CloudClient } from './cloud-client.js';
import { routingProofHeaders } from './routing-proof.js';

/**
 * Finding the relays that serve an account, with a device certificate.
 *
 * The credential and key are the fixture `routing-proof.test.ts` uses and
 * MDMA's `tests/test_discovery_proof.py` pins, so both repos stay agreed on the
 * certificate layout and the signing domain.
 *
 * What earns a test here is not the field mapping — it is that the read is
 * PROVEN, that the two challenge kinds stay interchangeable only where they are
 * meant to be, and that an unusable relay is reported rather than swallowed.
 */
const CREDENTIAL =
  '02d2fa6fe39efba7493f76ad6efc0e7996d831eb1a0ce6fda707397fe2c012c6060000000038701bbfdcbc1c30a0674e5e374a051bd22d22fffd1059be29148ce1f2c227526c23496a85d5a2d25942c3196928d927e0074d01f73688cfd18c1943318ee66c236a93514a84577e9324eda015da3a8fb280b54a534d93ca2ab70f1eb5c77ed493e7d2ea8a91f18655f5c52a00ed0185d5cf4d45a27aa66b39ad3f2d41e6876a000000000100000093449921849d2388e7281f85c7382f6c8f1da95a7246ef17698428a4e9388541c8712acbaf3534ff6efcc89da0ff3c88534eb08537838dccd364743ce7ffd90a';
const DEVICE_SECRET = 'ef26085f1651bd1f4bba0832bf981c93cc00de33a037fb432b49b5fd4d552c88';
const ACCOUNT = '38701bbfdcbc1c30a0674e5e374a051bd22d22fffd1059be29148ce1f2c22752';
const NONCE = 'test-discovery-nonce';

function scriptedFetch(responses: Array<{ status?: number; body?: unknown }>): {
  fetch: typeof fetch;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const queue = [...responses];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = queue.shift();
    if (!next) throw new Error('unexpected extra fetch');
    return new Response(JSON.stringify(next.body ?? {}), {
      status: next.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.[name];
}

function client(fetchImpl: typeof fetch, withCredential = true) {
  return new CloudClient({
    baseUrl: 'https://cloud.example',
    fetch: fetchImpl,
    ...(withCredential
      ? { routingCredential: { credential: CREDENTIAL, deviceSecret: DEVICE_SECRET } }
      : {}),
  });
}

const challengeBody = { account_id: ACCOUNT, nonce: NONCE, expires_at_ms: 1 };

describe('getAccountRelays', () => {
  it('fetches a challenge and proves the read with it', async () => {
    const { fetch, calls } = scriptedFetch([
      { body: challengeBody },
      {
        body: {
          account_id: ACCOUNT,
          relays: [{ peer_id: 'peer-a', relay_url: 'https://a.example', fresh: true }],
        },
      },
    ]);

    const out = await client(fetch).getAccountRelays(ACCOUNT);

    expect(calls[0].url).toContain(`/api/cloud/accounts/${ACCOUNT}/challenge`);
    expect(calls[1].url).toContain(`/api/cloud/accounts/${ACCOUNT}/relays`);

    const expected = await routingProofHeaders(
      { accountId: ACCOUNT, nonce: NONCE, expiresAtMs: 1 },
      { credential: CREDENTIAL, deviceSecret: DEVICE_SECRET },
    );
    expect(headerOf(calls[1].init, 'X-Calimero-Credential')).toBe(CREDENTIAL);
    expect(headerOf(calls[1].init, 'X-Calimero-Nonce')).toBe(NONCE);
    expect(headerOf(calls[1].init, 'X-Calimero-Signature')).toBe(expected['X-Calimero-Signature']);

    expect(out).toEqual([{ peerId: 'peer-a', relayUrl: 'https://a.example', fresh: true }]);
  });

  it('throws without a credential rather than reading unproven', async () => {
    const { fetch, calls } = scriptedFetch([]);
    await expect(client(fetch, false).getAccountRelays(ACCOUNT)).rejects.toThrow(
      /routingCredential/,
    );
    expect(calls).toHaveLength(0);
  });

  it('reports a stale relay rather than dropping it', async () => {
    // "Your relay is down" and "you have no relay" need different actions, so
    // filtering here would destroy the distinction the server took care to make.
    const { fetch } = scriptedFetch([
      { body: challengeBody },
      { body: { relays: [{ peer_id: 'peer-a', relay_url: 'https://a.example', fresh: false }] } },
    ]);
    const out = await client(fetch).getAccountRelays(ACCOUNT);
    expect(out).toEqual([{ peerId: 'peer-a', relayUrl: 'https://a.example', fresh: false }]);
  });

  it('keeps a missing relay_url as null rather than an empty string', async () => {
    // A falsy-but-present URL would be dialled and fail; null is checkable.
    const { fetch } = scriptedFetch([
      { body: challengeBody },
      { body: { relays: [{ peer_id: 'peer-a', fresh: true }] } },
    ]);
    expect(await client(fetch).getAccountRelays(ACCOUNT)).toEqual([
      { peerId: 'peer-a', relayUrl: null, fresh: true },
    ]);
  });

  it('reports no relays as an empty list, not a failure', async () => {
    const { fetch } = scriptedFetch([{ body: challengeBody }, { body: { relays: [] } }]);
    expect(await client(fetch).getAccountRelays(ACCOUNT)).toEqual([]);
  });

  it('signs a discovery challenge exactly as it signs a routing one', async () => {
    // Same domain by design, so a client needs no second constant. What keeps
    // them apart is what MDMA sealed inside, checked server-side.
    const a = await routingProofHeaders(
      { accountId: ACCOUNT, nonce: NONCE, expiresAtMs: 0 },
      { credential: CREDENTIAL, deviceSecret: DEVICE_SECRET },
    );
    const b = await routingProofHeaders(
      { namespaceId: 'aa'.repeat(32), nonce: NONCE, expiresAtMs: 0 },
      { credential: CREDENTIAL, deviceSecret: DEVICE_SECRET },
    );
    expect(a['X-Calimero-Signature']).toBe(b['X-Calimero-Signature']);
  });
});
