import { describe, it, expect } from 'vitest';

import { CloudClient } from './cloud-client.js';
import { routingProofHeaders, signRoutingChallenge } from './routing-proof.js';

/**
 * The credential and device key from MDMA's `tests/test_routing_proof.py`.
 *
 * That fixture was generated *by this SDK* so the Python could not agree with
 * itself. Pinning the same key here closes the loop in the other direction: the
 * expected signature below was produced by MDMA's own verifier library, so a
 * change to this SDK's domain, encoding or key handling turns this red rather
 * than turning a deploy red.
 */
const CREDENTIAL =
  '02d2fa6fe39efba7493f76ad6efc0e7996d831eb1a0ce6fda707397fe2c012c6060000000038701bbfdcbc1c30a0674e5e374a051bd22d22fffd1059be29148ce1f2c227526c23496a85d5a2d25942c3196928d927e0074d01f73688cfd18c1943318ee66c236a93514a84577e9324eda015da3a8fb280b54a534d93ca2ab70f1eb5c77ed493e7d2ea8a91f18655f5c52a00ed0185d5cf4d45a27aa66b39ad3f2d41e6876a000000000100000093449921849d2388e7281f85c7382f6c8f1da95a7246ef17698428a4e9388541c8712acbaf3534ff6efcc89da0ff3c88534eb08537838dccd364743ce7ffd90a';
const DEVICE_SECRET = 'ef26085f1651bd1f4bba0832bf981c93cc00de33a037fb432b49b5fd4d552c88';

const NONCE = 'test-nonce-abc';
const EXPECTED_SIGNATURE =
  'h5qmCVwG9B8Kgi1Fb0ipYgtQr6BsKM/MCPJfjpaR9UfmO+xDe3asjzvHvFraP/Ph5At9i2+ST2hGY9bTH8CyDQ==';

const NS = 'aa'.repeat(32);

/** A `fetch` that answers a scripted queue and records what it was asked. */
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

describe('signRoutingChallenge', () => {
  it('produces the signature MDMA verifies', async () => {
    // Ed25519 is deterministic, so this is an equality and not a round-trip:
    // a domain, encoding or key-import change moves the bytes and is caught.
    expect(await signRoutingChallenge(NONCE, DEVICE_SECRET)).toBe(EXPECTED_SIGNATURE);
  });

  it('signs the nonce, not a hash of it', async () => {
    // The cloud checks `DOMAIN ‖ nonce` against the raw message. Hashing first
    // -- which this SDK does everywhere else -- would verify nowhere.
    const other = await signRoutingChallenge('test-nonce-abd', DEVICE_SECRET);
    expect(other).not.toBe(EXPECTED_SIGNATURE);
  });

  it('refuses a device secret that is not 32 bytes', async () => {
    await expect(signRoutingChallenge(NONCE, 'ef26')).rejects.toThrow(/deviceSecret/);
  });
});

describe('routingProofHeaders', () => {
  it('carries the certificate and the nonce beside the signature', async () => {
    const headers = await routingProofHeaders(
      { namespaceId: NS, nonce: NONCE, expiresAtMs: 0 },
      { credential: CREDENTIAL, deviceSecret: DEVICE_SECRET },
    );
    expect(headers).toEqual({
      'X-Calimero-Credential': CREDENTIAL,
      'X-Calimero-Nonce': NONCE,
      'X-Calimero-Signature': EXPECTED_SIGNATURE,
    });
  });
});

describe('CloudClient.getNamespaceRouting', () => {
  it('stays anonymous when no credential was configured', async () => {
    const { fetch, calls } = scriptedFetch([{ body: { admitters: [] } }]);
    const cloud = new CloudClient({ cloudBaseUrl: 'https://cloud.test', fetch });

    await cloud.getNamespaceRouting(NS);

    // One request, no challenge round-trip, and no proof headers: the read is
    // still answerable by a client built before the proof existed.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://cloud.test/api/cloud/namespaces/${NS}/admitters`);
    expect(headerOf(calls[0]?.init, 'X-Calimero-Credential')).toBeUndefined();
  });

  it('fetches a challenge and proves the account when one was', async () => {
    const { fetch, calls } = scriptedFetch([
      { body: { namespace_id: NS, nonce: NONCE, expires_at_ms: 1_800_000_000_000 } },
      { body: { namespace_id: NS, admitters: [], servable: false, writable: false } },
    ]);
    const cloud = new CloudClient({
      cloudBaseUrl: 'https://cloud.test',
      fetch,
      routingCredential: { credential: CREDENTIAL, deviceSecret: DEVICE_SECRET },
    });

    await cloud.getNamespaceRouting(NS);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe(`https://cloud.test/api/cloud/namespaces/${NS}/challenge`);
    expect(calls[1]?.url).toBe(`https://cloud.test/api/cloud/namespaces/${NS}/admitters`);
    expect(headerOf(calls[1]?.init, 'X-Calimero-Credential')).toBe(CREDENTIAL);
    expect(headerOf(calls[1]?.init, 'X-Calimero-Nonce')).toBe(NONCE);
    expect(headerOf(calls[1]?.init, 'X-Calimero-Signature')).toBe(EXPECTED_SIGNATURE);
  });

  it('proves the account on findAdmitter too', async () => {
    // `findAdmitter` is the method a joiner actually calls; it would be its own
    // anonymous hole if the proof lived only on the method beneath it.
    const { fetch, calls } = scriptedFetch([
      { body: { namespace_id: NS, nonce: NONCE, expires_at_ms: 1_800_000_000_000 } },
      { body: { namespace_id: NS, admitters: [] } },
    ]);
    const cloud = new CloudClient({
      cloudBaseUrl: 'https://cloud.test',
      fetch,
      routingCredential: { credential: CREDENTIAL, deviceSecret: DEVICE_SECRET },
    });

    expect(await cloud.findAdmitter(NS)).toBeNull();
    expect(headerOf(calls[1]?.init, 'X-Calimero-Signature')).toBe(EXPECTED_SIGNATURE);
  });

  it('never lets a proof header displace the session token', async () => {
    // The proof and a cloud login are independent, and a routing read carries
    // no `Authorization` at all -- but the header merge is where a future
    // caller-supplied header could quietly shadow one, so pin the precedence.
    const { fetch, calls } = scriptedFetch([
      { body: { namespace_id: NS, nonce: NONCE, expires_at_ms: 1_800_000_000_000 } },
      { body: { namespace_id: NS, admitters: [] } },
    ]);
    const cloud = new CloudClient({
      cloudBaseUrl: 'https://cloud.test',
      fetch,
      sessionToken: 'session-1',
      routingCredential: { credential: CREDENTIAL, deviceSecret: DEVICE_SECRET },
    });

    await cloud.getNamespaceRouting(NS);

    expect(headerOf(calls[1]?.init, 'Authorization')).toBeUndefined();
    expect(headerOf(calls[1]?.init, 'Accept')).toBe('application/json');
  });
});
