/**
 * Minting a group invitation without a node.
 *
 * An invitation is not a governance op. Nothing is published when one is made:
 * it is a bearer credential, `GroupInvitationFromAdmin` borsh-encoded, hashed
 * with SHA-256 and signed by the inviter's key. A node mints one with its own
 * namespace key; an account with **no node** signs it here with its device key.
 *
 * Every peer that later folds the join resolves `inviter_identity` — the
 * signing key — to an account through the namespace's device bindings, and then
 * checks that account holds admin or `CAN_INVITE_MEMBERS` at the join's causal
 * cut. So the device key must be **bound** in the namespace first. It is when
 * the account joined through an invitation; an account that was added by
 * account (`MemberAdded`) has no binding, and a relay has to carry its device
 * link first — see `AdminApiClient.linkAccountDevice` and `signDeviceScope`.
 * Without that, every peer refuses the join as signed by a key "bound to no
 * account".
 *
 * Derived from core:
 *
 * - `GroupInvitationFromAdmin` / `SignedGroupOpenInvitation` —
 *   `crates/context/config/src/types.rs`
 * - the signing — `crates/context/src/handlers/create_group_invitation.rs`:
 *   `sign(sha256(borsh(invitation)))`
 * - the admitter default — `NamespaceMembershipService::default_admitters`
 *
 * The unit tests pin bytes and a signature produced by core's own types.
 */
import type {
  GroupInvitationFromAdmin,
  GroupMember,
  SignedGroupOpenInvitation,
} from '../admin-api/admin-types.js';
import { concat, fromHex, hex, u32le, u64le } from '../crypto/internal.js';
import { resolveSigner, type Signer } from '../signer/signer.js';

/**
 * Core's `MAX_INVITATION_VALIDITY_SECS`: one day. Core clamps what a node mints
 * to it, and this does the same, so a leaked invitation is redeemable no longer
 * than one a node would have issued.
 */
export const MAX_INVITATION_VALIDITY_SECS = 24 * 60 * 60;

/** `invited_role` values, as core numbers them. */
export const INVITED_ROLE = { Admin: 0, Member: 1, ReadOnly: 2 } as const;

/** Borsh-encode the signed body of an invitation, field for field with core. */
export function encodeGroupInvitation(body: GroupInvitationFromAdmin): Uint8Array {
  const admitters = body.admitters ?? [];
  return concat(
    // `SignerId` and `ContextGroupId` cross JSON as 32 numbers; `AccountId`
    // crosses as hex. Same width, different spelling.
    bytes32(body.inviter_identity, 'inviter_identity'),
    bytes32(body.group_id, 'group_id'),
    u64le(body.expiration_timestamp),
    bytes32(body.secret_salt, 'secret_salt'),
    new Uint8Array([body.invited_role]),
    u32le(admitters.length),
    ...admitters.map((a, i) => fromHex(a, `admitters[${i}]`, 32)),
  );
}

/** `sha256(borsh(invitation))`: the 32 bytes the inviter's key signs. */
export async function groupInvitationHash(
  body: GroupInvitationFromAdmin,
): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', encodeGroupInvitation(body)),
  );
}

/**
 * The admitters a node names when its caller names none: the group's admins,
 * sorted by account bytes and deduplicated, as core's `BTreeSet` leaves them.
 *
 * Core also adds TEE-admitted accounts, which a member list cannot tell apart
 * from members by role alone; name those in `admitters` explicitly.
 */
export function defaultAdmitters(members: readonly GroupMember[]): string[] {
  const admins = new Set(
    members.filter((m) => m.role === 'Admin').map((m) => m.identity.toLowerCase()),
  );
  // Lowercase hex sorts as the bytes do.
  return [...admins].sort();
}

/** What {@link signGroupInvitation} needs. */
export interface GroupInvitationInput {
  /** The group (or namespace) invited to, 64 hex. */
  groupId: string;
  /**
   * The account the inviter acts as, 64 hex. An unsigned bootstrap hint the
   * joiner seeds the group's admin view from; it confers nothing.
   */
  inviterAccount: string;
  /** The device key as a {@link Signer}. Pass this or {@link deviceSecret}. */
  signer?: Signer;
  /** The device signing secret, 64 hex. Pass this or {@link signer}. */
  deviceSecret?: string;
  /**
   * Accounts permitted to admit a claim, 64 hex each. Signed.
   *
   * Omitted or empty, it defaults to the group's admins, which is what a node
   * does — pass {@link members} (from `listGroupMembers`) to derive them. An
   * empty list would mean *claimable by broadcast*, which publishes the
   * invitation to every subscriber of the namespace topic, so this never
   * produces one.
   */
  admitters?: readonly string[];
  /** The group's members, to default {@link admitters} from. */
  members?: readonly GroupMember[];
  /**
   * The role granted, as {@link INVITED_ROLE} numbers it. Defaults to Member.
   * Only an admin may invite an admin; peers refuse the join otherwise.
   */
  invitedRole?: number;
  /**
   * Seconds from now until it expires, clamped to
   * {@link MAX_INVITATION_VALIDITY_SECS} (also the default).
   */
  validForSecs?: number;
  /** Unix seconds to count from. Defaults to the clock; for tests. */
  now?: number;
  /** The 32-byte uniqueness nonce. Defaults to fresh random bytes. */
  nonce?: Uint8Array;
  /** Unsigned bootstrap: the group's application id, 64 hex. */
  applicationId?: string;
  /** Unsigned bootstrap: the group's `app_key` (core's `bytecode_id`), 64 hex. */
  appKey?: string;
  /** Unsigned bootstrap: multiaddrs for the admitters, `/p2p/<peer>` included. */
  admitterAddrs?: readonly string[];
}

/**
 * Sign a group invitation with a device key, returning it in the JSON shape a
 * node's `createGroupInvitation` returns — so it goes to `joinGroup`,
 * `signMemberJoinOp` and `admitJoin` unchanged.
 */
export async function signGroupInvitation(
  input: GroupInvitationInput,
): Promise<SignedGroupOpenInvitation> {
  const signer = await resolveSigner(input.deviceSecret, input.signer, 'deviceSecret');
  const inviterKey = fromHex(signer.publicKey, 'signer.publicKey', 32);
  const groupId = fromHex(input.groupId, 'groupId', 32);
  fromHex(input.inviterAccount, 'inviterAccount', 32);

  let admitters = [...(input.admitters ?? [])].map((a) => a.trim().toLowerCase());
  if (admitters.length === 0) {
    if (!input.members) {
      throw new Error(
        'name the admitters, or pass the group members to default them to its admins: ' +
          'an invitation with no admitters is claimable by broadcast',
      );
    }
    admitters = defaultAdmitters(input.members);
    if (admitters.length === 0) {
      throw new Error(
        'the member list names no admin, so there is nobody to default the admitters to',
      );
    }
  }
  admitters.forEach((a, i) => fromHex(a, `admitters[${i}]`, 32));

  const invitedRole = input.invitedRole ?? INVITED_ROLE.Member;
  if (![0, 1, 2].includes(invitedRole)) {
    throw new Error(`invitedRole must be 0 (Admin), 1 (Member) or 2 (ReadOnly), got ${invitedRole}`);
  }

  const now = input.now ?? Math.floor(Date.now() / 1000);
  const validFor = Math.min(
    input.validForSecs ?? MAX_INVITATION_VALIDITY_SECS,
    MAX_INVITATION_VALIDITY_SECS,
  );
  if (!Number.isInteger(validFor) || validFor <= 0) {
    throw new Error(`validForSecs must be a positive whole number, got ${input.validForSecs}`);
  }

  const nonce = input.nonce ?? crypto.getRandomValues(new Uint8Array(32));
  if (nonce.length !== 32) {
    throw new Error(`nonce must be 32 bytes, got ${nonce.length}`);
  }

  const invitation: GroupInvitationFromAdmin = {
    inviter_identity: Array.from(inviterKey),
    group_id: Array.from(groupId),
    expiration_timestamp: now + validFor,
    secret_salt: Array.from(nonce),
    invited_role: invitedRole,
    admitters,
  };

  const signature = await signer.sign(await groupInvitationHash(invitation));
  if (signature.length !== 64) {
    throw new Error(`signer returned ${signature.length} bytes, expected a 64-byte Ed25519 signature`);
  }

  const signed: Record<string, unknown> = {
    invitation,
    inviter_signature: hex(signature),
    inviter_account: input.inviterAccount.trim().toLowerCase(),
  };
  if (input.admitterAddrs?.length) signed.admitter_addrs = [...input.admitterAddrs];
  if (input.applicationId) {
    signed.application_id = Array.from(fromHex(input.applicationId, 'applicationId', 32));
  }
  if (input.appKey) signed.app_key = Array.from(fromHex(input.appKey, 'appKey', 32));

  // The brand marks a value as one to pass through unchanged. This one is
  // signed, so it qualifies the same way a node's does.
  return signed as unknown as SignedGroupOpenInvitation;
}

/** A required `[u8; 32]`, as JSON carries it: 32 byte values. */
function bytes32(value: readonly number[], label: string): Uint8Array {
  if (value.length !== 32) {
    throw new Error(`${label} must be 32 bytes, got ${value.length}`);
  }
  return new Uint8Array(value);
}
