import { describe, it, expect } from 'vitest';
import { CloudClient, admitterAddrsFromNetworkStatus } from './cloud-client.js';
import { HTTPError } from '../http-client/web-client.js';
import { signAccountLink } from '../account/index.js';

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

describe('CloudClient machines and setup', () => {
  function signedIn(fetchImpl: typeof fetch) {
    return new CloudClient({
      cloudBaseUrl: 'https://cloud.example',
      sessionToken: 'session-1',
      fetch: fetchImpl,
    });
  }

  it('maps the account-wide machine view, grouped by machine', async () => {
    const { fetch, calls } = scriptedFetch([
      {
        body: {
          machines: [
            {
              peer_id: '12D3KooWpeer',
              relay_url: 'https://relay.example',
              executor_account: EXECUTOR,
              can_execute: true,
              namespaces: [
                {
                  namespace_id: NS,
                  status: 'active',
                  authorship_ready: true,
                  fresh: true,
                  confirmed_at: '2026-01-01T00:00:00',
                  last_seen_at: '2026-01-01T00:01:00',
                },
              ],
            },
          ],
        },
      },
    ]);

    const machines = await signedIn(fetch).getMyMachines();

    expect(calls[0].url).toBe('https://cloud.example/api/cloud/me/machines');
    expect(machines).toEqual([
      {
        peerId: '12D3KooWpeer',
        relayUrl: 'https://relay.example',
        executorAccount: EXECUTOR,
        canExecute: true,
        namespaces: [
          {
            namespaceId: NS,
            status: 'active',
            authorshipReady: true,
            fresh: true,
            confirmedAt: '2026-01-01T00:00:00',
            lastSeenAt: '2026-01-01T00:01:00',
          },
        ],
      },
    ]);
  });

  it('reports a stale or ungranted machine without hiding it', async () => {
    const { fetch } = scriptedFetch([
      {
        body: {
          machines: [
            {
              peer_id: 'p',
              relay_url: 'https://relay.example',
              executor_account: EXECUTOR,
              can_execute: false,
              namespaces: [
                { namespace_id: NS, status: 'active', authorship_ready: false, fresh: false },
              ],
            },
          ],
        },
      },
    ]);

    const [machine] = await signedIn(fetch).getMyMachines();

    // A machine that cannot write is still a machine the user is paying for —
    // surfacing it with `canExecute: false` is what lets a UI say which of the
    // preconditions is missing instead of showing nothing.
    expect(machine.canExecute).toBe(false);
    expect(machine.namespaces[0].fresh).toBe(false);
    expect(machine.namespaces[0].authorshipReady).toBe(false);
  });

  /**
   * Core answers `signerPublicKey`/`signedPayload` (its responses are
   * camelCase); the cloud's field names are snake_case. Forwarding merod's
   * object verbatim is the obvious client flow, so the client must not
   * re-shape it — the cloud accepts both.
   */
  it('claimNamespace forwards the proof object verbatim', async () => {
    const { fetch, calls } = scriptedFetch([{ body: { ok: true } }]);
    const proof = { signerPublicKey: 'ab', signedPayload: 'cd', signature: 'ef' };

    await signedIn(fetch).claimNamespace(NS, proof);

    expect(calls[0].url).toBe('https://cloud.example/api/cloud/namespaces/claim');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      namespace_id: NS,
      ownership_proof: proof,
    });
  });

  it('enable/disable namespace HA post to the split endpoints with no body of their own', async () => {
    const { fetch, calls } = scriptedFetch([{ body: {} }, { body: {} }]);
    const cloud = signedIn(fetch);

    await cloud.enableNamespaceHa(NS);
    await cloud.disableNamespaceHa(NS);

    expect(calls.map((c) => c.url)).toEqual([
      `https://cloud.example/api/cloud/namespaces/${NS}/enable-ha`,
      `https://cloud.example/api/cloud/namespaces/${NS}/disable-ha`,
    ]);
    // The claim already established ownership; these carry no proof.
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({});
  });

  it('sends the owner node addresses with enable-ha when given, and nothing otherwise', async () => {
    const { fetch, calls } = scriptedFetch([{ body: {} }, { body: {} }]);
    const cloud = signedIn(fetch);
    const laptop = '/ip4/63.181.86.34/udp/4001/quic-v1/p2p/12D3KooWRelay/p2p-circuit/p2p/12D3KooWOwner';

    await cloud.enableNamespaceHa(NS, { admitterAddrs: [laptop] });
    // Omitted means "leave what the cloud holds" -- an empty body, not an
    // empty list, which would clear it.
    await cloud.enableNamespaceHa(NS);

    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ admitter_addrs: [laptop] });
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({});
  });
});

describe('admitterAddrsFromNetworkStatus', () => {
  const PEER = '12D3KooWOwner';

  it('makes every external address end in this node\'s own peer id', () => {
    const status = {
      localPeerId: PEER,
      listenAddrs: ['/ip4/0.0.0.0/tcp/2528'],
      externalAddrs: [
        '/ip4/1.2.3.4/udp/2528/quic-v1',
        `/ip4/1.2.3.4/tcp/2528/p2p/${PEER}`,
        // Names the RELAY's peer, so "contains /p2p/" is not complete.
        '/ip4/9.9.9.9/udp/4001/quic-v1/p2p/12D3KooWRelay/p2p-circuit',
        'not-a-multiaddr',
      ],
    };
    expect(admitterAddrsFromNetworkStatus(status)).toEqual([
      `/ip4/1.2.3.4/udp/2528/quic-v1/p2p/${PEER}`,
      `/ip4/1.2.3.4/tcp/2528/p2p/${PEER}`,
      `/ip4/9.9.9.9/udp/4001/quic-v1/p2p/12D3KooWRelay/p2p-circuit/p2p/${PEER}`,
    ]);
    // The admin API's `{ data }` wrapper reads the same.
    expect(admitterAddrsFromNetworkStatus({ data: status })).toHaveLength(3);
  });

  it('is empty when there is nothing dialable to say', () => {
    expect(admitterAddrsFromNetworkStatus(null)).toEqual([]);
    expect(admitterAddrsFromNetworkStatus({ externalAddrs: ['/ip4/1.2.3.4/tcp/1'] })).toEqual([]);
    expect(admitterAddrsFromNetworkStatus({ localPeerId: PEER, externalAddrs: [] })).toEqual([]);
  });
});

describe('CloudClient account linking', () => {
  const ROOT_SECRET = '42'.repeat(32);
  const ACCOUNT =
    'a71c3dd073939d81f972525e9788c6b958818e33f30674ef43b4184eef40aa50';
  const ROOT_PUBLIC_KEY =
    '2152f8d19b791d24453242e15f2eab6cb7cffa7b6a5ed30097960e069881db12';

  it('fetches a challenge, signs it with the root, and posts the proof', async () => {
    const { fetch, calls } = scriptedFetch([
      { body: { nonce: 'challenge-1', expires_at_ms: 1_700_000_300_000 } },
      { body: { account_id: ACCOUNT, linked_at: '2026-01-01T00:00:00', already_linked: false } },
    ]);
    const cloud = new CloudClient({
      cloudBaseUrl: 'https://cloud.example',
      sessionToken: 'stored-token',
      fetch,
    });

    const link = await cloud.linkAccount(ROOT_SECRET);

    expect(link).toEqual({
      accountId: ACCOUNT,
      linkedAt: '2026-01-01T00:00:00',
      alreadyLinked: false,
    });
    expect(calls[0].url).toBe(
      'https://cloud.example/api/cloud/me/accounts/challenge',
    );
    expect(calls[1].url).toBe('https://cloud.example/api/cloud/me/accounts');

    const posted = JSON.parse(String(calls[1].init?.body));
    // The account and root key are derived here rather than taken from the
    // caller: mdma refuses a proof whose `account_id` is not the account the
    // signing root names, so deriving both from one secret is what makes the
    // two agree by construction.
    expect(posted.account_id).toBe(ACCOUNT);
    expect(posted.root_public_key).toBe(ROOT_PUBLIC_KEY);
    expect(posted.nonce).toBe('challenge-1');
    expect(posted.signature).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    // The signature is over the cloud's challenge, not some other string: the
    // whole point of the round trip is that it cannot be precomputed.
    expect(posted.signature).toBe(
      await signAccountLink({ rootSecret: ROOT_SECRET, nonce: 'challenge-1' }),
    );
  });

  it('reports an idempotent re-link as success, not failure', async () => {
    const { fetch } = scriptedFetch([
      { body: { nonce: 'challenge-2' } },
      { body: { account_id: ACCOUNT, linked_at: null, already_linked: true } },
    ]);
    const cloud = new CloudClient({
      cloudBaseUrl: 'https://cloud.example',
      sessionToken: 'stored-token',
      fetch,
    });

    expect((await cloud.linkAccount(ROOT_SECRET)).alreadyLinked).toBe(true);
  });

  it('never sends the root secret', async () => {
    const { fetch, calls } = scriptedFetch([
      { body: { nonce: 'challenge-3' } },
      { body: { account_id: ACCOUNT, already_linked: false } },
    ]);
    const cloud = new CloudClient({
      cloudBaseUrl: 'https://cloud.example',
      sessionToken: 'stored-token',
      fetch,
    });

    await cloud.linkAccount(ROOT_SECRET);

    for (const call of calls) {
      expect(JSON.stringify(call)).not.toContain(ROOT_SECRET);
    }
  });

  it('lists linked accounts with the plan limit', async () => {
    const { fetch } = scriptedFetch([
      {
        body: {
          accounts: [
            { account_id: ACCOUNT, linked_at: '2026-01-01T00:00:00', has_recovery_envelope: true },
          ],
          limit: 3,
        },
      },
    ]);
    const cloud = new CloudClient({
      cloudBaseUrl: 'https://cloud.example',
      sessionToken: 'stored-token',
      fetch,
    });

    expect(await cloud.getMyAccounts()).toEqual({
      accounts: [
        {
          accountId: ACCOUNT,
          linkedAt: '2026-01-01T00:00:00',
          hasRecoveryEnvelope: true,
        },
      ],
      limit: 3,
    });
  });

  it('reads an absent plan limit as unlimited', async () => {
    const { fetch } = scriptedFetch([{ body: { accounts: [] } }]);
    const cloud = new CloudClient({
      cloudBaseUrl: 'https://cloud.example',
      sessionToken: 'stored-token',
      fetch,
    });

    expect(await cloud.getMyAccounts()).toEqual({ accounts: [], limit: null });
  });
});

describe('CloudClient account linking for an external signer', () => {
  const ACCOUNT =
    'a71c3dd073939d81f972525e9788c6b958818e33f30674ef43b4184eef40aa50';
  const ROOT_PUBLIC_KEY =
    '2152f8d19b791d24453242e15f2eab6cb7cffa7b6a5ed30097960e069881db12';

  const signedIn = (fetch: typeof fetch) =>
    new CloudClient({
      cloudBaseUrl: 'https://cloud.example',
      sessionToken: 'stored-token',
      fetch,
    });

  it('hands back a challenge for a root this process cannot reach', async () => {
    const { fetch, calls } = scriptedFetch([
      { body: { nonce: 'challenge-9', expires_at_ms: 1_700_000_300_000 } },
    ]);

    expect(await signedIn(fetch).getAccountLinkChallenge()).toEqual({
      nonce: 'challenge-9',
      expiresAtMs: 1_700_000_300_000,
    });
    expect(calls[0].url).toBe(
      'https://cloud.example/api/cloud/me/accounts/challenge',
    );
  });

  it('reads a missing expiry as null rather than NaN', async () => {
    const { fetch } = scriptedFetch([{ body: { nonce: 'challenge-10' } }]);
    expect(
      (await signedIn(fetch).getAccountLinkChallenge()).expiresAtMs,
    ).toBeNull();
  });

  it('posts a proof assembled elsewhere verbatim', async () => {
    const { fetch, calls } = scriptedFetch([
      { body: { account_id: ACCOUNT, linked_at: null, already_linked: false } },
    ]);

    const result = await signedIn(fetch).submitAccountLink({
      accountId: ACCOUNT,
      rootPublicKey: ROOT_PUBLIC_KEY,
      nonce: 'challenge-11',
      signature: 'c2lnbmF0dXJl',
    });

    expect(result.accountId).toBe(ACCOUNT);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      account_id: ACCOUNT,
      root_public_key: ROOT_PUBLIC_KEY,
      nonce: 'challenge-11',
      signature: 'c2lnbmF0dXJl',
    });
  });
});

/**
 * The read a joiner makes before it has anything else.
 *
 * It holds an invitation and a namespace id, no cloud account, and no context
 * id — so this is the only cloud read available to it, and it has to answer
 * both where to admit and whether that same node will take a write.
 */
describe('CloudClient namespace routing', () => {
  const NODE_ACCOUNT = '5a'.repeat(32);
  const OTHER_ACCOUNT = '99'.repeat(32);
  const ROUTING_URL = `https://cloud.example/api/cloud/namespaces/${NS}/admitters`;

  function anonymous(fetchImpl: typeof fetch) {
    return new CloudClient({ cloudBaseUrl: 'https://cloud.example', fetch: fetchImpl });
  }

  function row(overrides: Record<string, unknown> = {}) {
    return {
      peer_id: '12D3KooWadmitter',
      account: NODE_ACCOUNT,
      relay_url: 'https://relay.example',
      admit_url: `https://relay.example/admin-api/namespaces/${NS}/admit`,
      status: 'active',
      fresh: true,
      can_admit: true,
      authorship_ready: true,
      can_execute: true,
      ...overrides,
    };
  }

  it('reads without a session, and answers both verbs at once', async () => {
    const { fetch, calls } = scriptedFetch([
      { body: { namespace_id: NS, admitters: [row()], servable: true, writable: true } },
    ]);

    const routing = await anonymous(fetch).getNamespaceRouting(NS);

    expect(calls[0].url).toBe(ROUTING_URL);
    // The point of the read: no Authorization header, because a joiner has no
    // cloud account and needing one is what this path exists to avoid.
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(routing.servable).toBe(true);
    expect(routing.writable).toBe(true);
    expect(routing.nodes).toEqual([
      {
        peerId: '12D3KooWadmitter',
        account: NODE_ACCOUNT,
        relayUrl: 'https://relay.example',
        admitUrl: `https://relay.example/admin-api/namespaces/${NS}/admit`,
        status: 'active',
        fresh: true,
        canAdmit: true,
        authorshipReady: true,
        canExecute: true,
      },
    ]);
  });

  it('keeps admission usable on a node with no authorship grant', async () => {
    const { fetch } = scriptedFetch([
      {
        body: {
          namespace_id: NS,
          admitters: [row({ authorship_ready: false, can_execute: false })],
          servable: true,
          writable: false,
        },
      },
    ]);

    const routing = await anonymous(fetch).getNamespaceRouting(NS);

    // Relaying a join the joiner already signed is not authoring on anyone's
    // behalf, so the grant is irrelevant to admission. Conflating the two would
    // strand a joiner at the one moment it has no other way in.
    expect(routing.nodes[0].canAdmit).toBe(true);
    expect(routing.nodes[0].canExecute).toBe(false);
    expect(routing.servable).toBe(true);
    expect(routing.writable).toBe(false);
  });

  it('picks only a node the invitation actually named', async () => {
    const { fetch } = scriptedFetch([
      {
        body: {
          admitters: [
            row({ peer_id: 'unnamed', account: OTHER_ACCOUNT }),
            row({ peer_id: 'named' }),
          ],
          servable: true,
        },
      },
    ]);

    const chosen = await anonymous(fetch).findAdmitter(NS, [NODE_ACCOUNT]);

    // `admitters` is a mint-time snapshot: the cloud lists every node assigned
    // to the namespace, and one added after the invitation was signed looks
    // perfect in every field here and answers 403. Intersecting is the whole
    // reason this helper takes the list.
    expect(chosen?.peerId).toBe('named');
  });

  it('returns null rather than a node that would be refused', async () => {
    const { fetch } = scriptedFetch([
      { body: { admitters: [row({ account: OTHER_ACCOUNT })], servable: true } },
    ]);

    expect(await anonymous(fetch).findAdmitter(NS, [NODE_ACCOUNT])).toBeNull();
  });

  it('accepts any listed node when the invitation names none', async () => {
    const { fetch } = scriptedFetch([
      { body: { admitters: [row({ account: OTHER_ACCOUNT })], servable: true } },
    ]);

    // An empty `admitters` list on the wire authorises any node to admit, so
    // filtering on it would refuse every node for an invitation that is open
    // by design.
    expect((await anonymous(fetch).findAdmitter(NS))?.account).toBe(OTHER_ACCOUNT);
  });

  it('skips a node that cannot take a join now', async () => {
    const { fetch } = scriptedFetch([
      {
        body: {
          admitters: [
            row({ peer_id: 'stale', fresh: false, can_admit: false }),
            row({ peer_id: 'live' }),
          ],
          servable: true,
        },
      },
    ]);

    expect((await anonymous(fetch).findAdmitter(NS, [NODE_ACCOUNT]))?.peerId).toBe('live');
  });

  it('treats a namespace with no cloud node as a state, not an error', async () => {
    const { fetch } = scriptedFetch([
      { body: { namespace_id: NS, admitters: [], servable: false, writable: false } },
    ]);

    const routing = await anonymous(fetch).getNamespaceRouting(NS);

    // The joiner must fall back to another admitter the invitation names — a
    // self-hosted peer, or another admin's node. Throwing here would look like
    // a broken cloud rather than a namespace nobody hosts.
    expect(routing.nodes).toEqual([]);
    expect(routing.servable).toBe(false);
  });
});
