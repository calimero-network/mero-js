import { describe, expect, it } from 'vitest';

import {
  AccountHaRefusedError,
  AccountLinkedToSeveralUsersError,
  AccountNotLinkedError,
  CloudClient,
  HaRequestPendingError,
  RelayNotDialableError,
  UnknownRelayError,
} from './cloud-client.js';
import { HTTPError } from '../http-client/web-client.js';
import { signerFromSecret } from '../signer/signer.js';

/**
 * Enabling HA as an account, with no cloud session: the request the client
 * sends, and the two refusals a person can act on.
 */
const SECRET = '07'.repeat(32);
const NS = 'aa'.repeat(32);
const ACCOUNT = 'bb'.repeat(32);
const SALT = 'cc'.repeat(32);
const CREDENTIAL = 'dd'.repeat(40);
const BASE = 'https://cloud.test';
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function scriptedFetch(response: { status?: number; body?: unknown }) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(response.body ?? {}), {
      status: response.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

const options = { namespaceId: NS, salt: SALT, accountId: ACCOUNT, credential: CREDENTIAL, deviceSecret: SECRET };

describe('CloudClient.enableHaAsAccount', () => {
  it('POSTs the signed claim anonymously to the account route and returns the body', async () => {
    const { fetch, calls } = scriptedFetch({ body: { status: 'enabled', namespace_id: NS } });
    // A session is held on purpose: the route is anonymous and must not carry it.
    const cloud = new CloudClient({ cloudBaseUrl: `${BASE}/`, fetch, sessionToken: 'session-jwt' });

    const result = await cloud.enableHaAsAccount(options);

    expect(result).toEqual({ status: 'enabled', namespace_id: NS });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/api/cloud/accounts/${ACCOUNT}/namespaces/${NS}/enable-ha`);
    expect(calls[0].init?.method).toBe('POST');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(String(calls[0].init?.body));
    expect(Object.keys(body)).toEqual(['ownership_proof']);
    const proof = body.ownership_proof;
    expect(Object.keys(proof).sort()).toEqual(['credential', 'kind', 'signature', 'signed_payload']);
    expect(proof.kind).toBe('account');
    expect(proof.credential).toBe(CREDENTIAL);

    const payloadBytes = unb64(proof.signed_payload);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    expect(payload).toMatchObject({
      v: 1,
      audience: 'mdma:enable-ha-namespace-as-account',
      group_id: NS,
      account_id: ACCOUNT,
      salt: SALT,
    });
    expect(payload).not.toHaveProperty('subject');
    expect(payload.expires_at_ms - payload.issued_at_ms).toBe(60_000);

    const signer = await signerFromSecret(SECRET);
    const pk = Uint8Array.from(signer.publicKey.match(/../g)!.map((x) => Number.parseInt(x, 16)));
    const key = await crypto.subtle.importKey('raw', pk, { name: 'Ed25519' }, false, ['verify']);
    const domain = new TextEncoder().encode('calimero.mdma.account-ownership-claim.v1\0');
    const message = new Uint8Array(domain.length + payloadBytes.length);
    message.set(domain);
    message.set(payloadBytes, domain.length);
    expect(await crypto.subtle.verify({ name: 'Ed25519' }, key, unb64(proof.signature), message)).toBe(true);
  });

  it('needs no session at all, takes a signer, and lowercases the ids in the path', async () => {
    const { fetch, calls } = scriptedFetch({ body: {} });
    const cloud = new CloudClient({ cloudBaseUrl: BASE, fetch });
    const signer = await signerFromSecret(SECRET);
    await cloud.enableHaAsAccount({
      namespaceId: NS.toUpperCase(),
      salt: SALT,
      accountId: ACCOUNT.toUpperCase(),
      credential: CREDENTIAL,
      signer,
      ttlMs: 120_000,
    });
    expect(calls[0].url).toBe(`${BASE}/api/cloud/accounts/${ACCOUNT}/namespaces/${NS}/enable-ha`);
    const payload = JSON.parse(
      new TextDecoder().decode(unb64(JSON.parse(String(calls[0].init?.body)).ownership_proof.signed_payload)),
    );
    expect(payload.expires_at_ms - payload.issued_at_ms).toBe(120_000);
  });

  it('maps 409 account_not_linked to AccountNotLinkedError', async () => {
    const { fetch } = scriptedFetch({ status: 409, body: { error: 'account_not_linked' } });
    const cloud = new CloudClient({ cloudBaseUrl: BASE, fetch });
    const err = await cloud.enableHaAsAccount(options).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccountNotLinkedError);
    expect(err).toBeInstanceOf(AccountHaRefusedError);
    expect(err).toBeInstanceOf(HTTPError);
    expect((err as AccountNotLinkedError).code).toBe('account_not_linked');
    expect((err as AccountNotLinkedError).status).toBe(409);
    expect((err as Error).name).toBe('AccountNotLinkedError');
  });

  it('maps 409 account_linked_to_several_users to AccountLinkedToSeveralUsersError', async () => {
    const { fetch } = scriptedFetch({ status: 409, body: { error: 'account_linked_to_several_users' } });
    const cloud = new CloudClient({ cloudBaseUrl: BASE, fetch });
    const err = await cloud.enableHaAsAccount(options).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccountLinkedToSeveralUsersError);
    expect((err as AccountLinkedToSeveralUsersError).code).toBe('account_linked_to_several_users');
  });

  it("accepts FastAPI's detail spelling of the same codes", async () => {
    for (const body of [{ detail: 'account_not_linked' }, { detail: { error: 'account_not_linked' } }]) {
      const { fetch } = scriptedFetch({ status: 409, body });
      const cloud = new CloudClient({ cloudBaseUrl: BASE, fetch });
      await expect(cloud.enableHaAsAccount(options)).rejects.toBeInstanceOf(AccountNotLinkedError);
    }
  });

  it('leaves a 403 and any other 409 as a plain HTTPError', async () => {
    for (const [status, body] of [
      [403, { detail: 'Ownership proof failed: bad signature' }],
      [409, { error: 'something_else' }],
    ] as const) {
      const { fetch } = scriptedFetch({ status, body });
      const cloud = new CloudClient({ cloudBaseUrl: BASE, fetch });
      const err = await cloud.enableHaAsAccount(options).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HTTPError);
      expect(err).not.toBeInstanceOf(AccountHaRefusedError);
      expect((err as HTTPError).status).toBe(status);
    }
  });

  it('refuses before sending when the claim cannot be signed', async () => {
    const { fetch, calls } = scriptedFetch({ body: {} });
    const cloud = new CloudClient({ cloudBaseUrl: BASE, fetch });
    await expect(cloud.enableHaAsAccount({ ...options, salt: 'nope' })).rejects.toThrow(/salt/);
    await expect(cloud.enableHaAsAccount({ ...options, ttlMs: 300_001 })).rejects.toThrow(/ttlMs/);
    expect(calls).toHaveLength(0);
  });
  it('signs the founding relay into the claim, not the body, when given', async () => {
    const { fetch, calls } = scriptedFetch({ body: {} });
    const cloud = new CloudClient({ cloudBaseUrl: BASE, fetch });
    const relayUrl = 'https://node-abc.relay.cloud.test';
    await cloud.enableHaAsAccount({ ...options, relayUrl });
    const body = JSON.parse(String(calls[0].init?.body));
    expect(Object.keys(body)).toEqual(['ownership_proof']);
    const payload = JSON.parse(new TextDecoder().decode(unb64(body.ownership_proof.signed_payload)));
    expect(payload.relay_url).toBe(relayUrl);
  });

  it('maps the refusals a founder can act on: 422 unknown_relay / relay_not_dialable, 409 ha_request_pending', async () => {
    for (const [status, code, Typed] of [
      [422, 'unknown_relay', UnknownRelayError],
      [422, 'relay_not_dialable', RelayNotDialableError],
      [409, 'ha_request_pending', HaRequestPendingError],
    ] as const) {
      const { fetch } = scriptedFetch({ status, body: { detail: { error: code, message: 'm' } } });
      const cloud = new CloudClient({ cloudBaseUrl: BASE, fetch });
      const err = await cloud.enableHaAsAccount(options).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Typed);
      expect(err).toBeInstanceOf(AccountHaRefusedError);
      expect((err as AccountHaRefusedError).code).toBe(code);
      expect((err as AccountHaRefusedError).status).toBe(status);
    }
  });

  it('leaves any other 422 as a plain HTTPError', async () => {
    const { fetch } = scriptedFetch({ status: 422, body: { detail: [{ msg: 'field required' }] } });
    const cloud = new CloudClient({ cloudBaseUrl: BASE, fetch });
    const err = await cloud.enableHaAsAccount(options).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HTTPError);
    expect(err).not.toBeInstanceOf(AccountHaRefusedError);
  });
});
