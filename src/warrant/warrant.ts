/**
 * Mint a warrant: the author's consent for one relay to run one intent, once.
 *
 * This exists because the case delegated authorship is *for* is an account that
 * holds no node — a browser tab, a Node service, a bot. Every one of those is a
 * JS runtime, and until now the only thing that could mint a warrant was `merod`,
 * so "a member with no node" in practice meant "a member with a node it is not
 * allowed to use for anything else".
 *
 * **No dependencies, and that is not incidental.** The three primitives are all
 * built in: `crypto.subtle.digest('SHA-256')` for the hash, `crypto.subtle`
 * Ed25519 for the signature, and `DataView.setBigUint64` for the two u64s. The
 * warrant's every field is fixed-width, so its encoding is concatenation — there
 * is no borsh here because none is needed.
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
  derivePublicKey,
  domainHash,
  fromHex,
  hex,
  importSigningKey,
  u64le,
} from '../crypto/internal.js';

const SIGN_DOMAIN = new TextEncoder().encode('calimero.warrant.v1');
const INTENT_DOMAIN = new TextEncoder().encode('calimero.warrant.intent.v1');

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
  /** The method the relay may run. */
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
  /** Unix seconds after which the relay must refuse it. */
  notAfter: number | bigint;
  /**
   * The author device's ed25519 signing secret, hex (32 bytes).
   *
   * Never sent anywhere. It signs locally and only the signature travels, which
   * is the whole reason a warrant can be minted by something holding no node.
   */
  deviceSecret: string;
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
 * The 240 bytes are the canonical form: the signature covers exactly them, which
 * is why this returns the encoding rather than an object. A caller that rebuilt
 * the fields from JSON would have a second spelling able to disagree with what
 * was signed.
 */
export async function signWarrant(input: WarrantInput): Promise<string> {
  const context = fromHex(input.context, 'context', 32);
  const authorAccount = fromHex(input.authorAccount, 'authorAccount', 32);
  const executor = fromHex(input.executor, 'executor', 32);

  const key = await importSigningKey(input.deviceSecret);
  const publicKey = await derivePublicKey(input.deviceSecret);

  const commitment = await intentHash(input.method, input.argsJson);
  const nonce = u64le(input.nonce);
  const notAfter = u64le(input.notAfter);

  const preimage = await domainHash(SIGN_DOMAIN, [
    context,
    authorAccount,
    publicKey,
    executor,
    commitment,
    nonce,
    notAfter,
  ]);

  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'Ed25519' }, key, preimage),
  );

  return hex(
    concat(
      context,
      authorAccount,
      publicKey,
      executor,
      commitment,
      nonce,
      notAfter,
      signature,
    ),
  );
}

