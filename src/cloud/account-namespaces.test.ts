import { describe, it, expect } from 'vitest';

import { CloudClient } from './cloud-client.js';
import { routingProofHeaders } from './routing-proof.js';

/**
 * Listing an account's namespaces with a device certificate.
 *
 * The credential and key are the same fixture `routing-proof.test.ts` uses and
 * MDMA's `tests/test_discovery_proof.py` pins, so the two repos stay agreed on
 * the certificate layout and the signing domain.
 *
 * What is worth testing here is not the mapping -- it is that the read is
 * PROVEN. A discovery call that silently went out unproven would come back 401
 * from a correctly configured cloud and, worse, would look like it worked
 * against one where the gate was ever relaxed.
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

describe('getAccountNamespaces', () => {
  it('fetches a challenge and sends the proof headers with the read', async () => {
    const { fetch, calls } = scriptedFetch([
      { body: { account_id: ACCOUNT, nonce: NONCE, expires_at_ms: 1 } },
      { body: { account_id: ACCOUNT, namespaces: [{ namespace_id: 'aa', updated_at: '2026-01-01T00:00:00' }] } },
    ]);

    const out = await client(fetch).getAccountNamespaces(ACCOUNT);

    expect(calls[0].url).toContain(`/api/cloud/accounts/${ACCOUNT}/challenge`);
    expect(calls[1].url).toContain(`/api/cloud/accounts/${ACCOUNT}/namespaces`);

    // The whole point: the read is proven, with the nonce from THIS challenge.
    const expected = await routingProofHeaders(
      { accountId: ACCOUNT, nonce: NONCE, expiresAtMs: 1 },
      { credential: CREDENTIAL, deviceSecret: DEVICE_SECRET },
    );
    expect(headerOf(calls[1].init, 'X-Calimero-Credential')).toBe(CREDENTIAL);
    expect(headerOf(calls[1].init, 'X-Calimero-Nonce')).toBe(NONCE);
    expect(headerOf(calls[1].init, 'X-Calimero-Signature')).toBe(
      expected['X-Calimero-Signature'],
    );

    expect(out).toEqual([{ namespaceId: 'aa', updatedAt: '2026-01-01T00:00:00' }]);
  });

  it('throws without a credential rather than reading unproven', async () => {
    // "You configured no credential" and "this account has no namespaces" are
    // different answers; returning [] for the first would hide a misconfigured
    // client behind a plausible empty state.
    const { fetch, calls } = scriptedFetch([]);
    await expect(client(fetch, false).getAccountNamespaces(ACCOUNT)).rejects.toThrow(
      /routingCredential/,
    );
    expect(calls).toHaveLength(0);
  });

  it('reports no namespaces as an empty list, not as a failure', async () => {
    const { fetch } = scriptedFetch([
      { body: { account_id: ACCOUNT, nonce: NONCE, expires_at_ms: 1 } },
      { body: { account_id: ACCOUNT, namespaces: [] } },
    ]);
    expect(await client(fetch).getAccountNamespaces(ACCOUNT)).toEqual([]);
  });

  it('keeps a missing updated_at as null rather than inventing a time', async () => {
    // The caller uses this to judge staleness, so a fabricated timestamp would
    // be worse than an absent one.
    const { fetch } = scriptedFetch([
      { body: { account_id: ACCOUNT, nonce: NONCE, expires_at_ms: 1 } },
      { body: { account_id: ACCOUNT, namespaces: [{ namespace_id: 'bb' }] } },
    ]);
    expect(await client(fetch).getAccountNamespaces(ACCOUNT)).toEqual([
      { namespaceId: 'bb', updatedAt: null },
    ]);
  });

  it('a discovery challenge signs the same way a routing one does', async () => {
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
