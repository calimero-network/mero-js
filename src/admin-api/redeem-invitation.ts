// ── Redeeming an invitation: joining once, and knowing whether it worked ──────
//
// Deciding "did we join?" by whether the join request resolved is the wrong
// question, and on a real node (core rc.41, 2026-09-22) it failed two ways:
//
//   1. The desktop proxy aborts every admin request at 30s. A namespace join
//      whose members are all offline waits for one to appear — measured at 95s.
//      So the request failed, the join landed anyway, and the app reported
//      "could not join" for a namespace it was already in. It kept the
//      invitation, and replayed it on every load.
//
//   2. A refresh after the join shared its `try`, so a refresh that threw
//      turned a real join into a reported failure.
//
// So membership is the question, and there are two independent proofs of it:
// the request resolving, and the namespace being listed. Either one is enough,
// which matters because either one can be missing.

import { classifyError, messageOf } from '../errors/classify.js';
import { RelayLoginError } from '../account/relay-login-error.js';

/** The two calls a redeem needs, so any client (or any app's join) can drive it. */
export interface InviteRedeemer {
  /**
   * Send the join. Resolve on success, throw on failure.
   *
   * It does not have to be reliable, and it does not have to be idempotent on
   * the client — the node's join is idempotent, and `memberships()` settles any
   * ambiguity this throws.
   */
  join(namespaceId: string, invitation: unknown): Promise<void>;
  /**
   * Namespace ids this node is a member of.
   *
   * Throwing is a legitimate answer ("could not tell") and is treated as such:
   * it never turns a join that succeeded into a failure.
   */
  memberships(): Promise<readonly string[]>;
}

/**
 * Why a join failed, as far as it tells a person what to do next.
 *
 * Read off the HTTP status where the node gives one (core rc.56+ answers a
 * refused join with a 4xx, not a 500), and off the message otherwise.
 */
export type InviteFailureReason =
  /** The invitation's time ran out. Only a new link helps. */
  | 'expired'
  /** The link is malformed or names nothing joinable. Only a new link helps. */
  | 'invalid'
  /**
   * This person already joined with this link once, and has since left. A link
   * admits each person once: only a new one helps.
   */
  | 'already-used'
  /** An admin removed this person. No link readmits them; an admin must re-add them. */
  | 'removed'
  /** The node refused this person for another reason (blocked, not allowed). */
  | 'refused'
  /** This client's session with the node lapsed; signing in finishes it. */
  | 'signed-out'
  /** No member was reachable to let them in yet. Trying later can work. */
  | 'no-one-online'
  /** This client could not reach its own node at all. */
  | 'node-unreachable'
  /** Nothing more specific is known; the node's message is all there is. */
  | 'unknown';

/**
 * What happened, in the terms a UI needs.
 *
 * `already-member` is deliberately a success and deliberately distinct: it is
 * the outcome of following a link twice, or of the timeout above, and telling
 * someone "you are already in this one" is neither an error nor the same
 * message as having just joined.
 */
export type RedeemOutcome =
  | { status: 'joined'; namespaceId: string; teamName?: string }
  | { status: 'already-member'; namespaceId: string; teamName?: string }
  | {
      status: 'failed';
      namespaceId: string | null;
      /** The node's own words, for logs and for a UI that shows detail. */
      message: string;
      /** Why, in terms a person can act on. */
      reason: InviteFailureReason;
      /**
       * Whether trying again later could plausibly work. A malformed token
       * cannot; an unreachable peer can. A caller holding the invitation uses
       * this to decide whether to keep it — see {@link shouldRetain}.
       */
      retryable: boolean;
    };

/** Whether an outcome means the invitation is finished with. */
export function isSettled(outcome: RedeemOutcome): boolean {
  return outcome.status !== 'failed' || !outcome.retryable;
}

/**
 * Whether the invitation should be kept for another attempt later.
 *
 * The inverse of {@link isSettled}, named for the decision it drives.
 */
export function shouldRetain(outcome: RedeemOutcome): boolean {
  return !isSettled(outcome);
}

/**
 * The refusal codes a join route answers with beside `error` (core's
 * `join_refusal_code`), and what each one tells a person.
 *
 * `join_refused_by_member` is absent on purpose: a member that refused may only
 * be behind, so it says nothing final on its own, and the member's own words
 * (in the message) are read by {@link reasonFromMessage} instead.
 */
const REASON_FOR_CODE: Record<string, InviteFailureReason> = {
  invitation_expired: 'expired',
  invitation_invalid: 'invalid',
  invitation_already_used: 'already-used',
  removed_from_group: 'removed',
  reentry_blocked: 'refused',
};

/**
 * The machine-readable `code` a node put beside its `error`, if any: on
 * mero-js's `HTTPError` it is in the body text, on an axios-style error in
 * `response.data`.
 */
function refusalCodeOf(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const shaped = err as { bodyText?: unknown; response?: { data?: { code?: unknown } } };
  if (typeof shaped.response?.data?.code === 'string') return shaped.response.data.code;
  if (typeof shaped.bodyText !== 'string') return undefined;
  try {
    const body = JSON.parse(shaped.bodyText) as { code?: unknown } | null;
    return typeof body?.code === 'string' ? body.code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Which reason the message alone names, for a node that answers without a
 * useful status — older than rc.56, where every refusal was a bare 500 — or
 * without a `code`, or for a member's refusal quoted inside a retryable answer.
 *
 * Kept narrow on purpose. Anything not recognised here stays retryable, because
 * the cost of retrying a dead link is one more attempt, while the cost of
 * discarding a live one is someone who cannot join at all.
 */
function reasonFromMessage(message: string): InviteFailureReason | null {
  const m = message.toLowerCase();
  if (
    m.includes('invitation has expired') ||
    m.includes('invitation expired') ||
    // Core rc.56+ names the group between the words: "invitation for group
    // <id> expired at <secs>".
    /\binvitation for group .+? expired at \d+/.test(m)
  ) {
    return 'expired';
  }
  if (
    m.includes('malformed') ||
    m.includes('does not match namespace_id') ||
    m.includes('invalid invitation') ||
    /\binvitation for group .+? is invalid:/.test(m)
  ) {
    return 'invalid';
  }
  // Core's own words for a spent link and a removal (`MembershipError`), which a
  // refusing member also quotes back to the joiner.
  if (m.includes('has already used this invitation')) return 'already-used';
  if (/\bwas removed from group\b/.test(m)) return 'removed';
  return null;
}

/**
 * The reasons that are final whatever status carried them: no later attempt
 * with this link can succeed for this person.
 */
const FINAL_FROM_TEXT: ReadonlySet<InviteFailureReason> = new Set(['already-used', 'removed']);

/**
 * Why a join failed, and whether a later attempt could work.
 *
 * The status decides where there is one. A 4xx the node chose is a definitive
 * answer about this invitation or this person, so it is not retried; a 5xx or
 * no answer at all is about the moment, so it is. Two exceptions keep an
 * invitation that is still good: a 401 is the client's session, not the
 * invitation, and a 404 is not specific enough to throw a link away on.
 */
function classifyJoinFailure(
  err: unknown,
  message: string,
): { reason: InviteFailureReason; retryable: boolean } {
  // The join never left: the relay session it needed could not be minted. Says
  // nothing about the invitation, which is kept for after a sign-in or a retry.
  if (err instanceof RelayLoginError) {
    return { reason: err.kind === 'signed-out' ? 'signed-out' : 'node-unreachable', retryable: true };
  }
  const { kind, status } = classifyError(err);
  const fromText = reasonFromMessage(message);

  // A code is the node naming the refusal itself: nothing below can know better.
  const code = refusalCodeOf(err);
  const fromCode = code ? REASON_FOR_CODE[code] : undefined;
  if (fromCode) return { reason: fromCode, retryable: false };
  // A spent link or a removal is final even when a member said it inside a
  // retryable answer (a 503 for a join every peer refused): asking again only
  // asks the same members, who will say the same.
  if (fromText && FINAL_FROM_TEXT.has(fromText)) return { reason: fromText, retryable: false };
  // Any other member refusal is not "no one is online": someone answered, and
  // their words are the message. Kept, since a member behind on the team's
  // history refuses what it has not seen yet.
  if (code === 'join_refused_by_member') return { reason: 'unknown', retryable: true };

  if (status === 401) return { reason: 'signed-out', retryable: true };
  if (status === 400) return { reason: fromText ?? 'invalid', retryable: false };
  if (status === 410) return { reason: 'expired', retryable: false };
  if (status === 403) return { reason: 'refused', retryable: false };
  // An expired invitation, a spent one, a member who was removed or blocked:
  // every 409 a join can answer is final.
  if (status === 409) return { reason: fromText ?? 'refused', retryable: false };
  if (kind === 'unavailable') return { reason: 'no-one-online', retryable: true };
  if (kind === 'unreachable') return { reason: 'node-unreachable', retryable: true };
  // A 500 from a node older than rc.56 may still be a refusal in disguise;
  // anything else has only its message to go on.
  if (fromText) return { reason: fromText, retryable: false };
  return { reason: 'unknown', retryable: true };
}

/**
 * Join the namespace an invitation names, and report what happened.
 *
 * Sends the join once and never retries it: a failed request whose namespace
 * is then listed is `already-member`, not a failure. Never throws for an
 * ordinary failure — the outcome carries it, because every caller has to branch
 * on "already a member" anyway.
 *
 * Most callers want {@link AdminApiClient.redeemInvitation}, which supplies the
 * redeemer from the admin API. This form is for a join that is more than one
 * call — a namespace followed by the context inside it, say.
 */
export async function redeemInvitation(
  parsed: { namespaceId: string; invitation: unknown; teamName?: string },
  redeemer: InviteRedeemer,
): Promise<RedeemOutcome> {
  const { namespaceId, invitation, teamName } = parsed;

  let joinError: unknown = null;
  try {
    await redeemer.join(namespaceId, invitation);
  } catch (err) {
    joinError = err;
  }

  // The request resolving is proof on its own, so this must not be able to
  // demote a real join: a `memberships()` that throws is "could not tell".
  let listed: boolean | null = null;
  try {
    listed = (await redeemer.memberships()).includes(namespaceId);
  } catch {
    listed = null;
  }

  if (joinError === null) {
    return { status: 'joined', namespaceId, teamName };
  }
  if (listed === true) {
    // The join landed despite the error — an aborted request, or a link
    // followed twice.
    return { status: 'already-member', namespaceId, teamName };
  }

  const message = messageOf(joinError, 'Could not join. Check the invitation.');
  const { reason, retryable } = classifyJoinFailure(joinError, message);
  return { status: 'failed', namespaceId, message, reason, retryable };
}
