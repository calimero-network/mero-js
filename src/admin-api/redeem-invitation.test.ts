import { describe, it, expect, vi } from 'vitest';
import {
  redeemInvitation,
  shouldRetain,
  isSettled,
  type InviteRedeemer,
} from './redeem-invitation.js';
import { HTTPError } from '../http-client/index.js';

/** What mero-js throws for a non-2xx answer. */
function httpError(status: number, error: string): HTTPError {
  return new HTTPError(status, 'Status', 'http://node/join', new Headers(), JSON.stringify({ error }));
}

const NS = '7d847b7afeab53bef1899496014ce7dae7cecc6e4fda9901b4bdcc706afcc807';
const PARSED = { namespaceId: NS, invitation: { group_id: NS }, teamName: 'Design' };

function redeemer(over: Partial<InviteRedeemer> = {}): InviteRedeemer {
  return {
    join: vi.fn().mockResolvedValue(undefined),
    memberships: vi.fn().mockResolvedValue([]),
    ...over,
  };
}

describe('redeemInvitation', () => {
  it('reports a clean join', async () => {
    const out = await redeemInvitation(PARSED, redeemer({ memberships: vi.fn().mockResolvedValue([NS]) }));
    expect(out).toEqual({ status: 'joined', namespaceId: NS, teamName: 'Design' });
    expect(shouldRetain(out)).toBe(false);
  });

  // The desktop proxy aborts at 30s; a join with no member online takes up to
  // 95s and lands anyway. Reading that as a failure made a used invitation
  // replay on every load.
  it('reports already-member when the request failed but the node joined', async () => {
    const out = await redeemInvitation(
      PARSED,
      redeemer({
        join: vi.fn().mockRejectedValue(new HTTPError(0, 'Network Error', 'u', new Headers(), 'aborted')),
        memberships: vi.fn().mockResolvedValue([NS]),
      }),
    );
    expect(out).toMatchObject({ status: 'already-member', namespaceId: NS });
    expect(isSettled(out)).toBe(true);
  });

  // The membership check must never be able to demote a join whose request
  // already resolved.
  it('keeps a resolved join even when the membership check throws', async () => {
    const out = await redeemInvitation(
      PARSED,
      redeemer({ memberships: vi.fn().mockRejectedValue(new Error('network')) }),
    );
    expect(out.status).toBe('joined');
  });

  it('treats an unreadable membership list as unknown, not as absent', async () => {
    const out = await redeemInvitation(
      PARSED,
      redeemer({
        join: vi.fn().mockRejectedValue(new Error('could not reach any member')),
        memberships: vi.fn().mockRejectedValue(new Error('network')),
      }),
    );
    expect(out).toMatchObject({ status: 'failed', reason: 'unknown', retryable: true });
    expect(shouldRetain(out)).toBe(true);
  });

  it('never sends a second join to settle an ambiguous one', async () => {
    const join = vi.fn().mockRejectedValue(new Error('timed out'));
    await redeemInvitation(PARSED, redeemer({ join, memberships: vi.fn().mockResolvedValue([NS]) }));
    expect(join).toHaveBeenCalledTimes(1);
  });

  it("carries the node's own words, not the status line", async () => {
    const out = await redeemInvitation(
      PARSED,
      redeemer({ join: vi.fn().mockRejectedValue(httpError(503, 'could not reach any member of this namespace')) }),
    );
    expect(out).toMatchObject({
      status: 'failed',
      message: 'could not reach any member of this namespace',
    });
  });

  describe("reads the node's status (core rc.56+)", () => {
    it.each([
      [400, 'a malformed invitation', 'invalid'],
      [403, 'node is not a member of group g', 'refused'],
      [409, 'invitation for group g expired at 1759000000 (unix seconds)', 'expired'],
      [409, 'member was removed from group g', 'refused'],
      [410, 'gone', 'expired'],
    ] as const)('a %i is final, so the invitation is dropped (%s)', async (status, message, reason) => {
      const out = await redeemInvitation(
        PARSED,
        redeemer({ join: vi.fn().mockRejectedValue(httpError(status, message)) }),
      );
      expect(out).toMatchObject({ status: 'failed', reason, retryable: false });
      expect(shouldRetain(out)).toBe(false);
    });

    it.each([
      [401, 'signed-out'],
      [503, 'no-one-online'],
      [504, 'no-one-online'],
      [0, 'node-unreachable'],
      [404, 'unknown'],
      [413, 'unknown'],
      [429, 'unknown'],
      [500, 'unknown'],
    ] as const)('a %i keeps the invitation for another attempt (%s)', async (status, reason) => {
      const out = await redeemInvitation(
        PARSED,
        redeemer({ join: vi.fn().mockRejectedValue(httpError(status, 'no')) }),
      );
      expect(out).toMatchObject({ status: 'failed', reason, retryable: true });
      expect(shouldRetain(out)).toBe(true);
    });

    it('reads an axios-style response status too', async () => {
      const out = await redeemInvitation(
        PARSED,
        redeemer({
          join: vi.fn().mockRejectedValue({ response: { status: 403, data: { error: 'not a member' } } }),
        }),
      );
      expect(out).toMatchObject({ reason: 'refused', retryable: false, message: 'not a member' });
    });

    // A node older than rc.56 answered every refusal as 500; its message is
    // still read, so an expired link is not kept forever.
    it("still recognises an old node's refusal by its message", async () => {
      for (const message of [
        'invitation expired',
        'invitation for group ContextGroupId(Identity([12, 34])) expired at 1759000000 (unix seconds)',
        'invitation for group ContextGroupId(Identity([12, 34])) is invalid: it carries no application_id',
      ]) {
        const out = await redeemInvitation(
          PARSED,
          redeemer({ join: vi.fn().mockRejectedValue(httpError(500, message)) }),
        );
        expect(out).toMatchObject({ status: 'failed', retryable: false });
      }
    });

    it('treats a fetch that never reached the node as unreachable', async () => {
      const out = await redeemInvitation(
        PARSED,
        redeemer({ join: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) }),
      );
      expect(out).toMatchObject({ reason: 'node-unreachable', retryable: true });
    });
  });
});
