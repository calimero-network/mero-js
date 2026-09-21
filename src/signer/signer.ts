/**
 * Who signs, separated from what is signed.
 *
 * Every signing entry point in this package used to take 32 hex bytes. That is
 * fine for a CLI or a server holding a key file, and it is the one thing a
 * browser must not do: a secret that exists as a string can be read by anything
 * running on the origin, and a stolen account key is the account — permanently,
 * because unlike a device key there is nothing above it to revoke it with.
 *
 * WebCrypto can hold an Ed25519 key that **signs but cannot be exported**
 * (`generateKey(..., extractable: false, ...)`). Such a key has no hex
 * representation to pass, so it could not be used with this package at all —
 * which pushed consumers into reimplementing core's wire formats around their
 * own key. That is the failure `crates/account/src/tests/sdk_credential_fixture.rs`
 * exists to document: a second implementation of a byte contract agreed with
 * itself for a full release while core rejected every credential it produced.
 *
 * So the interface is the key's *capability*, not its material:
 *
 * ```ts
 * const signer = await signerFromSecret(deviceSecret);           // as before
 * const signer = await signerFromCryptoKey(privateKey, pubKey);  // unexportable
 * await signWarrant({ ...terms, signer });
 * ```
 *
 * `deviceSecret` and `rootSecret` keep working everywhere they did. They are
 * now one way of producing a `Signer` rather than the only way, and callers
 * that pass a secret get a signer built for them.
 */

import { concat, fromHex, hex } from '../crypto/internal.js';

/** Ed25519 PKCS#8 prefix, so a raw 32-byte seed can be imported by WebCrypto. */
const PKCS8_ED25519_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04,
  0x22, 0x04, 0x20,
]);

/**
 * Something that can produce Ed25519 signatures and name the key they verify
 * against.
 *
 * Deliberately the smallest surface that works: a signature and the public key
 * it belongs to. Anything larger would start describing *how* the key is held,
 * which is the detail this exists to hide — a hex seed, a non-extractable
 * `CryptoKey`, a hardware token behind an async prompt, and a remote signing
 * service all satisfy it.
 */
export interface Signer {
  /**
   * The public half, 64 hex characters.
   *
   * Carried rather than derived on demand because a non-extractable private key
   * cannot produce it: the public half has to be captured when the key is
   * generated. A signer that could not name its key would force every caller to
   * pass the public key alongside it, and the two could then disagree.
   */
  readonly publicKey: string;

  /**
   * Sign `payload` — the exact bytes, with no hashing or framing added.
   *
   * Every caller in this package passes a 32-byte domain-separated digest it
   * has already computed, and an implementation that hashed again would produce
   * signatures that verify nowhere.
   */
  sign(payload: Uint8Array): Promise<Uint8Array>;
}

/** Turn WebCrypto's bare `NotSupportedError` into something actionable. */
function unsupported(cause: unknown): Error {
  // The original is folded into the message rather than passed as `cause`:
  // this package targets ES2020, where `Error` has no `cause` option.
  const detail = cause instanceof Error ? `: ${cause.message}` : '';
  return new Error(
    'this runtime has no WebCrypto Ed25519, so nothing can be signed here. ' +
      'Node 18.4+, Safari 17+, Firefox 129+ and Chrome 137+ have it' +
      detail,
  );
}

/**
 * A signer over a raw 32-byte Ed25519 seed, hex.
 *
 * The public half is derived from the seed rather than accepted alongside it,
 * for the reason core does the same: a caller able to name a key it does not
 * hold could produce a statement it cannot sign, and the field would stop
 * meaning "who authorised this".
 *
 * @param secret the seed, 64 hex characters
 * @param label what to call it in an error — `deviceSecret`, `rootSecret`
 */
export async function signerFromSecret(
  secret: string,
  label = 'secret',
): Promise<Signer> {
  const seed = fromHex(secret, label, 32);
  const pkcs8 = concat(PKCS8_ED25519_PREFIX, seed);

  let privateKey: CryptoKey;
  let publicKey: string;
  try {
    // Imported twice on purpose: `extractable: true` is needed to read the
    // public half out of a JWK, and the signing key is then re-imported
    // unexportable so a `Signer` built from a secret is no more powerful than
    // one built from a `CryptoKey`.
    const exportable = await crypto.subtle.importKey(
      'pkcs8',
      pkcs8,
      { name: 'Ed25519' },
      true,
      ['sign'],
    );
    const jwk = (await crypto.subtle.exportKey('jwk', exportable)) as JsonWebKey & {
      x: string;
    };
    publicKey = hex(
      Uint8Array.from(atob(jwk.x.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
        c.charCodeAt(0),
      ),
    );
    privateKey = await crypto.subtle.importKey(
      'pkcs8',
      pkcs8,
      { name: 'Ed25519' },
      false,
      ['sign'],
    );
  } catch (cause) {
    throw unsupported(cause);
  }

  return fromKeyAndPublic(privateKey, publicKey);
}

/**
 * A signer over a `CryptoKey` this process may use and cannot read.
 *
 * The point of the whole interface. Generate the key with
 * `generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])`, keep the pair's
 * private half (structured-clone it into IndexedDB if it must survive a reload),
 * and pass it here with its public half.
 *
 * @param privateKey the signing key — extractable or not, it is never exported
 * @param publicKey its public half: 64 hex, or the pair's `publicKey` (which
 *   WebCrypto leaves exportable even when the private half is not)
 */
export async function signerFromCryptoKey(
  privateKey: CryptoKey,
  publicKey: string | CryptoKey,
): Promise<Signer> {
  if (privateKey.type !== 'private') {
    throw new Error(
      `signerFromCryptoKey needs the private half of the pair, got a ${privateKey.type} key`,
    );
  }
  if (!privateKey.usages.includes('sign')) {
    throw new Error(
      "this CryptoKey cannot sign: generate it with usages ['sign', 'verify']",
    );
  }

  let publicHex: string;
  if (typeof publicKey === 'string') {
    // Validated rather than trusted: a wrong public key produces signatures
    // that verify nowhere, and the refusal arrives at a relay as a 403 —
    // nowhere near this call.
    fromHex(publicKey, 'publicKey', 32);
    publicHex = publicKey.trim().toLowerCase();
  } else {
    try {
      publicHex = hex(
        new Uint8Array(await crypto.subtle.exportKey('raw', publicKey)),
      );
    } catch (cause) {
      const detail = cause instanceof Error ? `: ${cause.message}` : '';
      throw new Error(
        'could not read the public half of this key pair; pass the public key ' +
          'as 64 hex instead' +
          detail,
      );
    }
  }

  return fromKeyAndPublic(privateKey, publicHex);
}

/** The shared tail of both constructors. */
function fromKeyAndPublic(privateKey: CryptoKey, publicKey: string): Signer {
  return {
    publicKey,
    async sign(payload: Uint8Array): Promise<Uint8Array> {
      try {
        return new Uint8Array(
          await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, payload),
        );
      } catch (cause) {
        throw unsupported(cause);
      }
    },
  };
}

/**
 * Resolve the signer an input describes, accepting either form.
 *
 * Internal. Every signing entry point takes an optional secret *and* an
 * optional signer, and exactly one must be present — passing both is refused
 * rather than silently preferring one, because the two could name different
 * keys and the caller would have no way to tell which signed.
 */
export async function resolveSigner(
  secret: string | undefined,
  signer: Signer | undefined,
  label: string,
): Promise<Signer> {
  if (signer && secret !== undefined) {
    throw new Error(
      `pass either ${label} or signer, not both — they may name different keys`,
    );
  }
  if (signer) return signer;
  if (secret !== undefined) return signerFromSecret(secret, label);
  throw new Error(`${label} or signer is required`);
}
