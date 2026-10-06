import { describe, expect, it, vi } from 'vitest';
import type {
  SignedGroupOpenInvitation,
} from '../admin-api/index.js';
import { bootstrapFromInvitation } from './bootstrap-from-invitation.js';

const NS = '01'.repeat(32);
const CREDENTIAL = { account: 'aa'.repeat(32), credential: 'cc', deviceSecret: '11'.repeat(32) };

function invitation(extra: Record<string, unknown> = {}): SignedGroupOpenInvitation {
  return {
    invitation: { group_id: NS, admitters: ['ee'.repeat(32)] },
    inviter_signature: 'sig',
    ...extra,
  } as unknown as SignedGroupOpenInvitation;
}

describe('bootstrapFromInvitation', () => {
  it("hands the invitation's signed admitters and its addresses to the relay resolution", async () => {
    const resolve = vi.fn(async () => ({ ok: false as const, step: 'no-nodes' as const, reason: 'none' }));
    const out = await bootstrapFromInvitation({
      namespaceId: NS,
      invitation: invitation({ admitter_addrs: ['https://relay.example'] }),
      credential: CREDENTIAL,
      deps: { resolve, join: vi.fn() },
    });
    expect(out).toMatchObject({ ok: false, step: 'no-nodes' });
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ namespaceId: NS, admitters: ['ee'.repeat(32)], admitterAddrs: ['https://relay.example'] }),
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
      via: 'invitation' as const,
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
});
