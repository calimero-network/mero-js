/**
 * Byte-level primitives shared by everything in this package that signs.
 *
 * Extracted from `warrant/warrant.ts` when the device-cert signer arrived and
 * needed the same `domainHash`, hex handling and ed25519 import. Keeping one
 * copy is the point: these have to stay byte-identical with core, and two
 * copies drifting apart is exactly the failure the byte-parity e2e exists to
 * catch. Internal — not exported from the package root.
 */

const PKCS8_ED25519_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04,
  0x22, 0x04, 0x20,
]);

/** Little-endian u32, for borsh fixed-width fields and epoch counters. */
export function u32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(value: string, label: string, expectedBytes: number): Uint8Array {
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

export function u64le(value: number | bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
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
export async function domainHash(
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

export async function importSigningKey(secretHex: string): Promise<CryptoKey> {
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
 * The public half of an ed25519 seed.
 *
 * Derived rather than taken as an argument, for the reason core does the same: a
 * caller able to name a key it does not hold could produce a warrant it cannot
 * sign, and the field would stop meaning "who authorised this".
 */
export async function derivePublicKey(secretHex: string): Promise<Uint8Array> {
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
