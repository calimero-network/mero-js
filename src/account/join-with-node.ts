/**
 * Present a signed join to ONE named node.
 *
 * This is the whole of admission for a caller with no node of its own: sign the
 * membership op with the device key the account certified, and POST it to a node
 * the invitation named as an admitter.
 *
 *     POST /admin-api/namespaces/{namespaceId}/admit
 *     { "invitation": SignedGroupOpenInvitation, "signedOp": "<hex borsh SignedNamespaceOp>" }
 *
 * Verified against core at rc.43 — `crates/server/src/admin/handlers/namespaces/
 * admit_join.rs`, request type `AdmitJoinApiRequest` in
 * `crates/server/primitives/src/admin/mod.rs`. The handler also refuses a
 * mismatch between the invitation's `group_id` and the namespace in the path, so
 * the two are never allowed to disagree here.
 *
 * ## Why it needs no token and no proof
 *
 * The joiner's signature IS the authorization. The op is signed by the device
 * key named in the credential it carries, and every peer checks
 * `signer == credential.statement.sign_pk` before applying a join — so an
 * admitter can carry this and can never author it: it cannot admit a different
 * account, change the group, or grant a role. It can refuse, and that is all.
 * This is also why the fleet ingress leaves the route unauthenticated, and why
 * this posts with `fetch` rather than through `AdminApiClient`, which is built
 * around a node credential this caller does not have.
 *
 * ## Why it lives here and not in mero-js
 *
 * Two reasons. `mero-js` is read-only for this change by instruction, and the
 * shape that is actually useful to a caller is the one that hands back a
 * {@link DelegatedSession} — the node that admitted you is the node to connect
 * through — which is `mero-react`'s concern. The pieces that are pure SDK, the
 * borsh op layout and the request type, are used from `mero-js` unchanged and
 * are not reimplemented here.
 *
 * ## Why the op has no parents
 *
 * A keyholder holds no node, so it has no view of the namespace DAG and cannot
 * name its heads. Empty parents is the only thing it *can* sign, and the direct
 * admission path exists precisely for callers in that position.
 */

import {
  createLocalStorageNonceSource,
} from '../relay/index.js';
import {
  signMemberJoinOp,
} from '../namespace-op/index.js';
import {
  type AdmitJoinRequest,
  type SignedGroupOpenInvitation,
} from '../admin-api/index.js';
import type { DelegatedCredential, DelegatedSession } from './session.js';

/** Which step failed, when one did. */
export type JoinWithNodeStep =
  /** The op could not be signed. Local, deterministic, and nothing was sent. */
  | 'sign'
  /** The node refused it, or could not be reached. */
  | 'admit';

export interface JoinWithNodeSuccess {
  readonly ok: true;
  /**
   * Whether the admitter said it published the op.
   *
   * NOT "you are a member": membership lands when peers apply the op, which the
   * admitter neither performs nor waits for.
   */
  readonly published: boolean;
  /**
   * The session to connect with — the admitting node, used immediately.
   *
   * Deliberately not waiting for `getAccountRelays` to answer: the fleet writes
   * the account's recovery envelope asynchronously, so the cloud lookup lags the
   * admission by an unpredictable amount. The node that just carried the join is
   * known to serve this namespace right now, which is a better answer than a
   * lookup that will agree later.
   */
  readonly session: DelegatedSession;
}

export interface JoinWithNodeFailure {
  readonly ok: false;
  readonly step: JoinWithNodeStep;
  readonly reason: string;
  /** The HTTP status, when the node answered with one. */
  readonly status?: number;
}

export type JoinWithNodeResult = JoinWithNodeSuccess | JoinWithNodeFailure;

export interface JoinWithNodeInput {
  /**
   * The node to present the join to — its admin API origin.
   *
   * The primary parameter, so all three sources of a node URL feed one method:
   * one carried by the invitation (core emits only libp2p multiaddrs today —
   * see `resolve_admitter_addrs`, a node cannot know the URL its admin API is
   * proxied on — so this is the seam for when invitations carry a claim URL),
   * one resolved from the cloud's `/admitters` lookup, and one an operator
   * simply knows.
   */
  readonly nodeUrl: string;
  /**
   * The exact URL to POST to, when something already knows it.
   *
   * The cloud hands back a ready-made `admit_url` which need not be a path on
   * `nodeUrl`'s origin, and rebuilding it from a guess is how a working
   * admission becomes a 404. Omitted, the documented route on `nodeUrl` is used.
   */
  readonly admitUrl?: string;
  /** The namespace being joined, 64 hex. Must match the invitation's group. */
  readonly namespaceId: string;
  /**
   * The invitation, exactly as the inviter's node returned it.
   *
   * Passed through unchanged and never rebuilt field by field: the signature
   * covers the body, and re-modelling it through a local type drops the unsigned
   * bootstrap fields and invalidates the signature with them.
   */
  readonly invitation: SignedGroupOpenInvitation;
  /** The enrolled account, its certificate, and the device secret that signs. */
  readonly credential: DelegatedCredential;
  /** Injected in tests. */
  readonly deps?: {
    readonly fetch?: typeof fetch;
    readonly nonce?: () => Promise<bigint>;
  };
}

/**
 * Turn an admit refusal into the thing to go and do about it.
 *
 * Each status has one dominant cause and they have nothing to do with each
 * other, so a bare "HTTP 403" sends people to the wrong place — most often to
 * the invitation, when the real answer is which node it was presented to.
 */
function explainAdmitFailure(status: number, body: string): string {
  const detail = body ? `: ${body}` : '';
  switch (status) {
    case 400:
      return (
        `The node refused the join as malformed (400)${detail}. The signature covers the ` +
        'invitation exactly as sent, so an edited or re-serialised invitation fails here — as ' +
        "does a namespace id that is not the invitation's own group."
      );
    case 403:
      return (
        `The node refused to carry this join (403)${detail}. Either it is not in the ` +
        "invitation's signed admitters list — being live and listed by the cloud is not the " +
        'same thing — or the invitation itself was rejected as expired or not the inviter’s ' +
        'to issue.'
      );
    case 409:
      return (
        `That node holds no device of its own, so it cannot endorse anyone (409)${detail}. ` +
        'Another admitter from the same invitation would work.'
      );
    default:
      return `The join was not published (HTTP ${status})${detail}.`;
  }
}

/**
 * A join-nonce counter for this account, persisted so a reload does not replay.
 *
 * The device secret never appears in the key: storage keys are enumerable by
 * anything running on the origin. One counter per account is right here — a
 * bootstrap is once per account per device, and the node's receiving window
 * accepts gaps, so a shared counter can only ever skip, never reuse.
 */
function joinNonce(account: string): () => Promise<bigint> {
  const source = createLocalStorageNonceSource(`calimero.delegated.joinnonce.${account}`);
  return () => source.next();
}

/** Strip a trailing slash so a pasted URL and a typed one address one node. */
function origin(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Sign the membership op and present it to `nodeUrl`.
 *
 * Resolves rather than throws for every expected refusal, because they are
 * different things for the person to do: a malformed op is final, an unreachable
 * node is a retry, and a 409 means pick another admitter.
 */
export async function joinWithNode(input: JoinWithNodeInput): Promise<JoinWithNodeResult> {
  const { account, credential, deviceSecret } = input.credential;

  let signedOp: string;
  try {
    signedOp = await signMemberJoinOp({
      namespaceId: input.namespaceId,
      member: account,
      invitation: input.invitation,
      credential,
      deviceSecret,
      nonce: await (input.deps?.nonce ?? joinNonce(account))(),
    });
  } catch (e) {
    return {
      ok: false,
      step: 'sign',
      reason:
        'The join op could not be signed, so nothing was sent: ' +
        `${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // `AdmitJoinRequest` names the shape, so a change to it in mero-js breaks this
  // at the typecheck rather than as a 400 from a node.
  const body: AdmitJoinRequest = { invitation: input.invitation, signedOp };
  const url =
    input.admitUrl ??
    `${origin(input.nodeUrl)}/admin-api/namespaces/${input.namespaceId}/admit`;

  const doFetch = input.deps?.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'POST',
      // No Authorization header and no request proof, deliberately: the route is
      // unauthenticated because the joiner's signature is the authorization.
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return {
      ok: false,
      step: 'admit',
      reason:
        `The admitter at ${input.nodeUrl} could not be reached: ` +
        `${e instanceof Error ? e.message : String(e)}. The invitation is untouched — this is ` +
        'the node being unreachable, not a refusal.',
    };
  }

  const text = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      step: 'admit',
      status: response.status,
      reason: explainAdmitFailure(response.status, text),
    };
  }

  let published = false;
  try {
    const parsed = text ? (JSON.parse(text) as { data?: { published?: boolean } }) : {};
    published = parsed.data?.published === true;
  } catch {
    // A 2xx with a body this client cannot read is still a node that took the
    // call. Reported as "not published" rather than as an error, because that is
    // exactly what is not known.
    published = false;
  }

  return {
    ok: true,
    published,
    session: { relayUrl: origin(input.nodeUrl), account, credential, deviceSecret },
  };
}
