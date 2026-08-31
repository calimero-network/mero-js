/**
 * Sign a namespace governance op from the SDK — specifically the membership op a
 * keyholder needs to join without running a node.
 *
 * `admitJoin` carries an already-signed op to a node the inviter named as an
 * admitter. Producing that op is the piece a keyholder could not do before: the
 * op must be signed by the device key in the credential it carries, because every
 * peer checks `signer == credential.statement.sign_pk` when applying a join. An
 * admitter can relay it and can never author it.
 *
 * The encoding is borsh, hand-written to match core's structs. Correctness is not
 * asserted against bytes recorded here — a layout transcribed by eye is exactly
 * how a golden ends up confidently wrong. It is asserted by a node accepting the
 * op, which is what the e2e does.
 */
import type { SignedGroupOpenInvitation } from '../admin-api/admin-types.js';
import {
  concat,
  derivePublicKey,
  fromHex,
  hex,
  importSigningKey,
  u32le,
  u64le,
} from '../crypto/internal.js';

/** Core's `SIGNED_NAMESPACE_OP_SCHEMA_VERSION`. A node refuses any other value. */
export const SIGNED_NAMESPACE_OP_SCHEMA_VERSION = 7;

/** Domain prefixed to the signable bytes; core's `NAMESPACE_GOVERNANCE_SIGN_DOMAIN`. */
const NAMESPACE_SIGN_DOMAIN = new TextEncoder().encode('calimero.namespace.v1');

/** `NamespaceOp::Root` is the first variant. */
const NAMESPACE_OP_ROOT = 0;

/**
 * `RootOp` discriminants, in declaration order. Only the two join variants are
 * emitted here; the rest are listed so the numbering is checkable against core
 * rather than inferred from the two in use.
 */
const ROOT_OP = {
  GroupCreated: 0,
  GroupReparented: 1,
  GroupDeleted: 2,
  AdminChanged: 3,
  PolicyUpdated: 4,
  MemberJoined: 5,
  KeyDelivery: 6,
  MemberJoinedOpen: 7,
  MemberJoinedAt: 8,
  NamespaceCreated: 9,
  MemberJoinedViaTeeAttestation: 10,
} as const;

/** A required `[u8; 32]`, as JSON carries it: 32 byte values. */
function bytes32(value: readonly number[], label: string): Uint8Array {
  if (value.length !== 32) {
    throw new Error(`${label} must be 32 bytes, got ${value.length}`);
  }
  return new Uint8Array(value);
}

/**
 * Borsh `Option<[u8; 32]>` from the byte array JSON carries it as.
 *
 * `[u8; 32]` crosses JSON as 32 numbers, not as hex — the hex spelling belongs to
 * `AccountId`, which has its own representation. Encoding one of these from a hex
 * string would silently produce the wrong 32 bytes.
 */
function optionalBytes32(
  value: readonly number[] | null | undefined,
  label: string,
): Uint8Array {
  if (value === null || value === undefined) {
    return new Uint8Array([0]);
  }
  if (value.length !== 32) {
    throw new Error(`${label} must be 32 bytes, got ${value.length}`);
  }
  return concat(new Uint8Array([1]), new Uint8Array(value));
}

/** Borsh `String`: u32 length then UTF-8 bytes. */
function borshString(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  return concat(u32le(bytes.length), bytes);
}

function encodeAdmitterHint(
  hint: { readonly multiaddr: string } | { readonly url: string },
): Uint8Array {
  if ('multiaddr' in hint) {
    return concat(new Uint8Array([0]), borshString(hint.multiaddr));
  }
  return concat(new Uint8Array([1]), borshString(hint.url));
}

/**
 * Borsh-encode a `SignedGroupOpenInvitation`.
 *
 * Re-encoded rather than passed through, because it has to go inside the op that
 * gets signed. That makes this function version-locked to core: a field added to
 * the invitation and omitted here produces an op whose inner invitation no longer
 * matches the inviter's signature over it. That exact drift, in client-py, broke
 * 93 scenarios — the failure surfaces as `invalid invitation signature` and points
 * nowhere near the encoder.
 */
export function encodeSignedInvitation(signed: SignedGroupOpenInvitation): Uint8Array {
  const body = signed.invitation;
  const admitters = body.admitters ?? [];
  const hints = signed.admitter_hints ?? [];

  return concat(
    // GroupInvitationFromAdmin.
    //
    // `SignerId` and `ContextGroupId` cross JSON as 32 numbers; `AccountId`
    // crosses as hex. Same width, different spelling, and reading either the
    // wrong way yields 32 bytes that encode cleanly and verify as nothing.
    bytes32(body.inviter_identity, 'inviter_identity'),
    bytes32(body.group_id, 'group_id'),
    u64le(body.expiration_timestamp),
    bytes32(body.secret_salt, 'secret_salt'),
    new Uint8Array([body.invited_role]),
    u32le(admitters.length),
    ...admitters.map((a, i) => fromHex(a, `admitters[${i}]`, 32)),
    // ...then the enclosing SignedGroupOpenInvitation, in declaration order.
    // `inviter_account` sits between the signature and the hints; putting it
    // anywhere else still encodes 32 bytes and still verifies as nothing.
    borshString(signed.inviter_signature),
    signed.inviter_account
      ? concat(new Uint8Array([1]), fromHex(signed.inviter_account, 'inviter_account', 32))
      : new Uint8Array([0]),
    u32le(hints.length),
    ...hints.map(encodeAdmitterHint),
    optionalBytes32(signed.application_id, 'application_id'),
    optionalBytes32(signed.bytecode_id, 'bytecode_id'),
  );
}

export interface SignMemberJoinInput {
  /** The namespace being joined, 64 hex. */
  readonly namespaceId: string;
  /** The account joining, 64 hex — the subject of the credential. */
  readonly member: string;
  /** The invitation, as the admin API returned it. */
  readonly invitation: SignedGroupOpenInvitation;
  /**
   * The joiner's `AccountProof<DeviceCert>`, hex — from `signDeviceCert`.
   *
   * Its `sign_pk` must be the public key of `deviceSecret`; a peer checks that
   * when applying the join and refuses otherwise.
   */
  readonly credential: string;
  /** The device signing secret, 64 hex. Must match the credential's `sign_pk`. */
  readonly deviceSecret: string;
  /**
   * Heads this op is written against. Empty means "signed against an empty head"
   * — which is NOT the same as genesis, and a node with a non-empty head will
   * reject it as stale rather than treat it as a first op.
   */
  readonly parentOpHashes?: readonly string[];
  /** Anti-replay nonce; a node keeps a window per signer. */
  readonly nonce: number | bigint;
  /**
   * Use `MemberJoinedAt` instead of `MemberJoined`. The `At` form pins the
   * membership to a position in the log.
   */
  readonly at?: boolean;
}

/**
 * Sign a `MemberJoined` (or `MemberJoinedAt`) namespace op and return it
 * borsh-encoded and hex — the `signedOp` that `admitJoin` takes.
 */
export async function signMemberJoinOp(input: SignMemberJoinInput): Promise<string> {
  const parents = input.parentOpHashes ?? [];
  const credential = fromHex(input.credential, 'credential', input.credential.length / 2);

  const rootOp = concat(
    new Uint8Array([input.at ? ROOT_OP.MemberJoinedAt : ROOT_OP.MemberJoined]),
    fromHex(input.member, 'member', 32),
    encodeSignedInvitation(input.invitation),
    credential,
  );

  const op = concat(new Uint8Array([NAMESPACE_OP_ROOT]), rootOp);

  const key = await importSigningKey(input.deviceSecret);
  const signer = await derivePublicKey(input.deviceSecret);

  const signable = concat(
    new Uint8Array([SIGNED_NAMESPACE_OP_SCHEMA_VERSION]),
    fromHex(input.namespaceId, 'namespaceId', 32),
    u32le(parents.length),
    ...parents.map((p, i) => fromHex(p, `parentOpHashes[${i}]`, 32)),
    signer,
    u64le(input.nonce),
    op,
  );

  const signature = new Uint8Array(
    await crypto.subtle.sign('Ed25519', key, concat(NAMESPACE_SIGN_DOMAIN, signable)),
  );

  // The signed struct repeats the signable fields, then the signature. The domain
  // is a signing prefix only and is never part of the encoded op.
  return hex(concat(signable, signature));
}
