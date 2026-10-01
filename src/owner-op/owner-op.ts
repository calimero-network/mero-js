/**
 * Root proofs for owner-level governance ops (core schema 18).
 *
 * A device key speaks for its account everywhere in governance, so a stolen
 * device used to be enough to take a group from its owner: promote an
 * accomplice, transfer ownership, remove the owner. Core now refuses the ops
 * that can do that unless they carry an authorisation signed by the account's
 * **root** key, which a device does not hold:
 *
 * - `GroupOp::TransferOwnership`, `GroupOp::GroupDelete` and
 *   `RootOp::AdminChanged`, which are owner-only;
 * - the TEE admission, release-admission and authoring policies, which stay
 *   admin-level but need the signing admin's own root.
 *
 * A node that holds the account root (as `merod init` provisions) signs the
 * proof itself, so a caller on such a node passes nothing. This module is for
 * the other case: a nodeless account, or a root kept cold, signing offline and
 * passing the hex proof as `rootProof`.
 *
 * What the root signs binds the account, the namespace, the group, the kind of
 * op, a digest of the op's own borsh bytes, the root epoch, and the group's
 * guarded-op counter. Read that counter (`ownerOpCounter`, with `namespaceId`)
 * from `getGroupInfo` first: the node applies a proof only while the group is
 * still at that count, and advances it once the op applies, so each proof is
 * single-use. For `AdminChanged` and the TEE policies the group is the
 * namespace root.
 *
 * Byte layouts follow core's `calimero_account::OwnerOpAuthorization` and
 * `calimero_governance_types::{GroupOp, RootOp}`. They are pinned against core's
 * own vectors (`crates/account/src/tests/owner_op.rs`,
 * `root_guarded_vectors_are_stable` in `crates/governance-types/src/tests.rs`)
 * in `owner-op.test.ts`.
 */
import {
  concat,
  derivePublicKey,
  domainHash,
  fromHex,
  fromHexUnsized,
  hex,
  importSigningKey,
  u32le,
  u64le,
} from '../crypto/internal.js';

/** core's `OWNER_OP_SIGN_DOMAIN`: what the root signs under. */
const OWNER_OP_SIGN_DOMAIN = new TextEncoder().encode('calimero.account.owner-op.v1');
/** core's `OWNER_OP_BODY_DOMAIN`: what the op's bytes are hashed under. */
const OWNER_OP_BODY_DOMAIN = new TextEncoder().encode('calimero.account.owner-op.body.v1');
/** core's `ACCOUNT_ID_DOMAIN`. */
const ACCOUNT_ID_DOMAIN = new TextEncoder().encode('calimero.account.genesis.v1');
/** core's `ACCOUNT_GENESIS_VERSION`. */
const ACCOUNT_GENESIS_VERSION = 2;

/**
 * Which owner-level op a proof authorises. The value is the byte core signs,
 * its `OwnerOpKind` discriminant.
 */
export const OWNER_OP_KIND = {
  transferOwnership: 0,
  adminChanged: 1,
  groupDelete: 2,
  teeAdmissionPolicy: 3,
  teeAuthoringPolicy: 4,
  teeReleaseAdmissionPolicy: 5,
} as const;

export type OwnerOpKind = keyof typeof OWNER_OP_KIND;

/** Which plane the op is on: a `GroupOp` on a group, or a `RootOp` on the namespace. */
export type OwnerOpPlane = 'group' | 'root';

/** An encoded owner-level op: its borsh bytes, its kind and its plane. */
export interface OwnerOp {
  kind: OwnerOpKind;
  plane: OwnerOpPlane;
  /** The op's borsh bytes: exactly what the node builds, and what the digest covers. */
  bytes: Uint8Array;
}

/** `GroupOp` discriminants, by position in core's enum. */
const GROUP_OP = {
  GroupDelete: 14,
  TransferOwnership: 21,
  TeeAuthoringPolicySet: 33,
  TeeAdmissionPolicySetV2: 37,
  TeeReleaseAdmissionPolicySetV2: 38,
  RootGuarded: 42,
} as const;

/** `RootOp` discriminants, by position in core's enum. */
const ROOT_OP = {
  AdminChanged: 3,
  RootGuarded: 12,
} as const;

/** core's `TeeAdmissionMode` discriminants. */
const TEE_MODE = { replica: 0, relay: 1 } as const;

const te = new TextEncoder();

function tag(byte: number): Uint8Array {
  return new Uint8Array([byte]);
}

function borshString(value: string): Uint8Array {
  const bytes = te.encode(value);
  return concat(u32le(bytes.length), bytes);
}

function borshStrings(values: string[]): Uint8Array {
  return concat(u32le(values.length), ...values.map(borshString));
}

function borshBool(value: boolean): Uint8Array {
  return tag(value ? 1 : 0);
}

function teeMode(mode: 'replica' | 'relay' | undefined): Uint8Array {
  const byte = TEE_MODE[mode ?? 'replica'];
  if (byte === undefined) {
    throw new Error(`mode must be replica or relay, got ${String(mode)}`);
  }
  return tag(byte);
}

/** Hand the group to `newOwner` (an account, hex), who must already be an admin. */
export function transferOwnershipOp(newOwner: string): OwnerOp {
  return {
    kind: 'transferOwnership',
    plane: 'group',
    bytes: concat(tag(GROUP_OP.TransferOwnership), fromHex(newOwner, 'newOwner', 32)),
  };
}

/** The owner-only deletion of a group that holds no contexts. */
export function groupDeleteOp(): OwnerOp {
  return { kind: 'groupDelete', plane: 'group', bytes: tag(GROUP_OP.GroupDelete) };
}

/** Repoint the namespace's admin pin at `newAdmin` (an account, hex). A root op. */
export function adminChangedOp(newAdmin: string): OwnerOp {
  return {
    kind: 'adminChanged',
    plane: 'root',
    bytes: concat(tag(ROOT_OP.AdminChanged), fromHex(newAdmin, 'newAdmin', 32)),
  };
}

/** The TEE authoring policy `PUT`/`DELETE …/settings/tee-authoring-policy` publishes. */
export function teeAuthoringPolicyOp(allowedMrtd: string[]): OwnerOp {
  return {
    kind: 'teeAuthoringPolicy',
    plane: 'group',
    bytes: concat(tag(GROUP_OP.TeeAuthoringPolicySet), borshStrings(allowedMrtd)),
  };
}

/** A measurement-list admission policy, as the node publishes it (the V2 form). */
export interface TeeAdmissionPolicyOpInput {
  allowedMrtd: string[];
  allowedRtmr0: string[];
  allowedRtmr1: string[];
  allowedRtmr2: string[];
  allowedRtmr3: string[];
  allowedTcbStatuses: string[];
  acceptMock: boolean;
  mode?: 'replica' | 'relay';
}

/**
 * The measurement-list admission policy `PUT …/settings/tee-admission-policy`
 * publishes. Pass the fields exactly as you send them: the node signs over the
 * op it builds from them, and any difference is a different op.
 */
export function teeAdmissionPolicyOp(input: TeeAdmissionPolicyOpInput): OwnerOp {
  return {
    kind: 'teeAdmissionPolicy',
    plane: 'group',
    bytes: concat(
      tag(GROUP_OP.TeeAdmissionPolicySetV2),
      borshStrings(input.allowedMrtd),
      borshStrings(input.allowedRtmr0),
      borshStrings(input.allowedRtmr1),
      borshStrings(input.allowedRtmr2),
      borshStrings(input.allowedRtmr3),
      borshStrings(input.allowedTcbStatuses),
      borshBool(input.acceptMock),
      teeMode(input.mode),
    ),
  };
}

/** A signed-release admission policy, as the node publishes it (the V2 form). */
export interface TeeReleaseAdmissionPolicyOpInput {
  allowedProfiles: string[];
  /**
   * The oldest release admitted. Give it in the node's normalised form
   * (`X.Y.Z`, no tag prefix): the node normalises what it is sent before it
   * builds the op, and the proof must be for the op it builds.
   */
  minReleaseVersion?: string;
  allowedTcbStatuses: string[];
  acceptMock: boolean;
  mode?: 'replica' | 'relay';
}

/** The signed-release admission policy `PUT …/settings/tee-admission-policy` publishes. */
export function teeReleaseAdmissionPolicyOp(input: TeeReleaseAdmissionPolicyOpInput): OwnerOp {
  const minRelease =
    input.minReleaseVersion === undefined
      ? tag(0)
      : concat(tag(1), borshString(input.minReleaseVersion));
  return {
    kind: 'teeReleaseAdmissionPolicy',
    plane: 'group',
    bytes: concat(
      tag(GROUP_OP.TeeReleaseAdmissionPolicySetV2),
      borshStrings(input.allowedProfiles),
      minRelease,
      borshStrings(input.allowedTcbStatuses),
      borshBool(input.acceptMock),
      teeMode(input.mode),
    ),
  };
}

/** core's `OwnerOpAuthorization::op_digest`: the op's bytes, hashed under the body domain. */
export async function ownerOpDigest(opBytes: Uint8Array): Promise<Uint8Array> {
  return domainHash(OWNER_OP_BODY_DOMAIN, [opBytes]);
}

/** What an owner-op proof binds, apart from the op and the key that signs it. */
export interface OwnerOpProofInput {
  /** The account root's signing secret, 64 hex. Never sent anywhere. */
  rootSecret: string;
  /** The namespace the op is published in (`getGroupInfo(...).namespaceId`), hex. */
  namespaceId: string;
  /**
   * The group the op acts on, hex. For `adminChanged` and the TEE policies,
   * the namespace root.
   */
  groupId: string;
  /** The op, from one of the encoders here. */
  op: OwnerOp;
  /** The group's current guarded-op counter (`getGroupInfo(groupId).ownerOpCounter`). */
  counter: number | bigint;
  /**
   * The root epoch that signs, 0 for a root that has never been handed off.
   * A later epoch needs `chain`.
   */
  keyEpoch?: number;
  /**
   * The account's root-key handoffs, epoch 0 upward, each the hex borsh of a
   * `RootKeyHandoff` (account 32, from_epoch u32, new root key 32, signature
   * 64). It must reach at least `keyEpoch`, and at least the epoch the group
   * has recorded for the account, or the node refuses the proof.
   */
  chain?: string[];
}

/** core's `OwnerOpTerms::signing_payload`. */
export async function ownerOpSigningPayload(input: {
  account: string;
  namespaceId: string;
  groupId: string;
  kind: OwnerOpKind;
  opDigest: Uint8Array;
  counter: number | bigint;
  keyEpoch: number;
}): Promise<Uint8Array> {
  return domainHash(OWNER_OP_SIGN_DOMAIN, [
    fromHex(input.account, 'account', 32),
    fromHex(input.namespaceId, 'namespaceId', 32),
    fromHex(input.groupId, 'groupId', 32),
    tag(kindByte(input.kind)),
    input.opDigest,
    u64le(input.counter),
    u32le(input.keyEpoch),
  ]);
}

function kindByte(kind: OwnerOpKind): number {
  const byte = OWNER_OP_KIND[kind];
  if (byte === undefined) {
    throw new Error(`unknown owner-op kind ${String(kind)}`);
  }
  return byte;
}

const HANDOFF_BYTES = 32 + 4 + 32 + 64;

/**
 * Sign a root proof for `op` and return it as core's `rootProof`: the hex
 * borsh of an `AccountProof<OwnerOpAuthorization>`.
 *
 * Layout: `AccountGenesis` (version u8 + root pk 32), the handoff chain (u32
 * count + 132 bytes each), then `OwnerOpAuthorization` (account 32, namespace
 * 32, group 32, kind u8, op digest 32, counter u64, key epoch u32, signature
 * 64).
 */
export async function signOwnerOpProof(input: OwnerOpProofInput): Promise<string> {
  const rootPublicKey = await derivePublicKey(input.rootSecret);
  const genesis = concat(tag(ACCOUNT_GENESIS_VERSION), rootPublicKey);
  const account = hex(await domainHash(ACCOUNT_ID_DOMAIN, [genesis]));
  const keyEpoch = input.keyEpoch ?? 0;
  const chain = (input.chain ?? []).map((handoff, index) => {
    const bytes = fromHexUnsized(handoff, `chain[${index}]`);
    if (bytes.length !== HANDOFF_BYTES) {
      throw new Error(
        `chain[${index}] must be a ${HANDOFF_BYTES}-byte RootKeyHandoff, got ${bytes.length}`,
      );
    }
    return bytes;
  });
  if (keyEpoch > chain.length) {
    throw new Error(
      `keyEpoch ${keyEpoch} needs ${keyEpoch} handoffs in chain, got ${chain.length}`,
    );
  }

  const opDigest = await ownerOpDigest(input.op.bytes);
  const payload = await ownerOpSigningPayload({
    account,
    namespaceId: input.namespaceId,
    groupId: input.groupId,
    kind: input.op.kind,
    opDigest,
    counter: input.counter,
    keyEpoch,
  });
  const key = await importSigningKey(input.rootSecret);
  const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', key, payload));

  return hex(
    concat(
      genesis,
      u32le(chain.length),
      ...chain,
      fromHex(account, 'account', 32),
      fromHex(input.namespaceId, 'namespaceId', 32),
      fromHex(input.groupId, 'groupId', 32),
      tag(kindByte(input.op.kind)),
      opDigest,
      u64le(input.counter),
      u32le(keyEpoch),
      signature,
    ),
  );
}

/**
 * The `RootGuarded` wrapper core publishes: the op and its proof, as one
 * `GroupOp` or `RootOp`. A client never sends this to a node (the endpoints
 * take the proof and build the wrapper); it is here so the whole encoding is
 * checkable against core's vector.
 */
export function rootGuardedOpBytes(op: OwnerOp, rootProof: string): Uint8Array {
  const wrapper = op.plane === 'group' ? GROUP_OP.RootGuarded : ROOT_OP.RootGuarded;
  return concat(tag(wrapper), op.bytes, fromHexUnsized(rootProof, 'rootProof'));
}
