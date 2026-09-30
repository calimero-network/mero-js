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
 * `crates/primitives/src/context.rs` (`GroupMemberRole`),
 * `crates/account/src/namespace_id.rs` (`founded_namespace_id`), and the vectors in
 * `crates/governance-types/src/tests.rs` (`delegated_governance_op_vectors_are_stable`).
 */

import { CAPABILITIES, hasCap } from '../capabilities.js';
import { concat, domainHash, fromHex, fromHexUnsized, hex, u32le } from '../crypto/internal.js';

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
  MemberCapabilitySet: 5,
  DefaultCapabilitiesSet: 6,
  ContextDetached: 9,
  SubgroupVisibilitySet: 10,
  GroupMetadataSet: 11,
  MemberMetadataSet: 12,
  ContextMetadataSet: 13,
  ContextCapabilityGranted: 16,
  ContextCapabilityRevoked: 17,
} as const;

/** `RootOp` discriminants, by position in core's enum. */
const ROOT_OP = {
  GroupCreated: 0,
  GroupReparented: 1,
  GroupDeleted: 2,
  MemberJoinedOpen: 7,
  NamespaceCreatedV2: 9,
} as const;

/** core's `NAMESPACE_ID_DOMAIN`, which a founded namespace id is hashed under. */
const NAMESPACE_ID_DOMAIN = new TextEncoder().encode('calimero.namespace.id.v1');

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

/**
 * Set the group's default capability mask (`MemberCapabilities` bits, a `u32`),
 * the capabilities every member holds without a per-member grant. Needs admin.
 *
 * The relay refuses any change to `CAN_AUTHOR_ON_BEHALF` (bit 9) through this
 * path, and no namespace starts with it in its default mask, so a mask that
 * sets it is refused here rather than burning a nonce on a certain 403.
 */
export function defaultCapabilitiesSetOp(capabilities: number): GovernanceOp {
  if (!Number.isInteger(capabilities) || capabilities < 0 || capabilities > 0xffff_ffff) {
    throw new Error(`capabilities must be a u32 bit mask, got ${String(capabilities)}`);
  }
  // Never changed through a relay.
  if (hasCap(capabilities, CAPABILITIES.CAN_AUTHOR_ON_BEHALF)) {
    throw new Error(
      'capabilities may not include CAN_AUTHOR_ON_BEHALF (512): a relay never carries a change to it',
    );
  }
  return {
    kind: 'group',
    bytes: concat(tag(GROUP_OP.DefaultCapabilitiesSet), u32le(capabilities)),
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

/**
 * The id of the namespace `founder` founds with `salt`: core's
 * `founded_namespace_id`, `domain_hash("calimero.namespace.id.v1", [founder, salt])`.
 *
 * Anyone holding the pair can recompute it, and only the founder's account
 * hashes to it, which is why a relay founding a namespace for a member cannot
 * choose the id: the member computes it and signs it.
 */
export async function foundedNamespaceId(founder: string, salt: string): Promise<string> {
  return hex(
    await domainHash(NAMESPACE_ID_DOMAIN, [
      fromHex(founder, 'founder', 32),
      fromHex(salt, 'salt', 32),
    ]),
  );
}

/** What a namespace is founded with. */
export interface NamespaceCreatedInput {
  /** The founding account, hex: the **author's**. It becomes founder, owner and admin. */
  founder: string;
  /**
   * The founder's `AccountProof<DeviceCert>`, hex: the credential the author
   * already presents as `authorProof`. Its account must be `founder` and its
   * device key the one that signs the warrant; the genesis apply checks both
   * and binds the founder's device from it.
   */
  credential: string;
  /**
   * The salt the namespace id is derived with, hex (32 bytes). Choose it at
   * random; {@link foundedNamespaceId} gives the id it yields.
   */
  salt: string;
}

/**
 * Found a namespace: core's `RootOp::NamespaceCreatedV2` genesis, a root op
 * published on the new namespace's own log.
 *
 * Its delegable form is the op itself, nothing cleared, so the author signs the
 * exact genesis. Borsh is `[9] || founder || credential || salt`: the credential
 * is a nested struct, not a length-prefixed byte string, so it is written
 * inline. The warrant's scope must be {@link foundedNamespaceId}`(founder, salt)`.
 */
export function namespaceCreatedOp(input: NamespaceCreatedInput): GovernanceOp {
  const credential = fromHexUnsized(input.credential, 'credential');
  if (credential.length === 0) {
    throw new Error('credential must be the founder\'s AccountProof<DeviceCert>, got nothing');
  }
  return {
    kind: 'root',
    bytes: concat(
      tag(ROOT_OP.NamespaceCreatedV2),
      fromHex(input.founder, 'founder', 32),
      credential,
      fromHex(input.salt, 'salt', 32),
    ),
  };
}

// ---------------------------------------------------------------------------
// The rest of the delegable set. Layouts are pinned against core's
// `delegable_governance_op_vectors_for_non_rust_encoders_are_stable`
// (crates/governance-types/src/tests.rs, core#4272).

/** A borsh `String`: a u32 byte length, then the UTF-8 bytes. */
function str(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  return concat(u32le(bytes.length), bytes);
}

/** A borsh `Option<String>`: 0, or 1 then the string. */
function optionalStr(value: string | undefined): Uint8Array {
  return value === undefined ? tag(0) : concat(tag(1), str(value));
}

/**
 * A borsh `BTreeMap<String, String>`: a u32 count, then each entry in the
 * map's own order, which is by key BYTES (not JS string order).
 */
function stringMap(data: Record<string, string> = {}): Uint8Array {
  const enc = new TextEncoder();
  const entries = Object.entries(data)
    .map(([k, v]) => [enc.encode(k), v, k] as const)
    .sort(([a], [b]) => {
      for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
      return a.length - b.length;
    });
  return concat(u32le(entries.length), ...entries.flatMap(([, v, k]) => [str(k), str(v)]));
}

/** Validate a u32 capability mask a relay may carry: never bit 9. */
function relayableMask(capabilities: number, what: string): number {
  if (!Number.isInteger(capabilities) || capabilities < 0 || capabilities > 0xffff_ffff) {
    throw new Error(`${what} must be a u32 bit mask, got ${String(capabilities)}`);
  }
  if (hasCap(capabilities, CAPABILITIES.CAN_AUTHOR_ON_BEHALF)) {
    throw new Error(`${what} may not include CAN_AUTHOR_ON_BEHALF (512): a relay never carries a change to it`);
  }
  return capabilities;
}

/** Set `member`'s capabilities in the group (`GroupOp::MemberCapabilitySet`). Bit 9 is refused. */
export function memberCapabilitySetOp(member: string, capabilities: number): GovernanceOp {
  return {
    kind: 'group',
    bytes: concat(tag(GROUP_OP.MemberCapabilitySet), fromHex(member, 'member', 32), u32le(relayableMask(capabilities, 'capabilities'))),
  };
}

/** Detach a context from the group (`GroupOp::ContextDetached`). */
export function contextDetachedOp(contextId: string): GovernanceOp {
  return { kind: 'group', bytes: concat(tag(GROUP_OP.ContextDetached), fromHex(contextId, 'contextId', 32)) };
}

/** Make a subgroup open (members of the parent may join it themselves) or restricted. */
export function subgroupVisibilitySetOp(mode: 'open' | 'restricted'): GovernanceOp {
  if (mode !== 'open' && mode !== 'restricted') throw new Error(`mode must be open or restricted, got ${String(mode)}`);
  return { kind: 'group', bytes: concat(tag(GROUP_OP.SubgroupVisibilitySet), tag(mode === 'open' ? 0 : 1)) };
}

/** Name the group, with optional key/value data (`GroupOp::GroupMetadataSet`). */
export function groupMetadataSetOp(input: { name?: string; data?: Record<string, string> } = {}): GovernanceOp {
  return { kind: 'group', bytes: concat(tag(GROUP_OP.GroupMetadataSet), optionalStr(input.name), stringMap(input.data)) };
}

/** Name a member in the group (`GroupOp::MemberMetadataSet`). */
export function memberMetadataSetOp(
  member: string,
  input: { name?: string; data?: Record<string, string> } = {},
): GovernanceOp {
  return {
    kind: 'group',
    bytes: concat(tag(GROUP_OP.MemberMetadataSet), fromHex(member, 'member', 32), optionalStr(input.name), stringMap(input.data)),
  };
}

/** Name a context in the group (`GroupOp::ContextMetadataSet`). */
export function contextMetadataSetOp(
  contextId: string,
  input: { name?: string; data?: Record<string, string> } = {},
): GovernanceOp {
  return {
    kind: 'group',
    bytes: concat(tag(GROUP_OP.ContextMetadataSet), fromHex(contextId, 'contextId', 32), optionalStr(input.name), stringMap(input.data)),
  };
}

function contextCapability(capability: number): Uint8Array {
  if (!Number.isInteger(capability) || capability < 1 || capability > 0xff) {
    throw new Error(`capability must be a non-zero u8, got ${String(capability)}`);
  }
  return tag(capability);
}

/** Grant `member` a per-context capability (`GroupOp::ContextCapabilityGranted`). */
export function contextCapabilityGrantedOp(contextId: string, member: string, capability: number): GovernanceOp {
  return {
    kind: 'group',
    bytes: concat(tag(GROUP_OP.ContextCapabilityGranted), fromHex(contextId, 'contextId', 32), fromHex(member, 'member', 32), contextCapability(capability)),
  };
}

/** Revoke a per-context capability from `member` (`GroupOp::ContextCapabilityRevoked`). */
export function contextCapabilityRevokedOp(contextId: string, member: string, capability: number): GovernanceOp {
  return {
    kind: 'group',
    bytes: concat(tag(GROUP_OP.ContextCapabilityRevoked), fromHex(contextId, 'contextId', 32), fromHex(member, 'member', 32), contextCapability(capability)),
  };
}

/**
 * Join an open subgroup yourself (`RootOp::MemberJoinedOpen`), a root op posted
 * to the namespace. `member` must be the author; `credential` is the author's
 * own `AccountProof<DeviceCert>`, hex, carried as-is. The author's
 * `CAN_JOIN_OPEN_SUBGROUPS` and the open inheritance path are checked as usual.
 */
export function memberJoinedOpenOp(input: { member: string; groupId: string; credential: string }): GovernanceOp {
  return {
    kind: 'root',
    bytes: concat(
      tag(ROOT_OP.MemberJoinedOpen),
      fromHex(input.member, 'member', 32),
      fromHex(input.groupId, 'groupId', 32),
      fromHexUnsized(input.credential, 'credential'),
    ),
  };
}
