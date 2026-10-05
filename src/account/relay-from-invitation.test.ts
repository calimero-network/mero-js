import { describe, expect, it } from 'vitest';
import type {
  CloudNamespaceNode,
} from '../cloud/index.js';
import { normaliseAccount, resolveRelayFromInvitation } from './relay-from-invitation.js';

const NS = 'b0e37d63a32a7ccf9759b843a29761e6aac6709b949cc2ef80ba14be8d7aa319';
const INVITER = '838286af6a5b66641a6e860f4c171e1e790e347cba352878c453abf1c08f5239';
const OTHER = '1111111111111111111111111111111111111111111111111111111111111111';

const CREDENTIAL = { credential: 'aa'.repeat(32), deviceSecret: 'bb'.repeat(32) };

function node(over: Partial<CloudNamespaceNode> = {}): CloudNamespaceNode {
  return {
    peerId: 'peer-1',
    account: INVITER,
    relayUrl: 'https://relay.example',
    admitUrl: 'https://relay.example/admin-api/namespaces/ns/admit',
    status: 'active',
    fresh: true,
    canAdmit: true,
    authorshipReady: true,
    canExecute: true,
    teeRole: null,
    ...over,
  };
}

function cloud(nodes: CloudNamespaceNode[], flags?: { servable?: boolean; writable?: boolean }) {
  return {
    getNamespaceRouting: async () => ({
      namespaceId: NS,
      nodes,
      servable: flags?.servable ?? nodes.some((n) => n.canAdmit),
      writable: flags?.writable ?? nodes.some((n) => n.canExecute),
    }),
  };
}

const resolve = (
  nodes: CloudNamespaceNode[],
  admitters?: string[],
  flags?: { servable?: boolean; writable?: boolean },
) =>
  resolveRelayFromInvitation({
    namespaceId: NS,
    admitters,
    ...CREDENTIAL,
    cloud: cloud(nodes, flags),
  });

describe('normaliseAccount', () => {
  it('ignores case and a 0x prefix, because both spell the same 32 bytes', () => {
    expect(normaliseAccount(`0x${INVITER.toUpperCase()}`)).toBe(INVITER);
  });
  it('is null for nothing usable', () => {
    expect(normaliseAccount('')).toBeNull();
    expect(normaliseAccount('0x')).toBeNull();
    expect(normaliseAccount(null)).toBeNull();
  });
});

describe('resolveRelayFromInvitation', () => {
  it('returns the invited, admitting node', async () => {
    const r = await resolve([node()], [INVITER]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.relayUrl).toBe('https://relay.example');
    expect(r.admitUrl).toBe('https://relay.example/admin-api/namespaces/ns/admit');
    expect(r.writable).toBe(true);
    expect(r.stale).toBe(false);
  });

  it('refuses a healthy node the invitation does not name', async () => {
    const r = await resolve([node({ account: OTHER })], [INVITER]);
    expect(r).toMatchObject({ ok: false, step: 'not-invited' });
  });

  it('matches admitters case-insensitively and through a 0x prefix', async () => {
    const r = await resolve([node({ account: `0x${INVITER.toUpperCase()}` })], [INVITER]);
    expect(r.ok).toBe(true);
  });

  it('treats an empty admitters list as admission by broadcast, not as nobody', async () => {
    expect((await resolve([node({ account: OTHER })], [])).ok).toBe(true);
    expect((await resolve([node({ account: OTHER })])).ok).toBe(true);
  });

  it('separates "no fleet assignment" from "not invited"', async () => {
    const r = await resolve([], [INVITER]);
    expect(r).toMatchObject({ ok: false, step: 'no-nodes' });
  });

  // Reproduced on prod: a namespace whose founder never linked the account is
  // routed by the cloud to no node, yet its own relay admits a direct `/admit`
  // with 200. The invitation that relay's account minted carries where it is
  // reached (`admitter_addrs`), and that is the door when the cloud names none.
  describe('with no cloud nodes, an address the invitation carries', () => {
    const ADDRS = ['/ip4/10.0.0.1/tcp/4001/p2p/12D3KooWpeer', 'https://relay.example/'];

    it('is the admitter: the relay at that address, through its own admit route', async () => {
      const r = await resolveRelayFromInvitation({
        namespaceId: NS,
        admitters: [INVITER],
        admitterAddrs: ADDRS,
        ...CREDENTIAL,
        cloud: cloud([]),
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.relayUrl).toBe('https://relay.example');
      expect(r.admitUrl).toBe(`https://relay.example/admin-api/namespaces/${NS}/admit`);
      expect(r.admitterAccount).toBe(INVITER);
      expect(r.peerId).toBeNull();
      expect(r.via).toBe('invitation');
    });

    it('is not used when the cloud does route the namespace: the cloud chooses', async () => {
      const r = await resolveRelayFromInvitation({
        namespaceId: NS,
        admitters: [INVITER],
        admitterAddrs: ['https://elsewhere.example'],
        ...CREDENTIAL,
        cloud: cloud([node()]),
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.relayUrl).toBe('https://relay.example');
      expect(r.via).toBe('cloud');
    });

    it('is still no-nodes when the invitation carries only multiaddrs: a browser cannot dial them', async () => {
      const r = await resolveRelayFromInvitation({
        namespaceId: NS,
        admitters: [INVITER],
        admitterAddrs: [ADDRS[0]!],
        ...CREDENTIAL,
        cloud: cloud([]),
      });
      expect(r).toMatchObject({ ok: false, step: 'no-nodes' });
    });

    it('names no admitter account when the invitation names several: the node says which it is', async () => {
      const r = await resolveRelayFromInvitation({
        namespaceId: NS,
        admitters: [INVITER, OTHER],
        admitterAddrs: ADDRS,
        ...CREDENTIAL,
        cloud: cloud([]),
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.admitterAccount).toBeNull();
    });
  });

  // Measured against prod: the cloud reported servable:false / canAdmit:false /
  // fresh:false for a node whose /admin-api/health answered alive and which had
  // just minted the invitation being claimed. Those flags come from assignment
  // heartbeats, so treating them as gates refused to knock on an open door. They
  // are advisory: the node decides, and `stale` says the attempt was made on
  // advisory data.
  it('tries a named node anyway when the cloud says the namespace is not servable', async () => {
    const r = await resolve([node()], [INVITER], { servable: false });
    expect(r).toMatchObject({ ok: true, stale: true });
  });

  it('tries a named node whose own canAdmit is false, and marks it stale', async () => {
    const r = await resolve([node({ canAdmit: false })], [INVITER]);
    expect(r).toMatchObject({ ok: true, stale: true });
  });

  it('refuses an admitter the cloud has no address for', async () => {
    const r = await resolve([node({ relayUrl: null, admitUrl: null })], [INVITER]);
    expect(r).toMatchObject({ ok: false, step: 'no-relay-url' });
  });

  it('prefers a node that can also author, so one node serves both legs', async () => {
    const r = await resolve(
      [
        node({ peerId: 'admit-only', canExecute: false }),
        node({ peerId: 'both', relayUrl: 'https://both.example', canExecute: true }),
      ],
      [INVITER],
    );
    expect(r.ok && r.peerId).toBe('both');
  });

  it('still admits through a node that cannot author, and says so', async () => {
    const r = await resolve([node({ canExecute: false })], [INVITER]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.writable).toBe(false);
  });

  it('flags a lapsed heartbeat without refusing', async () => {
    const r = await resolve([node({ fresh: false })], [INVITER]);
    expect(r.ok && r.stale).toBe(true);
  });

  it('builds the admit path only when the cloud gave none', async () => {
    const r = await resolve([node({ admitUrl: null, relayUrl: 'https://relay.example/' })], [INVITER]);
    expect(r.ok && r.admitUrl).toBe(`https://relay.example/admin-api/namespaces/${NS}/admit`);
  });

  it('names the lookup itself when the cloud read fails, not the invitation', async () => {
    const r = await resolveRelayFromInvitation({
      namespaceId: NS,
      admitters: [INVITER],
      ...CREDENTIAL,
      cloud: {
        getNamespaceRouting: async () => {
          throw new Error('HTTP 503 Service Unavailable');
        },
      },
    });
    expect(r).toMatchObject({ ok: false, step: 'admitters-lookup' });
    expect(r.ok === false && r.reason).toContain('503');
  });
});
