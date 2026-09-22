import { describe, it, expect } from 'vitest';
import { connectCloud } from './connect.js';
import { createMemoryNonceSource } from '../relay/nonce-source.js';
import { signerFromCryptoKey, signerFromSecret } from '../signer/signer.js';

const PKCS8_ED25519_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04,
  0x22, 0x04, 0x20,
]);

/** The same seed as a key that signs and can never be exported. */
async function unexportableKey(secretHex: string): Promise<CryptoKey> {
  const pkcs8 = new Uint8Array(PKCS8_ED25519_PREFIX.length + 32);
  pkcs8.set(PKCS8_ED25519_PREFIX, 0);
  pkcs8.set(
    Uint8Array.from(secretHex.match(/../g) as string[], (b) => parseInt(b, 16)),
    PKCS8_ED25519_PREFIX.length,
  );
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
}

const NS = '01'.repeat(32);
const OTHER_NS = '02'.repeat(32);
const CONTEXT = '03'.repeat(32);
const AUTHOR = '0e'.repeat(32);
const EXECUTOR = '4d'.repeat(32);
const GROUP = 'ab'.repeat(32);
const DEVICE_SECRET = '77'.repeat(32);

/** Routes by URL so the cloud and relay calls can be scripted independently. */
function routedFetch(routes: Record<string, unknown>): {
  fetch: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const match = Object.keys(routes).find((prefix) => url.endsWith(prefix));
    if (!match) return new Response('not scripted', { status: 404 });
    return new Response(JSON.stringify(routes[match]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

const namespaceRow = (id: string, haStatus = 'enabled') => ({
  group_id: id,
  namespace_id: id,
  ha_status: haStatus,
  ha_enabled_at: null,
  contexts: [],
  fleet_replicas: {},
});

const readyRelay = {
  peer_id: '12D3KooWready',
  relay_url: 'https://relay.example',
  executor_account: EXECUTOR,
  status: 'active',
  authorship_ready: true,
};

function options(over: Record<string, unknown> = {}) {
  return {
    cloudBaseUrl: 'https://cloud.example',
    sessionToken: 'session-1',
    authorAccount: AUTHOR,
    authorProof: 'aa',
    deviceSecret: DEVICE_SECRET,
    // Explicit, so the test does not depend on whether the runtime has
    // localStorage — and so the sequence is inspectable.
    nonces: createMemoryNonceSource(1),
    ...over,
  };
}

describe('connectCloud', () => {
  it('signs in, finds the namespace and its relay, and can write', async () => {
    const { fetch, calls } = routedFetch({
      '/api/cloud/me/namespaces': [namespaceRow(NS)],
      [`/api/cloud/me/namespaces/${NS}/relays`]: { relays: [readyRelay] },
      [`/admin-api/contexts/${CONTEXT}/intents`]: {
        data: { rootHash: 'root-1', returns: 'ok' },
      },
    });

    const connection = await connectCloud(options({ fetch }));

    expect(connection.namespaceId).toBe(NS);
    expect(connection.relayInfo.executorAccount).toBe(EXECUTOR);

    const result = await connection.execute<string>(CONTEXT, 'set', { key: 'k' });
    expect(result).toEqual({ rootHash: 'root-1', returns: 'ok' });

    // The intent goes straight to the relay. The cloud is the directory and
    // never sees the method or the arguments — a proxied intent would hand it
    // the plaintext of every write its users make.
    expect(calls).toContain(`POST https://relay.example/admin-api/contexts/${CONTEXT}/intents`);
    expect(calls.some((c) => c.includes('cloud.example') && c.includes('/intents'))).toBe(false);
  });

  it('exchanges a Google ID token when no session token is held', async () => {
    const { fetch, calls } = routedFetch({
      '/api/auth/google': {
        session_token: 'session-fresh',
        expires_at: 1_800_000_000,
        user: { email: 'someone@example.com' },
      },
      '/api/cloud/me/namespaces': [namespaceRow(NS)],
      [`/api/cloud/me/namespaces/${NS}/relays`]: { relays: [readyRelay] },
    });

    const connection = await connectCloud(
      options({ fetch, sessionToken: undefined, googleIdToken: 'google-id-token' }),
    );

    expect(calls[0]).toBe('POST https://cloud.example/api/auth/google');
    expect(connection.cloud.getSession()?.sessionToken).toBe('session-fresh');
  });

  it('needs one credential or the other', async () => {
    await expect(
      connectCloud(options({ sessionToken: undefined })),
    ).rejects.toThrow(/sessionToken or a googleIdToken/);
  });

  /**
   * With several namespaces there is no defensible default: picking one would
   * land a write in another tenant of the same account's data rather than
   * failing.
   */
  it('refuses to guess between several owned namespaces', async () => {
    const { fetch } = routedFetch({
      '/api/cloud/me/namespaces': [namespaceRow(NS), namespaceRow(OTHER_NS)],
    });

    await expect(connectCloud(options({ fetch }))).rejects.toThrow(
      /owns 2 namespaces — pass namespaceId/,
    );
  });

  it('honours an explicit namespaceId and names the owned set when it is wrong', async () => {
    const { fetch } = routedFetch({
      '/api/cloud/me/namespaces': [namespaceRow(NS), namespaceRow(OTHER_NS)],
      [`/api/cloud/me/namespaces/${OTHER_NS}/relays`]: { relays: [readyRelay] },
    });

    await expect(
      connectCloud(options({ fetch, namespaceId: OTHER_NS })),
    ).resolves.toMatchObject({ namespaceId: OTHER_NS });

    const { fetch: fetch2 } = routedFetch({
      '/api/cloud/me/namespaces': [namespaceRow(NS)],
    });
    await expect(
      connectCloud(options({ fetch: fetch2, namespaceId: OTHER_NS })),
    ).rejects.toThrow(new RegExp(`owns no namespace ${OTHER_NS}`));
  });

  it('says to claim a namespace when the account owns none', async () => {
    const { fetch } = routedFetch({ '/api/cloud/me/namespaces': [] });
    await expect(connectCloud(options({ fetch }))).rejects.toThrow(/owns no namespaces/);
  });

  /**
   * The three no-relay states are three different asks of the user — turn HA
   * on, wait, or get an admin to grant a capability. One message for all of
   * them sends them to the wrong one.
   */
  it('says to enable HA when the namespace has no relays and HA is off', async () => {
    const { fetch } = routedFetch({
      '/api/cloud/me/namespaces': [namespaceRow(NS, 'none')],
      [`/api/cloud/me/namespaces/${NS}/relays`]: { relays: [] },
    });
    await expect(connectCloud(options({ fetch }))).rejects.toThrow(/enable HA on it in the cloud/);
  });

  it('says to retry when HA is on but nothing is assigned yet', async () => {
    const { fetch } = routedFetch({
      '/api/cloud/me/namespaces': [namespaceRow(NS, 'enabled')],
      [`/api/cloud/me/namespaces/${NS}/relays`]: { relays: [] },
    });
    await expect(connectCloud(options({ fetch }))).rejects.toThrow(
      /no relay has been assigned to it yet/,
    );
  });

  it('names the account an admin must grant when every relay lacks the capability', async () => {
    const { fetch } = routedFetch({
      '/api/cloud/me/namespaces': [namespaceRow(NS)],
      [`/api/cloud/me/namespaces/${NS}/relays`]: {
        relays: [{ ...readyRelay, authorship_ready: false }],
      },
    });

    const err = await connectCloud(options({ fetch })).catch((e: unknown) => e);
    expect((err as Error).message).toContain('CAN_AUTHOR_ON_BEHALF');
    expect((err as Error).message).toContain(EXECUTOR);
  });

  it('passes the discovered executor account into the minted warrant', async () => {
    let sentWarrant = '';
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/cloud/me/namespaces')) {
        return jsonResponse([namespaceRow(NS)]);
      }
      if (url.endsWith(`/api/cloud/me/namespaces/${NS}/relays`)) {
        return jsonResponse({ relays: [readyRelay] });
      }
      sentWarrant = (JSON.parse(String(init?.body)) as { warrant: string }).warrant;
      return jsonResponse({ data: { rootHash: 'r', returns: null } });
    }) as unknown as typeof fetch;

    const connection = await connectCloud(options({ fetch: impl }));
    await connection.execute(CONTEXT, 'set', {});

    // context (32) ‖ author account (32) ‖ author device key (32) ‖ executor (32)
    expect(sentWarrant.slice(0, 32 * 2)).toBe(CONTEXT);
    expect(sentWarrant.slice(32 * 2, 64 * 2)).toBe(AUTHOR);
    expect(sentWarrant.slice(96 * 2, 128 * 2)).toBe(EXECUTOR);
  });

  /**
   * The case this one-call path was built for and could not serve: a browser
   * wallet whose device key is a non-extractable `CryptoKey`, so there is no
   * hex secret to pass and the caller had to assemble the `RelayClient` itself.
   */
  it('signs with a device key that has no hex form', async () => {
    const signer = await signerFromCryptoKey(
      await unexportableKey(DEVICE_SECRET),
      (await signerFromSecret(DEVICE_SECRET)).publicKey,
    );

    let sentWarrant = '';
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/cloud/me/namespaces')) return jsonResponse([namespaceRow(NS)]);
      if (url.endsWith(`/api/cloud/me/namespaces/${NS}/relays`)) {
        return jsonResponse({ relays: [readyRelay] });
      }
      sentWarrant = (JSON.parse(String(init?.body)) as { warrant: string }).warrant;
      return jsonResponse({ data: { rootHash: 'r', returns: null } });
    }) as unknown as typeof fetch;

    const connection = await connectCloud(
      options({ fetch: impl, deviceSecret: undefined, signer }),
    );
    await connection.execute(CONTEXT, 'set', {});

    // The device key the warrant names is the signer's, so the relay verifies
    // against the key that actually signed.
    expect(sentWarrant.slice(64 * 2, 96 * 2)).toBe(signer.publicKey);
  });

  it('refuses a secret and a signer at once, which may name different keys', async () => {
    await expect(
      connectCloud(options({ signer: await signerFromSecret('12'.repeat(32)) })),
    ).rejects.toThrow(/either deviceSecret or signer, not both/);
  });

  it('refuses neither, rather than connecting with nothing to sign with', async () => {
    // Before the sign-in: a session minted for a connection that was never
    // going to be built is a credential issued for nothing.
    const { fetch, calls } = routedFetch({});
    await expect(
      connectCloud(options({ fetch, deviceSecret: undefined })),
    ).rejects.toThrow(/deviceSecret or signer is required/);
    expect(calls).toEqual([]);
  });

  it('does not need a GET on the relay, because the cloud already answered it', async () => {
    const { fetch, calls } = routedFetch({
      '/api/cloud/me/namespaces': [namespaceRow(NS)],
      [`/api/cloud/me/namespaces/${NS}/relays`]: { relays: [readyRelay] },
      [`/admin-api/contexts/${CONTEXT}/intents`]: { data: { rootHash: 'r', returns: null } },
    });

    const connection = await connectCloud(options({ fetch }));
    await connection.execute(CONTEXT, 'set', {});

    expect(calls.filter((c) => c.startsWith('GET https://relay.example'))).toEqual([]);
  });

  it('still exposes the relay descriptor read for a client that wants to confirm', async () => {
    const { fetch } = routedFetch({
      '/api/cloud/me/namespaces': [namespaceRow(NS)],
      [`/api/cloud/me/namespaces/${NS}/relays`]: { relays: [readyRelay] },
      [`/admin-api/contexts/${CONTEXT}/intents`]: {
        data: { executorAccount: EXECUTOR, canAuthorOnBehalf: true, groupId: GROUP },
      },
    });

    const connection = await connectCloud(options({ fetch }));
    await expect(connection.relay.describe(CONTEXT)).resolves.toEqual({
      executorAccount: EXECUTOR,
      canAuthorOnBehalf: true,
      groupId: GROUP,
    });
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
