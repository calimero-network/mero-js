import { describe, it, expect } from 'vitest';

import { signAccountLogin, accountRootFromSecret } from '../account/index.js';
import { CloudClient } from './cloud-client.js';

/**
 * A root key and a signature from MDMA's `tests/test_account_login.py`.
 *
 * Pinned in both directions, as the routing proof is: MDMA's verifier library
 * produced the signature below, so a change here to the domain, the encoding or
 * the key handling turns this test red rather than turning a deploy red. Ed25519
 * is deterministic, which is what makes it an equality and not a round-trip.
 */
const ROOT_SECRET =
  '5b6b8a1e9f2c47d3a80e6f14c2b9d75380af4e21c6d3b95f7e08a1c4d2f63b97';
const ROOT_PUBLIC_KEY =
  'a021d221f1e7601e8d280c857f8a667383e3923dda13b55f21ca2d928b79c70c';
const ACCOUNT_ID =
  'ca7645ffd4d0621d00c6c88743aeace5797135ab298c49e77de066206090b778';
const NONCE = 'test-login-nonce-abc';
const EXPECTED_SIGNATURE =
  '5Au0t95Ei2dJLBES7w3i6qeH5NN90S2LyzloPIl1spCSBx4MV0M8VUgVaOT6a16SL/HGtj25epGHCPhj5wmeAw==';

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

const SESSION_BODY = {
  session_token: 'session.jwt.value',
  expires_at: 1893456000,
  user: { email: 'owner@example.com' },
};

describe('signAccountLogin', () => {
  it('produces the signature MDMA verifies', async () => {
    expect(await signAccountLogin({ rootSecret: ROOT_SECRET, nonce: NONCE })).toBe(
      EXPECTED_SIGNATURE,
    );
  });

  it('is not the signature the LINK domain produces', async () => {
    // The two exchanges are otherwise byte-identical -- a root signature over a
    // cloud-issued nonce -- so the separate domains are the only thing stopping
    // a signature gathered while linking from being replayed as a login. If
    // these ever agreed, that separation would be gone.
    const { signAccountLink } = await import('../account/index.js');
    const link = await signAccountLink({ rootSecret: ROOT_SECRET, nonce: NONCE });
    expect(link).not.toBe(EXPECTED_SIGNATURE);
  });

  it('refuses to sign nothing', async () => {
    await expect(
      signAccountLogin({ rootSecret: ROOT_SECRET, nonce: '' }),
    ).rejects.toThrow(/nonce is required/);
  });
});

describe('CloudClient.signInWithAccount', () => {
  it('fetches a challenge, signs it with the root, and adopts the session', async () => {
    const { fetch, calls } = scriptedFetch([
      { body: { nonce: NONCE, expires_at_ms: 1893456000000 } },
      { body: SESSION_BODY },
    ]);
    const client = new CloudClient({ cloudBaseUrl: 'https://cloud.test', fetch });

    const session = await client.signInWithAccount(ROOT_SECRET);

    expect(calls[0]?.url).toBe('https://cloud.test/api/auth/account/challenge');
    expect(calls[1]?.url).toBe('https://cloud.test/api/auth/account');
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      root_public_key: ROOT_PUBLIC_KEY,
      nonce: NONCE,
      signature: EXPECTED_SIGNATURE,
    });
    expect(session.sessionToken).toBe('session.jwt.value');
    expect(client.isSignedIn()).toBe(true);
  });

  it('sends no account id, only the key the cloud derives it from', async () => {
    // The account is the hash of the root key, so a caller-supplied id could
    // only ever agree or lie. Not sending one is what removes the question --
    // and it is the difference from the LINK proof, which does carry one.
    const { fetch, calls } = scriptedFetch([
      { body: { nonce: NONCE, expires_at_ms: 1 } },
      { body: SESSION_BODY },
    ]);
    await new CloudClient({ cloudBaseUrl: 'https://cloud.test', fetch }).signInWithAccount(
      ROOT_SECRET,
    );
    const sent = JSON.parse(String(calls[1]?.init?.body)) as Record<string, unknown>;
    expect(sent.account_id).toBeUndefined();
    expect(await accountRootFromSecret(ROOT_SECRET)).toMatchObject({
      accountId: ACCOUNT_ID,
      publicKey: ROOT_PUBLIC_KEY,
    });
  });

  it('carries no Authorization header -- there is no session to carry yet', async () => {
    // Both legs are anonymous by necessity: obtaining a session is what the
    // exchange does. A client that sent a stale token here would have the cloud
    // answering as whoever that token named.
    const { fetch, calls } = scriptedFetch([
      { body: { nonce: NONCE, expires_at_ms: 1 } },
      { body: SESSION_BODY },
    ]);
    const client = new CloudClient({
      cloudBaseUrl: 'https://cloud.test',
      sessionToken: 'someone.elses.token',
      fetch,
    });
    await client.signInWithAccount(ROOT_SECRET);
    for (const call of calls) {
      const headers = call.init?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBeUndefined();
    }
  });

  it('surfaces the cloud refusing an unlinked account', async () => {
    const { fetch } = scriptedFetch([
      { body: { nonce: NONCE, expires_at_ms: 1 } },
      { status: 403, body: { detail: 'ownership of account ... is recorded, but it is not linked' } },
    ]);
    const client = new CloudClient({ cloudBaseUrl: 'https://cloud.test', fetch });
    await expect(client.signInWithAccount(ROOT_SECRET)).rejects.toThrow();
    expect(client.isSignedIn()).toBe(false);
  });
});

describe('CloudClient.submitAccountLogin', () => {
  it('accepts a proof signed somewhere this process cannot reach', async () => {
    // The split half: a root on a hardware key or an air-gapped machine signs
    // the challenge, and the secret never reaches this client at all.
    const { fetch, calls } = scriptedFetch([{ body: SESSION_BODY }]);
    const client = new CloudClient({ cloudBaseUrl: 'https://cloud.test', fetch });

    const session = await client.submitAccountLogin({
      rootPublicKey: ROOT_PUBLIC_KEY,
      nonce: NONCE,
      signature: EXPECTED_SIGNATURE,
    });

    expect(calls[0]?.url).toBe('https://cloud.test/api/auth/account');
    expect(session.user.email).toBe('owner@example.com');
  });
});
