import { describe, it, expect, vi } from 'vitest';
import {
  redeemInvitation,
  shouldRetain,
  isSettled,
  type InviteRedeemer,
} from './redeem-invitation.js';
import { HTTPError } from '../http-client/index.js';
import { RelayLoginError } from '../account/relay-login-error.js';

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
      [409, 'identity i was removed from group g and cannot rejoin; an admin must re-add them', 'removed'],
      [409, 'identity i has already used this invitation to join group g; a new invitation is required', 'already-used'],
      [409, 'some other conflict', 'refused'],
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

    // The join never left: the relay session it needed could not be minted.
    // A refused login (even a 403) is the credential, not the invitation.
    it.each([
      [401, 'signed-out'],
      [403, 'signed-out'],
      [0, 'node-unreachable'],
      [502, 'node-unreachable'],
    ] as const)('a relay login failing with %i keeps the invitation (%s)', async (status, reason) => {
      const err = new RelayLoginError('https://relay', httpError(status, 'no'));
      const out = await redeemInvitation(PARSED, redeemer({ join: vi.fn().mockRejectedValue(err) }));
      expect(out).toMatchObject({ status: 'failed', reason, retryable: true });
      expect(shouldRetain(out)).toBe(true);
    });

    // Core answers a join refusal with a `code` beside `error`; it names the
    // refusal even where the status alone cannot (several share a 409).
    it.each([
      [409, 'invitation_already_used', 'already-used'],
      [409, 'removed_from_group', 'removed'],
      [409, 'invitation_expired', 'expired'],
      [400, 'invitation_invalid', 'invalid'],
      [409, 'reentry_blocked', 'refused'],
    ] as const)('a %i with code %s is final (%s)', async (status, code, reason) => {
      const err = new HTTPError(
        status,
        'Status',
        'http://node/join',
        new Headers(),
        JSON.stringify({ error: 'no', code }),
      );
      const out = await redeemInvitation(PARSED, redeemer({ join: vi.fn().mockRejectedValue(err) }));
      expect(out).toMatchObject({ status: 'failed', reason, retryable: false });
    });

    // Every peer that answered refused. A member quoting a removal or a spent
    // link is final; anything else it said is shown, and the link is kept.
    it("reads a refusing member's words inside a 503", async () => {
      const refused = (error: string) =>
        new HTTPError(
          503,
          'Service Unavailable',
          'http://node/join',
          new Headers(),
          JSON.stringify({ error, code: 'join_refused_by_member' }),
        );

      const removed = await redeemInvitation(
        PARSED,
        redeemer({
          join: vi
            .fn()
            .mockRejectedValue(
              refused(
                'join could not be endorsed: a member of this namespace refused it: identity i was removed from group g and cannot rejoin; an admin must re-add them',
              ),
            ),
        }),
      );
      expect(removed).toMatchObject({ reason: 'removed', retryable: false });

      const behind = await redeemInvitation(
        PARSED,
        redeemer({
          join: vi
            .fn()
            .mockRejectedValue(
              refused('join could not be endorsed: a member of this namespace refused it: group not found'),
            ),
        }),
      );
      expect(behind).toMatchObject({
        reason: 'unknown',
        retryable: true,
        message: 'join could not be endorsed: a member of this namespace refused it: group not found',
      });
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
