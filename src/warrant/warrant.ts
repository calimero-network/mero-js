/**
 * Mint a warrant: the author's consent for one relay to run one intent, once.
 *
 * This exists because the case delegated authorship is *for* is an account that
 * holds no node — a browser tab, a Node service, a bot. Every one of those is a
 * JS runtime, and until now the only thing that could mint a warrant was `merod`,
 * so "a member with no node" in practice meant "a member with a node it is not
 * allowed to use for anything else".
 *
 * **No dependencies, and that is not incidental.** The primitives are all built
 * in: `crypto.subtle.digest('SHA-256')` for the hash, `crypto.subtle` Ed25519
 * for the signature, and `DataView` for the integers.
 *
 * Warrant v2 (core#3933) gave up the fixed-width encoding that used to make this
 * pure concatenation: `method` travels in the clear as a string and each cited
 * head list is a vector, so three borsh `u32` counts now sit inside the bytes.
 * Two widths to keep straight, and they are not the same: the counts **inside
 * the encoding** are `u32`, while the counts the **signing preimage** hashes are
 * `u64`. Same numbers, different serialization — reusing one for the other
 * produces a warrant that is well-formed and verifies nowhere.
 *
 * **The byte contract is pinned in core**, at
 * `crates/account/src/tests/warrant_wire_fixture.rs`. The domain strings below
 * are `pub(crate)` there, so nothing in that repository forces anyone to notice
 * this file depends on them — which is exactly why the fixture lives on that side
 * and this module's test asserts the same vectors. A drift would otherwise leave
 * this producing well-formed warrants whose signatures verify nowhere, surfacing
 * at a relay as a 403: an authorization refusal, nowhere near the cause.
 */

import {
  concat,
  domainHash,
  fromHex,
  hex,
  u32le,
  u64le,
} from '../crypto/internal.js';
import { resolveSigner, type Signer } from '../signer/signer.js';

const SIGN_DOMAIN = new TextEncoder().encode('calimero.warrant.v2');
const INTENT_DOMAIN = new TextEncoder().encode('calimero.warrant.intent.v1');

/**
 * core's `MAX_WARRANT_CITED_HEADS`. A node refuses more than this before doing
 * any Ed25519 work, so minting past it produces a warrant nothing will spend.
 */
const MAX_CITED_HEADS = 64;

/** 32 zero bytes — the `appVersion` default. See {@link WarrantInput.appVersion}. */
const UNPINNED_APP = '00'.repeat(32);

/** Ed25519 PKCS#8 prefix, so a raw 32-byte seed can be imported by WebCrypto. */
/** What a warrant authorises. */
export interface WarrantInput {
  /**
   * The context, hex — the same string every other method here takes.
   *
   * Hex like everything else on this interface. It was base58 while the node
   * spelled `ContextId` and `PublicKey` that way and `AccountId` and `DeviceId`
   * in hex; that split is gone, so this module no longer needs a rule per field
   * and no longer needs a base58 decoder to enforce one.
   */
  context: string;
  /** The author's account, hex — whose consent this is. */
  authorAccount: string;
  /** The relay authorised to act, hex. An account, not a key. */
  executor: string;
  /**
   * The application build this warrant is signed against, hex (32 bytes).
   *
   * Pins the code rather than a version string, so a relay cannot wait for an
   * upgrade that widens what `method` does and then spend a warrant signed
   * against the narrower one. Read it from the context
   * (`GET /admin-api/contexts/{id}` → `applicationId`); a value guessed here
   * pins the wrong build, which is worse than not pinning.
   *
   * Defaults to 32 zero bytes, matching `merod account sign-warrant`'s
   * `--app-version` default. Nothing verifies the field yet — core#3933 landed
   * the field set ahead of its enforcement so a signer is written once against
   * the final bytes — but a warrant minted with the default will be refused once
   * pinning lands, so pass the real value for anything meant to outlive it.
   */
  appVersion?: string;
  /**
   * The method the relay may run.
   *
   * Carried in the clear as of v2, so a peer can select a per-method write-set
   * without reversing a hash against the app's ABI. The *arguments* are still
   * committed to rather than carried — see {@link intentHash}.
   */
  method: string;
  /** Its arguments, as the JSON the guest will receive. */
  argsJson: unknown;
  /**
   * Monotonic per author **device**.
   *
   * Per device rather than per account because two devices of one account are
   * independent replicas: they cannot coordinate on a counter, so an
   * account-scoped sequence would have them refusing each other's warrants.
   */
  nonce: number | bigint;
  /**
   * Account-log heads this author saw when signing, each hex (32 bytes).
   *
   * Empty by default, and empty is the honest answer for a client that tracks
   * no log — a fabricated view is worse than none. At most
   * {@link MAX_CITED_HEADS}.
   */
  accountHeads?: string[];
  /**
   * Governance heads this author's view descended from, each hex (32 bytes).
   *
   * **Where these come from decides whether they mean anything.** A floor the
   * relay supplied is a floor the relay chose: a relay that withholds a
   * governance op can hand you a stale view and collect a warrant citing it.
   * Take the value from the account's own devices or a co-signing peer outside
   * the relay's operator. As it stands this detects an honest relay's staleness
   * and does not constrain a dishonest one.
   */
  governanceFloor?: string[];
  /** Unix seconds after which the relay must refuse it. */
  notAfter: number | bigint;
  /**
   * The author device's ed25519 signing secret, hex (32 bytes).
   *
   * Never sent anywhere. It signs locally and only the signature travels, which
   * is the whole reason a warrant can be minted by something holding no node.
   *
   * Mutually exclusive with {@link WarrantInput.signer}. Prefer `signer` in a
   * browser: a secret that exists as a string is readable by anything on the
   * origin, and a key held as a non-extractable `CryptoKey` is not.
   */
  deviceSecret?: string;
  /**
   * The author device's signer — use instead of {@link WarrantInput.deviceSecret}
   * when the key cannot be exported to hex.
   *
   * `signerFromCryptoKey(privateKey, publicKey)` wraps a WebCrypto key generated
   * with `extractable: false`, which can sign and can never be read back.
   */
  signer?: Signer;
}







/**
 * The commitment a warrant carries in place of the intent itself.
 *
 * Its own domain, distinct from the signing one, so a value computed for one
 * purpose cannot be presented for the other.
 */
export async function intentHash(
  method: string,
  argsJson: unknown,
): Promise<Uint8Array> {
  const args = new TextEncoder().encode(JSON.stringify(argsJson));
  return domainHash(INTENT_DOMAIN, [new TextEncoder().encode(method), args]);
}


/**
 * Sign a warrant and return it hex-encoded, ready for `performIntent`.
 *
 * Returns the encoding rather than an object because the signature covers
 * exactly these bytes: a caller that rebuilt the fields from JSON would have a
 * second spelling able to disagree with what was signed.
 */
export async function signWarrant(input: WarrantInput): Promise<string> {
  const context = fromHex(input.context, 'context', 32);
  const authorAccount = fromHex(input.authorAccount, 'authorAccount', 32);
  const executor = fromHex(input.executor, 'executor', 32);
  const appVersion = fromHex(
    input.appVersion ?? UNPINNED_APP,
    'appVersion',
    32,
  );
  const accountHeads = citedHeads(input.accountHeads, 'accountHeads');
  const governanceFloor = citedHeads(input.governanceFloor, 'governanceFloor');

  const signer = await resolveSigner(
    input.deviceSecret,
    input.signer,
    'deviceSecret',
  );
  const publicKey = fromHex(signer.publicKey, 'signer.publicKey', 32);

  const method = new TextEncoder().encode(input.method);
  const commitment = await intentHash(input.method, input.argsJson);
  const nonce = u64le(input.nonce);
  const notAfter = u64le(input.notAfter);

  // Each head list is preceded by its own count. `domainHash` length-prefixes
  // every part it is given, so the heads are individually unambiguous — but the
  // two lists are adjacent, so without the counts `accountHeads = [a, b],
  // governanceFloor = []` hashes identically to `[a], [b]`, and a relay could
  // relabel which plane a head was cited from. u64 HERE; u32 in the encoding.
  const preimage = await domainHash(SIGN_DOMAIN, [
    context,
    authorAccount,
    publicKey,
    executor,
    appVersion,
    method,
    commitment,
    u64le(accountHeads.length),
    ...accountHeads,
    u64le(governanceFloor.length),
    ...governanceFloor,
    nonce,
    notAfter,
  ]);

  const signature = await signer.sign(preimage);

  // Borsh: a `String` is a u32 length then its UTF-8 bytes; a `Vec<[u8; 32]>` is
  // a u32 count then the elements. u32 HERE; u64 in the preimage above.
  return hex(
    concat(
      context,
      authorAccount,
      publicKey,
      executor,
      appVersion,
      u32le(method.length),
      method,
      commitment,
      u32le(accountHeads.length),
      ...accountHeads,
      u32le(governanceFloor.length),
      ...governanceFloor,
      nonce,
      notAfter,
      signature,
    ),
  );
}

/** Decode a cited-head list, refusing one longer than a node will accept. */
function citedHeads(heads: string[] | undefined, label: string): Uint8Array[] {
  const list = heads ?? [];
  if (list.length > MAX_CITED_HEADS) {
    throw new Error(
      `${label} cites ${list.length} heads, over the ${MAX_CITED_HEADS} a node accepts`,
    );
  }
  return list.map((head, i) => fromHex(head, `${label}[${i}]`, 32));
}

/** A warrant's fields, as hex, decoded from the wire encoding. */
export interface WarrantFields {
  context: string;
  authorAccount: string;
  /** The author device key `signWarrant` derived from the secret. */
  deviceKey: string;
  executor: string;
  appVersion: string;
  method: string;
  intentHash: string;
  accountHeads: string[];
  governanceFloor: string[];
  /** u64 little-endian, as it sits on the wire. */
  nonce: string;
  /** u64 little-endian, as it sits on the wire. */
  notAfter: string;
  signature: string;
}

/**
 * Decode a hex warrant back into its fields.
 *
 * Exists because v2's offsets are no longer constants: `method` is a string and
 * the head lists are vectors, so everything after `appVersion` moves with the
 * method's length. Anything reading a warrant by fixed offset — a test, a client
 * inspecting one it was handed — silently reads the wrong field instead of
 * failing, which is how the three call sites that did so passed while comparing
 * the method's length prefix to a nonce.
 *
 * One copy of the layout, beside the encoder that produces it, so the two cannot
 * drift. Internal: not exported from the package root, because a client that
 * needs a warrant's fields has the input it signed.
 */
export function parseWarrant(warrant: string): WarrantFields {
  const at = (start: number, bytes: number) =>
    warrant.slice(start * 2, (start + bytes) * 2);
  // A borsh u32 is little-endian, so the hex pairs read back to front.
  const u32At = (start: number) =>
    Number.parseInt((at(start, 4).match(/../g) ?? []).reverse().join(''), 16);

  let o = 0;
  const take = (bytes: number) => {
    const field = at(o, bytes);
    o += bytes;
    return field;
  };

  const context = take(32);
  const authorAccount = take(32);
  const deviceKey = take(32);
  const executor = take(32);
  const appVersion = take(32);
  const methodLen = u32At(o);
  o += 4;
  const method = take(methodLen);
  const intentHashField = take(32);
  const accountCount = u32At(o);
  o += 4;
  const accountHeads = Array.from({ length: accountCount }, () => take(32));
  const governanceCount = u32At(o);
  o += 4;
  const governanceFloor = Array.from({ length: governanceCount }, () =>
    take(32),
  );
  const nonce = take(8);
  const notAfter = take(8);
  const signature = take(64);

  if (o * 2 !== warrant.length) {
    throw new Error(
      `warrant is ${warrant.length / 2} bytes but its fields account for ${o}`,
    );
  }

  return {
    context,
    authorAccount,
    deviceKey,
    executor,
    appVersion,
    method,
    intentHash: intentHashField,
    accountHeads,
    governanceFloor,
    nonce,
    notAfter,
    signature,
  };
}
