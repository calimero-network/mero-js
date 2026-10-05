// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { joinAsAccount } from './join-as-account.js';
import { readRelayMap } from './session.js';

const ACCOUNT = 'aa'.repeat(32);
const NS = '01'.repeat(32);
const S = { account: ACCOUNT, credential: 'cc', deviceSecret: '11'.repeat(32), relayUrl: null };
const INVITATION = { invitation: { group_id: NS, admitters: [] }, inviter_signature: 'sig' } as never;

beforeEach(() => localStorage.clear());

describe('joinAsAccount', () => {
  it('joins through the relay the invitation names, remembers it, and moves the session onto it', async () => {
    const joined = { ...S, relayUrl: 'https://relay.example' };
    const bootstrap = vi.fn(async () => ({ ok: true as const, session: joined }));
    const onJoined = vi.fn();

    await expect(
      joinAsAccount(S, NS, INVITATION, { cloudBaseUrl: 'https://cloud', onJoined, bootstrap: bootstrap as never }),
    ).resolves.toEqual({ namespaceId: NS });

    expect(bootstrap).toHaveBeenCalledWith(
      expect.objectContaining({
        namespaceId: NS,
        invitation: INVITATION,
        credential: { account: ACCOUNT, credential: 'cc', deviceSecret: S.deviceSecret },
        cloudBaseUrl: 'https://cloud',
      }),
    );
    expect(onJoined).toHaveBeenCalledWith(joined);
    expect(readRelayMap(ACCOUNT).namespaces[NS]).toBe('https://relay.example');
  });

  it('a refused join rejects with its reason, step and status, and moves nothing', async () => {
    const bootstrap = vi.fn(async () => ({
      ok: false as const,
      step: 'admit' as const,
      reason: 'the admitter refused the join',
      status: 403,
    }));
    const onJoined = vi.fn();

    await expect(joinAsAccount(S, NS, INVITATION, { onJoined, bootstrap: bootstrap as never })).rejects.toMatchObject({
      message: expect.stringContaining('the admitter refused the join'),
      step: 'admit',
      status: 403,
    });
    expect(onJoined).not.toHaveBeenCalled();
  });

  it("keeps the session's executor when the join lands on the same relay", async () => {
    const EXECUTOR = '6a'.repeat(32);
    const before = { ...S, relayUrl: 'https://relay.example', executorAccount: EXECUTOR };
    const joined = { ...S, relayUrl: 'https://relay.example/' };
    const bootstrap = vi.fn(async () => ({ ok: true as const, session: joined }));
    const onJoined = vi.fn();

    await joinAsAccount(before, NS, INVITATION, { onJoined, bootstrap: bootstrap as never });

    expect(onJoined).toHaveBeenCalledWith({ ...joined, executorAccount: EXECUTOR });
  });

  it('drops the executor when the join moves the session to another relay', async () => {
    const before = { ...S, relayUrl: 'https://relay.example', executorAccount: '6a'.repeat(32) };
    const joined = { ...S, relayUrl: 'https://other.example' };
    const bootstrap = vi.fn(async () => ({ ok: true as const, session: joined }));
    const onJoined = vi.fn();

    await joinAsAccount(before, NS, INVITATION, { onJoined, bootstrap: bootstrap as never });

    expect(onJoined).toHaveBeenCalledWith(joined);
  });
});
