/**
 * Linking an account from an app that holds the root and no cloud session.
 *
 * The bind: only Google issues a first cloud session, so a browser app that
 * mints an account root can prove it owns the account and still never get one —
 * the proof says who you are, the link says what you are entitled to, and
 * linking is behind a session. The way across is a redirect: the person
 * consents in the portal, where they *are* signed in, and the app is sent back
 * holding a grant.
 *
 * What these tests pin is the shape of both ends of that redirect, because they
 * are the parts a caller cannot see wrong until a person is standing in front
 * of them: the handoff URL the portal parses, and the fragment it answers with.
 */

import { describe, it, expect } from 'vitest';

import { CloudClient } from './cloud-client.js';

const ROOT_SECRET =
  '5b6b8a1e9f2c47d3a80e6f14c2b9d75380af4e21c6d3b95f7e08a1c4d2f63b97';
const ROOT_PUBLIC_KEY =
  'a021d221f1e7601e8d280c857f8a667383e3923dda13b55f21ca2d928b79c70c';
const ACCOUNT_ID =
  'ca7645ffd4d0621d00c6c88743aeace5797135ab298c49e77de066206090b778';

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

describe('CloudClient.accountLinkHandoff', () => {
  it('builds the URL the portal parses', () => {
    const { url } = CloudClient.accountLinkHandoff({
      portalUrl: 'https://cloud.calimero.network/',
      accountId: ACCOUNT_ID,
      callbackUrl: 'https://demo.example/app?keep=this',
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://cloud.calimero.network/');
    expect(parsed.searchParams.get('link-account')).toBe(ACCOUNT_ID);
    // Encoded as one parameter, so a callback carrying its own query does not
    // arrive as extra parameters of ours.
    expect(parsed.searchParams.get('callback-url')).toBe('https://demo.example/app?keep=this');
  });

  it('needs no client and no session', () => {
    // Static on purpose: at this point in the flow there is nothing to
    // authenticate as, which is the entire reason the handoff exists.
    expect(typeof CloudClient.accountLinkHandoff).toBe('function');
  });
});

describe('CloudClient.readAccountLinkCallback', () => {
  it('reads a grant out of the fragment', () => {
    const out = CloudClient.readAccountLinkCallback(
      `https://demo.example/app#grant=sealed.token&account=${ACCOUNT_ID}`,
    );
    expect(out).toEqual({ grant: 'sealed.token', accountId: ACCOUNT_ID });
  });

  it('reports a refusal as a refusal', () => {
    // The person pressed Cancel. An app that only checked for `grant` would sit
    // there waiting for something that is never coming.
    expect(CloudClient.readAccountLinkCallback('https://demo.example/app#error=denied')).toEqual({
      error: 'denied',
    });
  });

  it('returns nothing for an ordinary load, so it is safe to call every time', () => {
    expect(CloudClient.readAccountLinkCallback('https://demo.example/app')).toEqual({});
    expect(CloudClient.readAccountLinkCallback('not a url')).toEqual({});
  });

  it('ignores a grant in the QUERY rather than the fragment', () => {
    // Fragments are not sent to servers. Reading one from the query would
    // quietly accept a value that had already been written to somebody's logs.
    expect(
      CloudClient.readAccountLinkCallback('https://demo.example/app?grant=sealed.token'),
    ).toEqual({});
  });
});

describe('CloudClient.linkAccountWithGrant', () => {
  it('signs the grant with the root and posts both halves', async () => {
    const { fetch, calls } = scriptedFetch([
      { body: { account_id: ACCOUNT_ID, linked_at: '2026-09-17T00:00:00Z', already_linked: false } },
    ]);
    const client = new CloudClient({ cloudBaseUrl: 'https://cloud.test', fetch });

    const link = await client.linkAccountWithGrant({ grant: 'sealed.token', rootSecret: ROOT_SECRET });

    expect(calls[0]?.url).toBe('https://cloud.test/api/cloud/accounts/link');
    const sent = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(sent.grant).toBe('sealed.token');
    expect(sent.root_public_key).toBe(ROOT_PUBLIC_KEY);
    expect(typeof sent.signature).toBe('string');
    // No email and no account id: the grant carries the consenting login sealed
    // inside it, and the account is re-derived from the key that signed. Fields
    // for either would be fields to lie in.
    expect(sent.email).toBeUndefined();
    expect(sent.account_id).toBeUndefined();
    expect(link.accountId).toBe(ACCOUNT_ID);
    expect(link.alreadyLinked).toBe(false);
  });

  it('sends no Authorization header even when a session is held', async () => {
    // The endpoint is anonymous because the app spending a grant has no session.
    // Sending one it happens to have would authenticate as somebody the grant
    // says nothing about.
    const { fetch, calls } = scriptedFetch([{ body: { account_id: ACCOUNT_ID } }]);
    const client = new CloudClient({
      cloudBaseUrl: 'https://cloud.test',
      sessionToken: 'someone.elses.token',
      fetch,
    });

    await client.linkAccountWithGrant({ grant: 'sealed.token', rootSecret: ROOT_SECRET });

    const headers = calls[0]?.init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBeUndefined();
  });

  it('signs the grant itself, so a different grant is a different signature', async () => {
    const signatures: string[] = [];
    for (const grant of ['grant.one', 'grant.two']) {
      const { fetch, calls } = scriptedFetch([{ body: { account_id: ACCOUNT_ID } }]);
      await new CloudClient({ cloudBaseUrl: 'https://cloud.test', fetch }).linkAccountWithGrant({
        grant,
        rootSecret: ROOT_SECRET,
      });
      signatures.push(String(JSON.parse(String(calls[0]?.init?.body)).signature));
    }
    expect(signatures[0]).not.toBe(signatures[1]);
  });

  it('surfaces a refused grant', async () => {
    const { fetch } = scriptedFetch([
      { status: 403, body: { detail: 'That grant has already been used.' } },
    ]);
    const client = new CloudClient({ cloudBaseUrl: 'https://cloud.test', fetch });
    await expect(
      client.linkAccountWithGrant({ grant: 'spent.token', rootSecret: ROOT_SECRET }),
    ).rejects.toThrow(/already been used/);
  });
});
