/**
 * Mint a creation warrant: the author's consent for one relay to create one
 * context in one group, once.
 *
 * The intent warrant in `warrant.ts` lets an account with no node *write* to a
 * context; this lets it *create* one. The relay executes the warrant and
 * publishes `GroupOp::ContextRegisteredOnBehalf` carrying it, and every peer
 * checks the **author's** `CAN_CREATE_CONTEXT` (or admin) — the relay needs no
 * create rights of its own, only standing to act for members. The app's `init`
 * runs as the author's account.
 *
 * Same primitives and the same two-widths trap as `warrant.ts`: counts **inside
 * the encoding** are borsh `u32`, counts the **signing preimage** hashes are
 * `u64`. The two `Option<String>` labels add a third shape: on the wire an
 * option is a one-byte tag followed (when present) by a `u32`-prefixed string,
 * while the preimage hashes the tag and the bytes as two separate parts, the
 * bytes empty when absent. That is what keeps `None` and `Some("")` distinct in
 * both.
 *
 * **The byte contract is pinned in core**, at
 * `crates/account/src/tests/creation_wire_fixture.rs`, and this module's test
 * asserts the same vectors. A drift would surface at a relay as a 403.
 */

import { concat, domainHash, fromHex, hex, u32le, u64le } from '../crypto/internal.js';
import { resolveSigner, type Signer } from '../signer/signer.js';
import { checkedSignature, citedHeads } from './warrant.js';

const SIGN_DOMAIN = new TextEncoder().encode('calimero.context-creation-warrant.v1');
const INIT_DOMAIN = new TextEncoder().encode('calimero.context-creation.init.v1');

/** core's cap on `service_name` and `name`, in UTF-8 bytes. */
const MAX_LABEL_BYTES = 256;

/** What a creation warrant authorises. */
export interface CreationWarrantInput {
  /** The group the context is created in, hex (32 bytes). */
  group: string;
  /**
   * The seed the node derives the new context's id from, hex (32 bytes).
   *
   * Optional: when absent, 32 random bytes are drawn and returned alongside the
   * warrant. Pass one only to make the id predictable — reusing a seed asks for
   * a context that already exists.
   */
  seed?: string;
  /** The author's account, hex — whose consent this is, and who runs `init`. */
  authorAccount: string;
  /** The relay authorised to act, hex. An account, not a key. */
  executor: string;
  /** The application the context is created with, hex (32 bytes). */
  applicationId: string;
  /**
   * Which service of a multi-service bundle, or absent for the default.
   *
   * Absent and `""` are different values and sign differently. At most 256
   * UTF-8 bytes.
   */
  serviceName?: string;
  /** A display name for the context, or absent. At most 256 UTF-8 bytes. */
  name?: string;
  /**
   * The JSON the app's `init()` will receive.
   *
   * Committed to rather than carried: the relay is sent the same value
   * separately and the node checks it hashes to what was signed, so pass the
   * exact value you will send. See {@link creationInitHash}.
   */
  initArgs: unknown;
  /**
   * Monotonic per author **device**. Spent in the *new* context's warrant
   * ledger, so the same per-device nonce source `RelayClient` uses is correct.
   */
  nonce: number | bigint;
  /** Unix seconds after which the relay must refuse it. */
  notAfter: number | bigint;
  /** Account-log heads the author saw, each hex (32 bytes). At most 64. */
  accountHeads?: string[];
  /**
   * Governance heads the author's view descended from, each hex (32 bytes). At
   * most 64. The same caveat as the intent warrant's floor applies: one the
   * relay supplied is one the relay chose.
   */
  governanceFloor?: string[];
  /**
   * The author device's ed25519 signing secret, hex (32 bytes). Never sent.
   *
   * Mutually exclusive with {@link CreationWarrantInput.signer}: exactly one is required.
   * Prefer `signer` in a browser, since a secret held as a string is readable
   * by anything on the origin.
   */
  deviceSecret?: string;
  /**
   * The author device's signer, in place of {@link CreationWarrantInput.deviceSecret}: for a
   * key that cannot be exported to hex (a non-extractable WebCrypto key, a
   * passkey, a hardware or remote signer). Its `publicKey` becomes the
   * warrant's `author_device_key`, and it signs the 32-byte preimage as is.
   */
  signer?: Signer;
}

/** A signed creation warrant and the seed it commits to. */
export interface SignedCreationWarrant {
  /** Hex borsh `ContextCreationWarrant`, ready for the relay. */
  warrant: string;
  /** The seed, hex — the one passed in, or the one drawn when none was. */
  seed: string;
}

/** A creation warrant's fields, decoded from the wire encoding. */
export interface CreationWarrantFields {
  group: string;
  seed: string;
  authorAccount: string;
  /** The author device key: the signer's public key. */
  deviceKey: string;
  executor: string;
  applicationId: string;
  /** `null` when absent — distinct from `""`. */
  serviceName: string | null;
  /** `null` when absent — distinct from `""`. */
  name: string | null;
  initHash: string;
  accountHeads: string[];
  governanceFloor: string[];
  nonce: bigint;
  notAfter: bigint;
  signature: string;
}

/**
 * The commitment a creation warrant carries in place of the init arguments.
 *
 * Hashes `JSON.stringify(initArgs)`, the same bytes `RelayClient.createContext`
 * sends, under its own domain.
 */
export async function creationInitHash(initArgs: unknown): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(JSON.stringify(initArgs));
  return domainHash(INIT_DOMAIN, [bytes]);
}

/** The already-decoded fields the signature covers. Internal. */
export interface CreationPreimageParts {
  group: Uint8Array;
  seed: Uint8Array;
  authorAccount: Uint8Array;
  deviceKey: Uint8Array;
  executor: Uint8Array;
  applicationId: Uint8Array;
  serviceName: Uint8Array | null;
  name: Uint8Array | null;
  initHash: Uint8Array;
  accountHeads: Uint8Array[];
  governanceFloor: Uint8Array[];
  nonce: number | bigint;
  notAfter: number | bigint;
}

/**
 * The bytes the device key signs. Exported for the conformance test only — not
 * from the package root.
 */
export async function creationWarrantPreimage(
  p: CreationPreimageParts,
): Promise<Uint8Array> {
  // An option is two parts here — its tag, then its bytes (empty when absent) —
  // so `None` and `Some("")` hash differently. u64 counts HERE; u32 on the wire.
  return domainHash(SIGN_DOMAIN, [
    p.group,
    p.seed,
    p.authorAccount,
    p.deviceKey,
    p.executor,
    p.applicationId,
    new Uint8Array([p.serviceName === null ? 0 : 1]),
    p.serviceName ?? new Uint8Array(0),
    new Uint8Array([p.name === null ? 0 : 1]),
    p.name ?? new Uint8Array(0),
    p.initHash,
    u64le(p.accountHeads.length),
    ...p.accountHeads,
    u64le(p.governanceFloor.length),
    ...p.governanceFloor,
    u64le(p.nonce),
    u64le(p.notAfter),
  ]);
}

/**
 * Sign a creation warrant and return it hex-encoded, with its seed.
 *
 * Returns the encoding rather than an object for the reason `signWarrant`
 * does: the signature covers exactly these bytes.
 */
export async function signCreationWarrant(
  input: CreationWarrantInput,
): Promise<SignedCreationWarrant> {
  const group = fromHex(input.group, 'group', 32);
  const seed =
    input.seed === undefined
      ? crypto.getRandomValues(new Uint8Array(32))
      : fromHex(input.seed, 'seed', 32);
  const authorAccount = fromHex(input.authorAccount, 'authorAccount', 32);
  const executor = fromHex(input.executor, 'executor', 32);
  const applicationId = fromHex(input.applicationId, 'applicationId', 32);
  const serviceName = label(input.serviceName, 'serviceName');
  const name = label(input.name, 'name');
  const accountHeads = citedHeads(input.accountHeads, 'accountHeads');
  const governanceFloor = citedHeads(input.governanceFloor, 'governanceFloor');

  const signer = await resolveSigner(input.deviceSecret, input.signer, 'deviceSecret');
  const deviceKey = fromHex(signer.publicKey, 'signer.publicKey', 32);
  const initHash = await creationInitHash(input.initArgs);

  const preimage = await creationWarrantPreimage({
    group,
    seed,
    authorAccount,
    deviceKey,
    executor,
    applicationId,
    serviceName,
    name,
    initHash,
    accountHeads,
    governanceFloor,
    nonce: input.nonce,
    notAfter: input.notAfter,
  });
  const signature = checkedSignature(await signer.sign(preimage));

  const warrant = hex(
    concat(
      group,
      seed,
      authorAccount,
      deviceKey,
      executor,
      applicationId,
      borshOption(serviceName),
      borshOption(name),
      initHash,
      u32le(accountHeads.length),
      ...accountHeads,
      u32le(governanceFloor.length),
      ...governanceFloor,
      u64le(input.nonce),
      u64le(input.notAfter),
      signature,
    ),
  );
  return { warrant, seed: hex(seed) };
}

/**
 * Decode a hex creation warrant back into its fields.
 *
 * Refuses truncated or trailing bytes rather than reading a neighbouring field.
 * Does not verify the signature.
 */
export function parseCreationWarrant(warrant: string): CreationWarrantFields {
  const clean = warrant.trim();
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error('creation warrant must be an even number of hex characters');
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  const view = new DataView(bytes.buffer);

  let o = 0;
  const take = (n: number, what: string): Uint8Array => {
    if (o + n > bytes.length) {
      throw new Error(`creation warrant ends inside ${what} (${bytes.length} bytes)`);
    }
    const out = bytes.subarray(o, o + n);
    o += n;
    return out;
  };
  const u32 = (what: string) => view.getUint32(take(4, what).byteOffset, true);
  const u64 = (what: string) => view.getBigUint64(take(8, what).byteOffset, true);
  const option = (what: string): string | null => {
    const tag = take(1, what)[0];
    if (tag === 0) return null;
    if (tag !== 1) throw new Error(`${what} has option tag ${tag}, expected 0 or 1`);
    const len = u32(what);
    if (len > MAX_LABEL_BYTES) {
      throw new Error(`${what} is ${len} bytes, over the ${MAX_LABEL_BYTES} a node accepts`);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(take(len, what));
  };
  const heads = (what: string): string[] => {
    const count = u32(what);
    if (count > 64) {
      throw new Error(`${what} cites ${count} heads, over the 64 a node accepts`);
    }
    return Array.from({ length: count }, () => hex(take(32, what)));
  };

  const fields: CreationWarrantFields = {
    group: hex(take(32, 'group')),
    seed: hex(take(32, 'seed')),
    authorAccount: hex(take(32, 'authorAccount')),
    deviceKey: hex(take(32, 'deviceKey')),
    executor: hex(take(32, 'executor')),
    applicationId: hex(take(32, 'applicationId')),
    serviceName: option('serviceName'),
    name: option('name'),
    initHash: hex(take(32, 'initHash')),
    accountHeads: heads('accountHeads'),
    governanceFloor: heads('governanceFloor'),
    nonce: u64('nonce'),
    notAfter: u64('notAfter'),
    signature: hex(take(64, 'signature')),
  };
  if (o !== bytes.length) {
    throw new Error(
      `creation warrant is ${bytes.length} bytes but its fields account for ${o}`,
    );
  }
  return fields;
}

/** UTF-8 encode an optional label, refusing one longer than a node accepts. */
function label(value: string | undefined, what: string): Uint8Array | null {
  if (value === undefined) return null;
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > MAX_LABEL_BYTES) {
    throw new Error(
      `${what} is ${bytes.length} UTF-8 bytes, over the ${MAX_LABEL_BYTES} a node accepts`,
    );
  }
  return bytes;
}

/** Borsh `Option<String>`: `0x00`, or `0x01` then a u32 length and the bytes. */
function borshOption(bytes: Uint8Array | null): Uint8Array {
  if (bytes === null) return new Uint8Array([0]);
  return concat(new Uint8Array([1]), u32le(bytes.length), bytes);
}
