/**
 * Account id encoding.
 *
 * Core names the same account in two encodings, and the split is deliberate:
 * the admin API serves and requires **64 hex characters**, while contract data
 * (`sender`, `get_profiles`, anything stamped by `env::account_id()`) carries
 * **base58**. They are rendered differently on purpose, so that handing one
 * where the other is expected fails loudly instead of resolving to the wrong
 * principal.
 *
 * The cost is that any client reading a member from the admin API and
 * comparing it against a message sender is comparing two spellings of the same
 * value. A raw `===` silently never matches, and passing a contract-sourced id
 * to an admin route answers `400 Invalid account format: expected 64 hex
 * characters (32 bytes)`. Both failure modes are quiet enough to ship.
 *
 * These helpers canonicalise at that boundary. They convert accounts and
 * nothing else: a device key, an alias or any other value is returned
 * unchanged, because converting is this module's job and destroying what it
 * cannot convert is not.
 */

const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** A 32-byte account rendered as 64 hex characters. */
const HEX_ACCOUNT = /^[0-9a-f]{64}$/i;

/** Bytes → base58. Leading zero bytes become leading '1's, as in bitcoin base58. */
function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';

  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i]! << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let out = '';
  for (const byte of bytes) {
    if (byte !== 0) break;
    out += BASE58_ALPHABET[0];
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    out += BASE58_ALPHABET[digits[i]!];
  }
  return out;
}

/** base58 → bytes. Returns null when the input is not valid base58. */
function decodeBase58(value: string): Uint8Array | null {
  if (value.length === 0) return null;

  const bytes: number[] = [0];
  for (const char of value) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index < 0) return null;

    let carry = index;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  let leadingZeros = 0;
  for (const char of value) {
    if (char !== BASE58_ALPHABET[0]) break;
    leadingZeros++;
  }

  return Uint8Array.from([
    ...new Array<number>(leadingZeros).fill(0),
    ...bytes.reverse(),
  ]);
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Canonicalise an account id to hex — the form every admin route expects.
 *
 * Returns the input unchanged if it is not a 32-byte account, so a device key
 * or an alias survives a call to this function intact.
 */
export function toAccountHex(id: string | null | undefined): string {
  const trimmed = (id ?? '').trim();
  if (!trimmed) return '';
  if (HEX_ACCOUNT.test(trimmed)) return trimmed.toLowerCase();

  const decoded = decodeBase58(trimmed);
  if (!decoded || decoded.length !== 32) return trimmed;
  return toHex(decoded);
}

/**
 * Canonicalise an account id to base58 — the form the contract stamps on
 * `sender` and keys `get_profiles` by.
 *
 * Returns the input unchanged if it is not a 32-byte account.
 */
export function toAccountBase58(id: string | null | undefined): string {
  const trimmed = (id ?? '').trim();
  if (!trimmed) return '';
  if (!HEX_ACCOUNT.test(trimmed)) return trimmed;
  return encodeBase58(fromHex(trimmed));
}

/**
 * True when both ids name the same account, whichever encoding each is in.
 *
 * This is the comparison to reach for when checking a contract-sourced
 * `sender` against an admin-sourced member id. Two ids that are not accounts
 * compare false rather than accidentally matching as raw strings.
 */
export function sameAccount(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = toAccountHex(a);
  const right = toAccountHex(b);
  return HEX_ACCOUNT.test(left) && left === right;
}
