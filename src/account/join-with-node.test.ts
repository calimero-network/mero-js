import { describe, expect, it, vi } from 'vitest';
import type {
  SignedGroupOpenInvitation,
} from '../admin-api/index.js';
import { joinWithNode } from './join-with-node.js';
import { bootstrapFromInvitation } from './bootstrap-from-invitation.js';
import type { ResolveRelayResult } from './relay-from-invitation.js';

const NS = 'b0e37d63a32a7ccf9759b843a29761e6aac6709b949cc2ef80ba14be8d7aa319';
const INVITER = '838286af6a5b66641a6e860f4c171e1e790e347cba352878c453abf1c08f5239';
const ACCOUNT = '3e1fbd9c5a01a548dbcd593e8712ad49bafe8c35ef6e26ea535d661369cb34e5';

/**
 * The real invitation's shape, with placeholder values: the op encoder cares
 * about widths and order, and nothing in these tests verifies a signature.
 */
const INVITATION = {
  invitation: {
    inviter_identity: Array.from({ length: 32 }, () => 1),
    group_id: Array.from({ length: 32 }, () => 2),
    expiration_timestamp: 1_900_000_000,
    secret_salt: Array.from({ length: 32 }, () => 3),
    invited_role: 1,
    admitters: [INVITER],
  },
  inviter_signature: 'deadbeef',
  inviter_account: INVITER,
} as unknown as SignedGroupOpenInvitation;

const CREDENTIAL = {
  account: ACCOUNT,
  // Any hex blob: the op carries the credential verbatim. The device secret must
  // be a real 32-byte key, because it actually signs.
  credential: 'ab'.repeat(120),
  deviceSecret: 'cd'.repeat(32),
};

const NODE = 'https://relay.example';

const ok = (body: unknown): typeof fetch =>
  (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;

const join = (fetchImpl: typeof fetch, over: Record<string, unknown> = {}) =>
  joinWithNode({
    nodeUrl: NODE,
    namespaceId: NS,
    invitation: INVITATION,
    credential: CREDENTIAL,
    deps: { fetch: fetchImpl, nonce: async () => 1n },
    ...over,
  });

describe('joinWithNode', () => {
  it('posts the signed join to the documented route, unauthenticated', async () => {
    const fetchSpy = vi.fn(ok({ data: { published: true } }));
    const r = await join(fetchSpy as unknown as typeof fetch);

    expect(r).toMatchObject({ ok: true, published: true });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${NODE}/admin-api/namespaces/${NS}/admit`);
    expect(init.method).toBe('POST');
    // The route is one of the two the fleet ingress leaves open: the joiner's
    // signature is the authorization, so a token here would be meaningless.
    expect(Object.keys(init.headers as Record<string, string>)).not.toContain('Authorization');

    const body = JSON.parse(String(init.body)) as { invitation: unknown; signedOp: string };
    // Passed through unchanged: a re-modelled invitation drops the unsigned
    // bootstrap fields and invalidates the inviter's signature with them.
    expect(body.invitation).toEqual(JSON.parse(JSON.stringify(INVITATION)));
    expect(body.signedOp).toMatch(/^[0-9a-f]+$/);
  });

  it('makes the admitting node the session relay immediately', async () => {
    const r = await join(ok({ data: { published: true } }), { nodeUrl: `${NODE}/` });
    expect(r.ok && r.session).toEqual({
      relayUrl: NODE,
      account: ACCOUNT,
      credential: CREDENTIAL.credential,
      deviceSecret: CREDENTIAL.deviceSecret,
    });
  });

  it("uses the cloud's ready-made admit URL rather than rebuilding a path", async () => {
    const fetchSpy = vi.fn(ok({ data: { published: true } }));
    await join(fetchSpy as unknown as typeof fetch, {
      admitUrl: 'https://proxy.example/x/admit',
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://proxy.example/x/admit');
  });

  it('reports a 2xx that did not publish as published:false, not as success', async () => {
    expect(await join(ok({ data: { published: false } }))).toMatchObject({
      ok: true,
      published: false,
    });
  });

  it('names the admit step and keeps the status, since 400/403/409 differ', async () => {
    for (const [status, phrase] of [
      [400, 'malformed'],
      [403, 'admitters list'],
      [409, 'no device of its own'],
    ] as const) {
      const r = await join(
        (async () => new Response('refused', { status })) as unknown as typeof fetch,
      );
      expect(r).toMatchObject({ ok: false, step: 'admit', status });
      expect(r.ok === false && r.reason).toContain(phrase);
    }
  });

  it('distinguishes an unreachable admitter from a refusal', async () => {
    const r = await join(
      (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    );
    expect(r).toMatchObject({ ok: false, step: 'admit' });
    expect(r.ok === false && r.status).toBeUndefined();
    expect(r.ok === false && r.reason).toContain('could not be reached');
  });

  it('fails at the signing step, having sent nothing, on a bad device secret', async () => {
    const fetchSpy = vi.fn(ok({ data: { published: true } }));
    const r = await joinWithNode({
      nodeUrl: NODE,
      namespaceId: NS,
      invitation: INVITATION,
      credential: { ...CREDENTIAL, deviceSecret: 'ff' },
      deps: { fetch: fetchSpy as unknown as typeof fetch, nonce: async () => 1n },
    });
    expect(r).toMatchObject({ ok: false, step: 'sign' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

const RESOLVED: ResolveRelayResult = {
  ok: true,
  relayUrl: NODE,
  admitUrl: `${NODE}/admin-api/namespaces/${NS}/admit`,
  admitterAccount: INVITER,
  peerId: 'peer-1',
  writable: true,
  stale: false,
  via: 'cloud',
};

describe('bootstrapFromInvitation', () => {
  it('resolves a node from the cloud, then joins through it', async () => {
    const seen: unknown[] = [];
    const r = await bootstrapFromInvitation({
      namespaceId: NS,
      invitation: INVITATION,
      credential: CREDENTIAL,
      deps: {
        resolve: async (arg) => {
          seen.push(arg);
          return RESOLVED;
        },
        join: async () => ({ ok: true, published: true, session: { relayUrl: NODE, ...CREDENTIAL } }),
      },
    });
    expect(r).toMatchObject({ ok: true, published: true });
    expect(r.ok && r.relay).toMatchObject({ relayUrl: NODE });
    // The intersection is performed against the INVITATION's signed list, never
    // a separately supplied one.
    expect(seen[0]).toMatchObject({ admitters: [INVITER] });
  });

  it('skips the cloud lookup entirely when a node URL is given', async () => {
    let resolved = false;
    const seen: unknown[] = [];
    const r = await bootstrapFromInvitation({
      namespaceId: NS,
      invitation: INVITATION,
      credential: CREDENTIAL,
      nodeUrl: 'https://known.example',
      deps: {
        resolve: async () => {
          resolved = true;
          return RESOLVED;
        },
        join: async (arg) => {
          seen.push(arg);
          return {
            ok: true,
            published: true,
            session: { relayUrl: 'https://known.example', ...CREDENTIAL },
          };
        },
      },
    });
    expect(resolved).toBe(false);
    expect(seen[0]).toMatchObject({ nodeUrl: 'https://known.example', admitUrl: undefined });
    // No routing read happened, so there is no routing to report — which is not
    // the same as a skipped check.
    expect(r.ok && r.relay).toBeNull();
  });

  it('passes a relay-resolution failure straight through, step intact', async () => {
    const r = await bootstrapFromInvitation({
      namespaceId: NS,
      invitation: INVITATION,
      credential: CREDENTIAL,
      deps: {
        resolve: async () => ({ ok: false, step: 'not-invited', reason: 'nope' }),
        join: async () => {
          throw new Error('must not be reached');
        },
      },
    });
    expect(r).toMatchObject({ ok: false, step: 'not-invited' });
  });

  it('passes a join failure straight through, status intact', async () => {
    const r = await bootstrapFromInvitation({
      namespaceId: NS,
      invitation: INVITATION,
      credential: CREDENTIAL,
      deps: {
        resolve: async () => RESOLVED,
        join: async () => ({ ok: false, step: 'admit', status: 403, reason: 'refused' }),
      },
    });
    expect(r).toMatchObject({ ok: false, step: 'admit', status: 403 });
  });
});
