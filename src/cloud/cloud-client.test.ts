import { describe, it, expect } from 'vitest';
import { CloudClient } from './cloud-client.js';
import { HTTPError } from '../http-client/web-client.js';

const EXECUTOR = '4d'.repeat(32);
const NS = '01'.repeat(32);

/** A `fetch` that answers a scripted queue and records what it was asked. */
function scriptedFetch(
  responses: Array<{ status?: number; body?: unknown; text?: string; headers?: Record<string, string> }>,
): { fetch: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const queue = [...responses];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = queue.shift();
    if (!next) throw new Error('unexpected extra fetch');
    return new Response(next.text ?? JSON.stringify(next.body ?? {}), {
      status: next.status ?? 200,
      headers: { 'Content-Type': 'application/json', ...(next.headers ?? {}) },
    });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

const SESSION_BODY = {
  session_token: 'session-1',
  expires_at: 1_800_000_000,
  user: { email: 'someone@example.com', name: 'Someone' },
};

describe('CloudClient sign-in', () => {
  it('exchanges a Google ID token for a session and keeps it', async () => {
    const { fetch, calls } = scriptedFetch([{ body: SESSION_BODY }]);
    const cloud = new CloudClient({ cloudBaseUrl: 'https://cloud.example/', fetch });

    expect(cloud.isSignedIn()).toBe(false);
    const session = await cloud.signInWithGoogle('google-id-token');

    expect(session.sessionToken).toBe('session-1');
    expect(session.user.email).toBe('someone@example.com');
    expect(cloud.isSignedIn()).toBe(true);
    expect(calls[0].url).toBe('https://cloud.example/api/auth/google');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ id_token: 'google-id-token' });
    // The exchange is the one call that must NOT carry a bearer: there is no
    // session yet, and sending the Google token as one would be a different
    // (unsupported) auth path.
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('sends the session as a bearer on authenticated reads', async () => {
    const { fetch, calls } = scriptedFetch([{ body: [] }]);
    const cloud = new CloudClient({
      cloudBaseUrl: 'https://cloud.example',
      sessionToken: 'stored-token',
      fetch,
    });

    await cloud.getMyNamespaces();

    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer stored-token',
    );
  });

  /**
   * An unauthenticated call would come back as a 401 the caller then has to
   * interpret. Refusing locally names the actual problem — nobody is signed in
   * — and costs no round trip.
   */
  it('refuses an authenticated call before making it when nobody is signed in', async () => {
    const { fetch, calls } = scriptedFetch([]);
    const cloud = new CloudClient({ cloudBaseUrl: 'https://cloud.example', fetch });

    await expect(cloud.getMyNamespaces()).rejects.toThrow(/Not signed in/);
    expect(calls).toHaveLength(0);
  });

  /**
   * MDMA rotates the session on activity and returns the replacement in a
   * response header rather than making the client ask. Dropping it costs
   * nothing today and logs the user out a week later.
   */
  it('adopts a rolling-refreshed session from the response headers', async () => {
    const persisted: Array<string | null> = [];
    const { fetch } = scriptedFetch([
      {
        body: [],
        headers: {
          'x-mdma-session-refresh': 'session-2',
          'x-mdma-session-expires': '1900000000',
        },
      },
    ]);
    const cloud = new CloudClient({
      cloudBaseUrl: 'https://cloud.example',
      sessionToken: 'session-1',
      onSession: (s) => void persisted.push(s?.sessionToken ?? null),
      fetch,
    });

    await cloud.getMyNamespaces();

    expect(cloud.getSession()?.sessionToken).toBe('session-2');
    expect(cloud.getSession()?.expiresAt).toBe(1_900_000_000);
    expect(persisted).toEqual(['session-2']);
  });

  it('signs out locally even when the server call fails', async () => {
    const failing = (async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch;
    const cloud = new CloudClient({
      cloudBaseUrl: 'https://cloud.example',
      sessionToken: 'session-1',
      fetch: failing,
    });

    await expect(cloud.signOut()).rejects.toThrow();
    expect(cloud.isSignedIn()).toBe(false);
  });
});

describe('CloudClient relay discovery', () => {
  const relayRow = (over: Record<string, unknown> = {}) => ({
    peer_id: '12D3KooWpeer',
    relay_url: 'https://relay.example',
    executor_account: EXECUTOR,
    status: 'active',
    authorship_ready: true,
    last_seen_at: '2026-01-01T00:00:00',
    confirmed_at: '2026-01-01T00:00:00',
    ...over,
  });

  function signedIn(fetchImpl: typeof fetch) {
    return new CloudClient({
      cloudBaseUrl: 'https://cloud.example',
      sessionToken: 'session-1',
      fetch: fetchImpl,
    });
  }

  it('maps the cloud wire shape to the relay descriptor', async () => {
    const { fetch, calls } = scriptedFetch([{ body: { relays: [relayRow()] } }]);

    const relays = await signedIn(fetch).getNamespaceRelays(NS);

    expect(calls[0].url).toBe(`https://cloud.example/api/cloud/me/namespaces/${NS}/relays`);
    expect(relays).toEqual([
      {
        peerId: '12D3KooWpeer',
        relayUrl: 'https://relay.example',
        executorAccount: EXECUTOR,
        status: 'active',
        authorshipReady: true,
        lastSeenAt: '2026-01-01T00:00:00',
        confirmedAt: '2026-01-01T00:00:00',
      },
    ]);
  });

  it('treats an owned namespace with no relays as an empty list', async () => {
    const { fetch } = scriptedFetch([{ body: { namespace_id: NS, relays: [] } }]);
    await expect(signedIn(fetch).getNamespaceRelays(NS)).resolves.toEqual([]);
  });

  /**
   * Three independent things have to hold before a relay can run an intent, and
   * a client that checks fewer gets a refusal it cannot explain — after having
   * burned a nonce on the warrant.
   */
  it('findExecutingRelay skips a relay missing any of the three preconditions', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['no authorship grant', { authorship_ready: false }],
      ['no url reported', { relay_url: null }],
      ['no executor account reported', { executor_account: null }],
    ];
    for (const [, over] of cases) {
      const { fetch } = scriptedFetch([{ body: { relays: [relayRow(over)] } }]);
      await expect(signedIn(fetch).findExecutingRelay(NS)).resolves.toBeNull();
    }
  });

  it('findExecutingRelay picks the usable relay out of a mixed set', async () => {
    const { fetch } = scriptedFetch([
      {
        body: {
          relays: [
            relayRow({ peer_id: 'waiting', authorship_ready: false }),
            relayRow({ peer_id: 'ready' }),
          ],
        },
      },
    ]);

    await expect(signedIn(fetch).findExecutingRelay(NS)).resolves.toMatchObject({
      peerId: 'ready',
      authorshipReady: true,
    });
  });

  it("surfaces the cloud's 404 for a namespace this account does not own", async () => {
    const { fetch } = scriptedFetch([
      { status: 404, text: JSON.stringify({ detail: 'No such namespace for this account.' }) },
    ]);

    const err = await signedIn(fetch)
      .getNamespaceRelays(NS)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HTTPError);
    expect((err as HTTPError).status).toBe(404);
  });
});

describe('CloudClient namespaces', () => {
  it('maps snake_case cloud rows to the SDK shape', async () => {
    const { fetch } = scriptedFetch([
      {
        body: [
          {
            group_id: NS,
            namespace_id: NS,
            ha_status: 'enabled',
            ha_enabled_at: '2026-01-01T00:00:00',
            contexts: ['ctx-1'],
            fleet_replicas: { current: 1, limit: 2 },
          },
        ],
      },
    ]);

    const namespaces = await new CloudClient({
      cloudBaseUrl: 'https://cloud.example',
      sessionToken: 'session-1',
      fetch,
    }).getMyNamespaces();

    expect(namespaces).toEqual([
      {
        namespaceId: NS,
        groupId: NS,
        haStatus: 'enabled',
        haEnabledAt: '2026-01-01T00:00:00',
        contexts: ['ctx-1'],
        fleetReplicas: { current: 1, limit: 2 },
      },
    ]);
  });
});
