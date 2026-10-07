/**
 * Mint a governance warrant: the author's consent for one relay to publish one
 * governance op in the author's name, once.
 *
 * The intent warrant lets an account with no node write to a context and the
 * creation warrant lets it create one. This covers the governance around them:
 * adding the other person to a DM, creating a channel's subgroup, changing a
 * role. The relay wraps the op in `OnBehalf` and publishes it; every peer applies
 * the inner op **as the author**, so the author's own authority decides
 * (`MANAGE_MEMBERS` to add a member, `CAN_CREATE_SUBGROUP` to create a subgroup,
 * and so on) and the relay needs only standing to act for members.
 *
 * **It commits to the op's bytes.** The warrant carries
 * `H(kind || op bytes)` over the op's delegable form (see `governance-op.ts`), so
 * what the op does, to whom and where is signed byte for byte and the relay
 * chooses nothing about it. `kind` is inside the commitment, so a group op can
 * never be presented as a root op whose bytes happen to coincide.
 *
 * **`scope` is where the op is published**: the group itself for a group op,
 * the namespace for a root op.
 *
 * Same primitives and the same two-widths trap as `warrant.ts`: counts inside
 * the encoding are borsh `u32`, counts in the signing preimage are `u64`.
 *
 * **The byte contract is pinned in core**, at
 * `crates/account/src/tests/governance_wire_fixture.rs`, and this module's test
 * asserts the same vectors. A drift would surface at a relay as a 400.
 */

import { concat, domainHash, fromHex, hex, u32le, u64le } from '../crypto/internal.js';
import { resolveSigner, type Signer } from '../signer/signer.js';
import type { GovernanceOp, GovernanceOpKind } from './governance-op.js';
import { checkedSignature, citedHeads } from './warrant.js';

const SIGN_DOMAIN = new TextEncoder().encode('calimero.governance-warrant.v1');
const OP_DOMAIN = new TextEncoder().encode('calimero.governance-warrant.op.v1');

/** core's `GovernanceOpKind` discriminants. */
const KIND_BYTE: Record<GovernanceOpKind, number> = { group: 0, root: 1 };

/** What a governance warrant authorises. */
export interface GovernanceWarrantInput {
  /**
   * Where the op is published, hex (32 bytes): the group for a group op, the
   * namespace for a root op. The relay refuses a warrant presented anywhere else.
   */
  scope: string;
  /** The op, from one of the encoders in `governance-op.ts`. Its kind is signed over. */
  op: GovernanceOp;
  /** The author's account, hex: whose authority the op is applied under. */
  authorAccount: string;
  /** The relay's account, hex: the subject its authorship grant is held by. */
  executor: string;
  /** The one signing key of `executor` that may publish it, hex: discovery's `executorKey`. */
  executorKey: string;
  /**
   * Monotonic per author **device**, spent in a per-group ledger. The same
   * nonce source `RelayClient` uses for every other warrant is correct.
   */
  nonce: number | bigint;
  /** Unix seconds after which the relay must refuse it. */
  notAfter: number | bigint;
  /** Account-log heads the author saw, each hex (32 bytes). At most 64. */
  accountHeads?: string[];
  /** Governance heads the author's view descended from, each hex (32 bytes). At most 64. */
  governanceFloor?: string[];
  /**
   * The author device's ed25519 signing secret, hex (32 bytes). Never sent.
   *
   * Mutually exclusive with {@link GovernanceWarrantInput.signer}: exactly one is required.
   * Prefer `signer` in a browser, since a secret held as a string is readable
   * by anything on the origin.
   */
  deviceSecret?: string;
  /**
   * The author device's signer, in place of {@link GovernanceWarrantInput.deviceSecret}: for a
   * key that cannot be exported to hex (a non-extractable WebCrypto key, a
   * passkey, a hardware or remote signer). Its `publicKey` becomes the
   * warrant's `author_device_key`, and it signs the 32-byte preimage as is.
   */
  signer?: Signer;
}

/** A governance warrant's fields, decoded from the wire encoding. */
export interface GovernanceWarrantFields {
  scope: string;
  kind: GovernanceOpKind;
  authorAccount: string;
  /** The author device key: the signer's public key. */
  deviceKey: string;
  executor: string;
  executorKey: string;
  opHash: string;
  accountHeads: string[];
  governanceFloor: string[];
  nonce: bigint;
  notAfter: bigint;
  signature: string;
}

/**
 * The commitment a governance warrant carries in place of the op:
 * `H(kind || op bytes)` under its own domain.
 */
export async function governanceOpHash(op: GovernanceOp): Promise<Uint8Array> {
  return domainHash(OP_DOMAIN, [new Uint8Array([kindByte(op.kind)]), op.bytes]);
}

/** The already-decoded fields the signature covers. Internal. */
export interface GovernancePreimageParts {
  scope: Uint8Array;
  kind: GovernanceOpKind;
  authorAccount: Uint8Array;
  deviceKey: Uint8Array;
  executor: Uint8Array;
  executorKey: Uint8Array;
  opHash: Uint8Array;
  accountHeads: Uint8Array[];
  governanceFloor: Uint8Array[];
  nonce: number | bigint;
  notAfter: number | bigint;
}

/**
 * The bytes the device key signs. Exported for the conformance test only, not
 * from the package root.
 */
export async function governanceWarrantPreimage(
  p: GovernancePreimageParts,
): Promise<Uint8Array> {
  // u64 counts HERE; u32 on the wire. The counts keep the two adjacent head
  // lists from being relabelled into each other.
  return domainHash(SIGN_DOMAIN, [
    p.scope,
    new Uint8Array([kindByte(p.kind)]),
    p.authorAccount,
    p.deviceKey,
    p.executor,
    p.executorKey,
    p.opHash,
    u64le(p.accountHeads.length),
    ...p.accountHeads,
    u64le(p.governanceFloor.length),
    ...p.governanceFloor,
    u64le(p.nonce),
    u64le(p.notAfter),
  ]);
}

/**
 * Sign a governance warrant and return it hex-encoded (borsh
 * `GovernanceWarrant`), ready for the relay alongside the op's own bytes.
 */
export async function signGovernanceWarrant(input: GovernanceWarrantInput): Promise<string> {
  const scope = fromHex(input.scope, 'scope', 32);
  const authorAccount = fromHex(input.authorAccount, 'authorAccount', 32);
  const executor = fromHex(input.executor, 'executor', 32);
  const executorKey = fromHex(input.executorKey, 'executorKey', 32);
  const accountHeads = citedHeads(input.accountHeads, 'accountHeads');
  const governanceFloor = citedHeads(input.governanceFloor, 'governanceFloor');
  const kind = kindByte(input.op.kind);

  const signer = await resolveSigner(input.deviceSecret, input.signer, 'deviceSecret');
  const deviceKey = fromHex(signer.publicKey, 'signer.publicKey', 32);
  const opHash = await governanceOpHash(input.op);

  const preimage = await governanceWarrantPreimage({
    scope,
    kind: input.op.kind,
    authorAccount,
    deviceKey,
    executor,
    executorKey,
    opHash,
    accountHeads,
    governanceFloor,
    nonce: input.nonce,
    notAfter: input.notAfter,
  });
  const signature = checkedSignature(await signer.sign(preimage));

  return hex(
    concat(
      scope,
      new Uint8Array([kind]),
      authorAccount,
      deviceKey,
      executor,
      executorKey,
      opHash,
      u32le(accountHeads.length),
      ...accountHeads,
      u32le(governanceFloor.length),
      ...governanceFloor,
      u64le(input.nonce),
      u64le(input.notAfter),
      signature,
    ),
  );
}

/**
 * Decode a hex governance warrant back into its fields.
 *
 * Refuses truncated or trailing bytes and an unknown kind. Does not verify the
 * signature.
 */
export function parseGovernanceWarrant(warrant: string): GovernanceWarrantFields {
  const clean = warrant.trim();
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error('governance warrant must be an even number of hex characters');
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  const view = new DataView(bytes.buffer);

  let o = 0;
  const take = (n: number, what: string): Uint8Array => {
    if (o + n > bytes.length) {
      throw new Error(`governance warrant ends inside ${what} (${bytes.length} bytes)`);
    }
    const out = bytes.subarray(o, o + n);
    o += n;
    return out;
  };
  const u32 = (what: string) => view.getUint32(take(4, what).byteOffset, true);
  const u64 = (what: string) => view.getBigUint64(take(8, what).byteOffset, true);
  const heads = (what: string): string[] => {
    const count = u32(what);
    if (count > 64) {
      throw new Error(`${what} cites ${count} heads, over the 64 a node accepts`);
    }
    return Array.from({ length: count }, () => hex(take(32, what)));
  };
  const kind = (): GovernanceOpKind => {
    const byte = take(1, 'kind')[0];
    if (byte === 0) return 'group';
    if (byte === 1) return 'root';
    throw new Error(`governance warrant has kind ${byte}, expected 0 (group) or 1 (root)`);
  };

  const fields: GovernanceWarrantFields = {
    scope: hex(take(32, 'scope')),
    kind: kind(),
    authorAccount: hex(take(32, 'authorAccount')),
    deviceKey: hex(take(32, 'deviceKey')),
    executor: hex(take(32, 'executor')),
    executorKey: hex(take(32, 'executorKey')),
    opHash: hex(take(32, 'opHash')),
    accountHeads: heads('accountHeads'),
    governanceFloor: heads('governanceFloor'),
    nonce: u64('nonce'),
    notAfter: u64('notAfter'),
    signature: hex(take(64, 'signature')),
  };
  if (o !== bytes.length) {
    throw new Error(
      `governance warrant is ${bytes.length} bytes but its fields account for ${o}`,
    );
  }
  return fields;
}

function kindByte(kind: GovernanceOpKind): number {
  const byte = KIND_BYTE[kind];
  if (byte === undefined) {
    throw new Error(`op kind must be 'group' or 'root', got ${String(kind)}`);
  }
  return byte;
}
