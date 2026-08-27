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

const SIGN_DOMAIN = new TextEncoder().encode('calimero.warrant.v1');
const INTENT_DOMAIN = new TextEncoder().encode('calimero.warrant.intent.v1');

/** Ed25519 PKCS#8 prefix, so a raw 32-byte seed can be imported by WebCrypto. */
const PKCS8_ED25519_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04,
  0x22, 0x04, 0x20,
]);

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** What a warrant authorises. */
export interface WarrantInput {
  /**
   * The context, base58 — the same string every other method here takes.
   *
   * Base58 while the two accounts below are hex, because that is how the node
   * spells them: `ContextId` and `PublicKey` are base58, `AccountId` and
   * `DeviceId` are hex. Mixing them up produces a valid-looking value that only
   * fails against real data, so this module decodes each by its own rule rather
   * than accepting "32 bytes, somehow".
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

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(value: string, label: string, expectedBytes: number): Uint8Array {
  const clean = value.trim();
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length !== expectedBytes * 2) {
    throw new Error(
      `${label} must be ${expectedBytes * 2} hex characters, got ${clean.length}`,
    );
  }
  // Indexed rather than `match(/../g)!`: the length is already validated above,
  // so the assertion would only be telling the compiler what the guard proved,
  // and this needs no assertion at all.
  const bytes = new Uint8Array(expectedBytes);
  for (let i = 0; i < expectedBytes; i += 1) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Decode base58 to exactly 32 bytes.
 *
 * Hand-rolled rather than pulled in: it is fifteen lines, and a dependency here
 * would be this package's first.
 */
function fromBase58(value: string, label: string): Uint8Array {
  const clean = value.trim();
  let n = 0n;
  for (const char of clean) {
    const digit = B58.indexOf(char);
    if (digit < 0) {
      throw new Error(`${label} is not base58: unexpected character '${char}'`);
    }
    n = n * 58n + BigInt(digit);
  }
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  if (n !== 0n) {
    throw new Error(`${label} decodes to more than 32 bytes`);
  }

  // Round-trip, because decoding alone accepts too much. Hex digits are mostly
  // valid base58 characters, so a context handed over in hex by mistake can
  // decode to a real-looking 32 bytes instead of failing — `'11'.repeat(32)`
  // decodes to all zeros. Re-encoding catches it: the canonical form of those
  // bytes is 32 '1's, not 64.
  if (toBase58(out) !== clean) {
    throw new Error(
      `${label} is not a canonical base58 32-byte id. If you have it in hex, ` +
        `note that ${label} is base58 here while accounts are hex`,
    );
  }
  return out;
}

/** Encode 32 bytes as base58, for the canonical check above. */
function toBase58(bytes: Uint8Array): string {
  let n = 0n;
  for (const byte of bytes) {
    n = (n << 8n) | BigInt(byte);
  }
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) {
    leadingZeros += 1;
  }
  return '1'.repeat(leadingZeros) + out;
}

function u64le(value: number | bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, p) => total + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * core's `domain_hash`: SHA-256 over the length-prefixed domain, then each
 * length-prefixed part. The lengths are what stop two different field splits from
 * hashing alike.
 */
async function domainHash(
  domain: Uint8Array,
  parts: Uint8Array[],
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [u64le(domain.length), domain];
  for (const part of parts) {
    chunks.push(u64le(part.length), part);
  }
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', concat(...chunks)),
  );
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

async function importSigningKey(secretHex: string): Promise<CryptoKey> {
  const seed = fromHex(secretHex, 'deviceSecret', 32);
  const pkcs8 = concat(PKCS8_ED25519_PREFIX, seed);
  try {
    return await crypto.subtle.importKey(
      'pkcs8',
      pkcs8,
      { name: 'Ed25519' },
      false,
      ['sign'],
    );
  } catch (cause) {
    // The original message is folded in rather than passed as `cause`: this
    // package targets ES2020, where `Error` has no `cause` option.
    const detail = cause instanceof Error ? `: ${cause.message}` : '';
    throw new Error(
      'this runtime has no WebCrypto Ed25519, so a warrant cannot be signed ' +
        'here. Node 18.4+, Safari 17+, Firefox 129+ and Chrome 137+ have it; ' +
        'otherwise mint the warrant with `merod account warrant`' +
        detail,
    );
  }
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
  const context = fromBase58(input.context, 'context');
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

/**
 * The public half of an ed25519 seed.
 *
 * Derived rather than taken as an argument, for the reason core does the same: a
 * caller able to name a key it does not hold could produce a warrant it cannot
 * sign, and the field would stop meaning "who authorised this".
 */
async function derivePublicKey(secretHex: string): Promise<Uint8Array> {
  const seed = fromHex(secretHex, 'deviceSecret', 32);
  const pkcs8 = concat(PKCS8_ED25519_PREFIX, seed);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'Ed25519' },
    true,
    ['sign'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', key);
  const raw = (jwk as JsonWebKey & { x: string }).x;
  return Uint8Array.from(atob(raw.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0),
  );
}
