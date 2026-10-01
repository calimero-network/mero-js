/**
 * Signing one request, so a caller's identity travels with it.
 *
 * This is the credential a keyholder presents when it has no session: the device
 * key signs the request itself, and the certificate its account signed says whose
 * key that is. The node verifies both with no store read and no prior
 * relationship — `crates/server/src/proof_auth.rs` — which is what lets a hosted
 * relay serve a caller it has never seen and holds no auth provider for.
 *
 * ## Why this exists alongside `login()`
 *
 * A session is a second link in the same chain, not an alternative to it. It
 * earns its place where the device key sits behind a boundary worth crossing
 * once — a hardware key, an extension — so a per-call signature becomes a
 * per-session one. A CLI, a server job, or a browser holding its device secret
 * in memory gains nothing from it, and `login()` additionally needs the node's
 * signing key learned out of band. This path needs neither.
 *
 * Measured against a node built from core `aecba573b`: a two-link proof is
 * served `200` on `/admin-api/namespaces`, `/contexts`, `/contexts/{id}`,
 * `/groups/{id}`, `/groups/{id}/contexts`, `/contexts/{id}/identities` and
 * `/storage`, and the listings are **filtered** — an account in one of a node's
 * two namespaces is shown one. `POST /admin-api/namespaces` is refused `403`, so
 * this authenticates a caller without granting operator actions.
 */
import {
  concat,
  domainHash,
  fromHex,
  hex,
  importSigningKey,
  u32le,
  u64le,
} from '../crypto/internal.js';
import type { Signer } from '../signer/index.js';

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** `calimero.auth.request.v1` — what the request signature is separated by. */
const REQUEST_SIGN_DOMAIN = utf8('calimero.auth.request.v1');
/**
 * `calimero.auth.request.body.v1` — distinct from the signing domain so a body
 * hash can never be presented as a request signature preimage.
 */
const REQUEST_BODY_DOMAIN = utf8('calimero.auth.request.body.v1');

/** The header a signed request carries. */
export const REQUEST_PROOF_HEADER = 'X-Calimero-Proof';

/** Seconds a signature stays honourable. Short, because it bounds replay. */
const DEFAULT_VALID_FOR = 300;

export interface RequestProofInput {
  /**
   * The HTTP method, exactly as it will be sent.
   *
   * Not folded. `HEAD` and `GET` are the same *permission* and the node's
   * permission table treats them so, but they are different *requests*: folding
   * them here would let a proof minted for one be presented as the other.
   */
  method: string;
  /**
   * The path, **without** the query string.
   *
   * Excluded because a proxy may legitimately rewrite a query, and a signature
   * over bytes something else may change fails for reasons the caller cannot
   * see. Anything that must be bound belongs in the body.
   */
  path: string;
  /**
   * The body, exactly as it will be sent. Omit when there is none.
   *
   * There is no "absent body" case: an omitted body commits to the hash of no
   * bytes, so a signer and a verifier cannot disagree about which encoding a
   * bodyless request used.
   */
  body?: string | Uint8Array;
  /** The `AccountProof<DeviceCert>` from `signDeviceCert`, hex. */
  credential: string;
  /** The certified device's ed25519 secret, hex. Or pass `signer`. */
  deviceSecret?: string;
  /** A signer, for a key that cannot be exported to hex. */
  signer?: Signer;
  /** Seconds the signature stays valid. Defaults to 300. */
  validForSeconds?: number;
  /** Override the clock, for tests. Unix seconds. */
  now?: number;
}

/**
 * Sign one request and return the `X-Calimero-Proof` value, hex.
 *
 * The encoding is borsh, and it is assembled rather than re-derived: the
 * account proof is the **first** field of `CallerProof`, so the credential hex
 * a caller already holds is exactly its own prefix. Concatenating avoids a
 * second implementation of a structure the node deserializes — the class of bug
 * that surfaces far away, as a node refusing a credential nothing can explain.
 *
 *   CallerProof = <account_proof bytes> || 0x00 (no session) || RequestSig
 *   RequestSig  = u32le(len method) || method
 *               || u32le(len path)  || path
 *               || body_hash[32]
 *               || u64le(issued_at) || u64le(expires_at)
 *               || signature[64]
 */
export async function signRequestProof(input: RequestProofInput): Promise<string> {
  const { method, path, credential } = input;

  if (!method) throw new Error('signRequestProof needs the method the request will use');
  if (!path.startsWith('/')) {
    throw new Error(`signRequestProof needs a path, got ${JSON.stringify(path)}`);
  }
  if (path.includes('?')) {
    throw new Error(
      `the path must carry no query string, got ${JSON.stringify(path)} — ` +
        'a query is excluded from the signature on purpose, because a proxy may ' +
        'rewrite one. Anything that must be bound belongs in the body.',
    );
  }

  const bodyBytes =
    input.body === undefined
      ? new Uint8Array()
      : typeof input.body === 'string'
        ? utf8(input.body)
        : input.body;

  const bodyHash = await domainHash(REQUEST_BODY_DOMAIN, [bodyBytes]);

  const issuedAt = Math.floor(input.now ?? Date.now() / 1000);
  const expiresAt = issuedAt + (input.validForSeconds ?? DEFAULT_VALID_FOR);

  const payload = await domainHash(REQUEST_SIGN_DOMAIN, [
    utf8(method),
    utf8(path),
    bodyHash,
    u64le(issuedAt),
    u64le(expiresAt),
  ]);

  const signature = await signPayload(payload, input);
  if (signature.length !== 64) {
    throw new Error(`the signer returned ${signature.length} bytes, not a 64-byte signature`);
  }

  const requestSig = concat(
    u32le(utf8(method).length),
    utf8(method),
    u32le(utf8(path).length),
    utf8(path),
    bodyHash,
    u64le(issuedAt),
    u64le(expiresAt),
    signature,
  );

  // The credential IS the account-proof prefix. Length is not asserted: it varies
  // with the handoff chain, and a wrong one fails as a refused proof rather than
  // silently as something else.
  const accountProof = hexToBytes(credential, 'credential');
  // 0x00: borsh's `None`. The device key signed the request, so there is no
  // session link — a different encoding, not a shorter one.
  return hex(concat(accountProof, new Uint8Array([0]), requestSig));
}

async function signPayload(
  payload: Uint8Array,
  input: RequestProofInput,
): Promise<Uint8Array> {
  if (input.signer) return input.signer.sign(payload);
  if (!input.deviceSecret) {
    throw new Error('signRequestProof needs either `deviceSecret` or `signer`');
  }
  const key = await importSigningKey(input.deviceSecret);
  return new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, payload));
}

/** Hex of unknown length — `fromHex` requires a fixed byte count. */
function hexToBytes(value: string, label: string): Uint8Array {
  const clean = value.trim();
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error(`${label} is not an even-length hex string`);
  }
  return fromHex(clean, label, clean.length / 2);
}
