import { describe, expect, it, vi } from 'vitest';
import type {
  SignedGroupOpenInvitation,
} from '../admin-api/index.js';
import { bootstrapFromInvitation } from './bootstrap-from-invitation.js';
import { resolveRelayFromInvitation } from './relay-from-invitation.js';

const NS = '01'.repeat(32);
const EVIL = 'https://evil.example';
const CREDENTIAL = { account: 'aa'.repeat(32), credential: 'cc', deviceSecret: '11'.repeat(32) };

function invitation(extra: Record<string, unknown> = {}): SignedGroupOpenInvitation {
  return {
    invitation: { group_id: NS, admitters: ['ee'.repeat(32)] },
    inviter_signature: 'sig',
    ...extra,
  } as unknown as SignedGroupOpenInvitation;
}

describe('bootstrapFromInvitation', () => {
  it("hands the invitation's signed admitters to the relay resolution", async () => {
    const resolve = vi.fn(async () => ({ ok: false as const, step: 'no-nodes' as const, reason: 'none' }));
    const out = await bootstrapFromInvitation({
      namespaceId: NS,
      invitation: invitation({ admitter_addrs: ['https://relay.example'] }),
      credential: CREDENTIAL,
      deps: { resolve, join: vi.fn() },
    });
    expect(out).toMatchObject({ ok: false, step: 'no-nodes' });
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ namespaceId: NS, admitters: ['ee'.repeat(32)] }),
    );
  });

  it('joins through the relay the resolution chose, at the admit URL it gave', async () => {
    const resolve = vi.fn(async () => ({
      ok: true as const,
      relayUrl: 'https://relay.example',
      admitUrl: `https://relay.example/admin-api/namespaces/${NS}/admit`,
      admitterAccount: null,
      peerId: null,
      writable: true,
      stale: false,
      via: 'cloud' as const,
    }));
    const join = vi.fn(async () => ({
      ok: true as const,
      published: true,
      session: { ...CREDENTIAL, relayUrl: 'https://relay.example' },
    }));
    const out = await bootstrapFromInvitation({
      namespaceId: NS,
      invitation: invitation(),
      credential: CREDENTIAL,
      deps: { resolve, join },
    });
    expect(out).toMatchObject({ ok: true, session: { relayUrl: 'https://relay.example' } });
    expect(join).toHaveBeenCalledWith(
      expect.objectContaining({ nodeUrl: 'https://relay.example', admitUrl: `https://relay.example/admin-api/namespaces/${NS}/admit` }),
    );
  });

  // `admitter_addrs` sits outside `inviter_signature`, so anyone forwarding the
  // invitation can point it at a host that proxies a genuine relay.
  describe('with the real relay resolution', () => {
    const routed = (nodes: unknown[]) =>
      vi.fn((input: Parameters<typeof resolveRelayFromInvitation>[0]) =>
        resolveRelayFromInvitation({
          ...input,
          cloud: { getNamespaceRouting: async () => ({ namespaceId: NS, nodes, servable: true, writable: true }) as never },
        }),
      );
    const joined = () =>
      vi.fn(async (input: { nodeUrl: string }) => ({
        ok: true as const,
        published: true,
        session: { ...CREDENTIAL, relayUrl: input.nodeUrl },
      }));

    it('never joins through, or takes as its relay, an http(s) address the invitation carries', async () => {
      const join = joined();
      const out = await bootstrapFromInvitation({
        namespaceId: NS,
        invitation: invitation({ admitter_addrs: [EVIL] }),
        credential: CREDENTIAL,
        deps: { resolve: routed([]), join },
      });
      expect(out).toMatchObject({ ok: false, step: 'no-nodes' });
      expect(join).not.toHaveBeenCalled();
    });

    it('joins through the relay the cloud lists, whatever address the invitation carries', async () => {
      const join = joined();
      const relay = { peerId: 'p', account: 'ee'.repeat(32), relayUrl: 'https://relay.example', admitUrl: null, status: 'active', fresh: true, canAdmit: true, authorshipReady: true, canExecute: true, teeRole: null };
      const out = await bootstrapFromInvitation({
        namespaceId: NS,
        invitation: invitation({ admitter_addrs: [EVIL] }),
        credential: CREDENTIAL,
        deps: { resolve: routed([relay]), join },
      });
      expect(out).toMatchObject({ ok: true, session: { relayUrl: 'https://relay.example' } });
      expect(join).toHaveBeenCalledWith(expect.objectContaining({ nodeUrl: 'https://relay.example' }));
    });
  });
});
