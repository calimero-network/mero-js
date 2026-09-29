/**
 * Encode the governance ops a member may have a relay publish for them.
 *
 * A governance warrant commits to an op's **borsh bytes**, not to a description
 * of it, so the client has to produce exactly the bytes the node decodes. These
 * encoders cover the delegable ops (core's `GroupOp::delegable_form` and
 * `RootOp::delegable_form`) that a keyholder app is likely to need. Every
 * discriminant is a variant's position in core's enum, which is how borsh
 * encodes a Rust enum; they are pinned against core's own vectors in the test.
 *
 * **Delegable form.** A removal, a leave and a cascade delete carry fields only
 * the publisher can compute (post-state hashes, the enumerated subtree). The
 * member signs them cleared, and these encoders only ever produce the cleared
 * form, which is the one a relay accepts. The relay fills them in afterwards.
 *
 * Sources in core, for the next person to check a discriminant:
 * `crates/governance-types/src/lib.rs` (`GroupOp`, `RootOp`),
 * `crates/primitives/src/context.rs` (`GroupMemberRole`), and the vectors in
 * `crates/governance-types/src/tests.rs` (`delegated_governance_op_vectors_are_stable`).
 */

import { concat, fromHex, u32le } from '../crypto/internal.js';

/**
 * Which plane an op is published on: `group` is a `GroupOp` on the group's own
 * log, `root` a `RootOp` on the namespace log. The kind is signed over, so
 * consent to one can never be presented as the other.
 */
export type GovernanceOpKind = 'group' | 'root';

/** An encoded governance op and the plane it belongs to. */
export interface GovernanceOp {
  kind: GovernanceOpKind;
  /** The op's borsh bytes in delegable form: what the warrant commits to. */
  bytes: Uint8Array;
}

/** A group member's role. Borsh discriminants follow core's `GroupMemberRole`. */
export type GovernanceMemberRole = 'Admin' | 'Member' | 'ReadOnly';

/**
 * `GroupMemberRole` discriminants. The two TEE roles (3 and 4) are minted only
 * by attestation admission and never by a member's op, so they are not offered.
 */
const ROLE: Record<GovernanceMemberRole, number> = {
  Admin: 0,
  Member: 1,
  ReadOnly: 2,
};

/** `GroupOp` discriminants, by position in core's enum. */
const GROUP_OP = {
  MemberAdded: 1,
  MemberRemoved: 2,
  MemberLeft: 3,
  MemberRoleSet: 4,
} as const;

/** `RootOp` discriminants, by position in core's enum. */
const ROOT_OP = {
  GroupCreated: 0,
  GroupReparented: 1,
  GroupDeleted: 2,
} as const;

/** A post-state hash left for the relay to compute: 32 zero bytes. */
const CLEARED_HASH = new Uint8Array(32);
/** An empty borsh `Vec`: a zero `u32` count. */
const EMPTY_VEC = u32le(0);

function role(value: GovernanceMemberRole): Uint8Array {
  const byte = ROLE[value];
  if (byte === undefined) {
    throw new Error(`role must be Admin, Member or ReadOnly, got ${String(value)}`);
  }
  return new Uint8Array([byte]);
}

function tag(byte: number): Uint8Array {
  return new Uint8Array([byte]);
}

/**
 * Add `member` (an account, hex) to the group with `role`.
 *
 * Applied as the author: adding a `Member` needs `MANAGE_MEMBERS` or admin,
 * adding an `Admin` needs admin.
 */
export function memberAddedOp(member: string, memberRole: GovernanceMemberRole): GovernanceOp {
  return {
    kind: 'group',
    bytes: concat(tag(GROUP_OP.MemberAdded), fromHex(member, 'member', 32), role(memberRole)),
  };
}

/**
 * Remove `member` (an account, hex) from the group, in delegable form: both
 * post-state claims cleared, for the relay to compute from its own view.
 */
export function memberRemovedOp(member: string): GovernanceOp {
  return {
    kind: 'group',
    bytes: concat(
      tag(GROUP_OP.MemberRemoved),
      fromHex(member, 'member', 32),
      CLEARED_HASH,
      EMPTY_VEC,
    ),
  };
}

/**
 * The author leaves the group, in delegable form. The node applies it only when
 * `member` is the author's own account.
 */
export function memberLeftOp(member: string): GovernanceOp {
  return {
    kind: 'group',
    bytes: concat(
      tag(GROUP_OP.MemberLeft),
      fromHex(member, 'member', 32),
      CLEARED_HASH,
      EMPTY_VEC,
    ),
  };
}

/** Set `member`'s role (an account, hex). */
export function memberRoleSetOp(member: string, memberRole: GovernanceMemberRole): GovernanceOp {
  return {
    kind: 'group',
    bytes: concat(tag(GROUP_OP.MemberRoleSet), fromHex(member, 'member', 32), role(memberRole)),
  };
}

/** What a subgroup is created with. */
export interface GroupCreatedInput {
  /** The new subgroup's id, hex (32 bytes). Choose it fresh; a taken id is refused. */
  groupId: string;
  /** The group it is nested under, hex: the namespace root or an existing subgroup. */
  parentId: string;
  /** `true` for a Restricted subgroup (the usual default), `false` for born-Open. */
  restricted: boolean;
  /**
   * The subgroup's founding admin, hex: the **author's** account. The node
   * refuses any other, since the op is applied as the author.
   */
  admin: string;
}

/**
 * Create a subgroup under `parentId`, a root op published on the namespace.
 *
 * Needs `CAN_CREATE_SUBGROUP` or admin on the parent; the author, not the
 * relay, becomes the new subgroup's admin.
 */
export function groupCreatedOp(input: GroupCreatedInput): GovernanceOp {
  return {
    kind: 'root',
    bytes: concat(
      tag(ROOT_OP.GroupCreated),
      fromHex(input.groupId, 'groupId', 32),
      fromHex(input.parentId, 'parentId', 32),
      tag(input.restricted ? 1 : 0),
      fromHex(input.admin, 'admin', 32),
    ),
  };
}

/** Move `childGroupId` under `newParentId`, a root op. */
export function groupReparentedOp(childGroupId: string, newParentId: string): GovernanceOp {
  return {
    kind: 'root',
    bytes: concat(
      tag(ROOT_OP.GroupReparented),
      fromHex(childGroupId, 'childGroupId', 32),
      fromHex(newParentId, 'newParentId', 32),
    ),
  };
}

/**
 * Delete `rootGroupId` and its subtree, in delegable form: both cascade lists
 * empty, for the relay to enumerate.
 */
export function groupDeletedOp(rootGroupId: string): GovernanceOp {
  return {
    kind: 'root',
    bytes: concat(tag(ROOT_OP.GroupDeleted), fromHex(rootGroupId, 'rootGroupId', 32), EMPTY_VEC, EMPTY_VEC),
  };
}
