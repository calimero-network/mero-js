/**
 * Sign one HTTP request, so a caller's identity travels with it.
 *
 * This is the bottom link of the chain a delegated client presents. A session
 * has the node mint and remember something; this has the caller prove itself on
 * every call, so the node holds no session state and the same path works
 * whether or not the node runs a login provider at all.
 *
 * ```text
 * account root ──signs──▶ DeviceCert       cold, once, offline
 * device key   ──signs──▶ LoginStatement   once per session, hours
 * session key  ──signs──▶ RequestSig       per call   ◀── this module
 * ```
 *
 * **The middle link is optional.** A CLI or a server-side job signs with its
 * device key directly and presents two links; a browser keeping the device key
 * behind a hardware or extension boundary mints a session key and presents
 * three. The node's verifier handles both, so which you produce here is a
 * question about where your key lives, not about what the node accepts.
 *
 * **What it binds.** Method, path and a hash of the body. A signature for
 * `GET /a` is not a signature for `POST /a`, for `GET /b`, or for the same call
 * with different arguments.
 *
 * **The path excludes the query string**, deliberately: a proxy may legitimately
 * rewrite it — a token parameter most of all — and signing over bytes something
 * else is entitled to change means failing for reasons the caller cannot see.
 * Anything that must be bound belongs in the body.
 *
 * **The method is not normalized.** `HEAD` and `GET` are the same *permission*
 * and the node's permission layer folds them, but they are different requests.
 * Sign the method you are about to send.
 *
 * **Replay inside the window performs the identical request** and is bounded
 * rather than prevented — keep `expiresAt` short. A warrant, which authorizes a
 * change with lasting effect, carries a nonce ledger for this; a request
 * signature does not.
 *
 * **The byte contract is pinned in core**, at
 * `crates/account/src/tests/request_wire_fixture.rs`, for the same reason the
 * warrant and login ones are: the domains are `pub(crate)` there and the field
 * order is implicit in a `derive`, so nothing on that side forces anyone to
 * notice this file depends on both. This module's test asserts the same vectors.
 */

import {
  concat,
  domainHash,
  fromHex,
  hex,
  importSigningKey,
  u32le,
  u64le,
} from "../crypto/internal.js";

const SIGN_DOMAIN = new TextEncoder().encode("calimero.auth.request.v1");

/**
 * Its own domain, distinct from the signing one.
 *
 * The two are different jobs on the same bytes: this produces the commitment,
 * the other signs over it. Sharing a domain would make the commitment a
 * truncated disclosure of bytes something signs.
 */
const BODY_DOMAIN = new TextEncoder().encode("calimero.auth.request.body.v1");

/** A borsh `String`: its own `u32` little-endian length, then the UTF-8. */
function borshString(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  return concat(u32le(bytes.length), bytes);
}

/**
 * Commit to a request body.
 *
 * Always call it, including for a body-less request: an empty body hashes to a
 * value like any other, and there is no "absent body" encoding for a verifier
 * to disagree with you about.
 */
export async function requestBodyHash(
  body: Uint8Array | string = new Uint8Array(0),
): Promise<Uint8Array> {
  const bytes =
    typeof body === "string" ? new TextEncoder().encode(body) : body;
  return domainHash(BODY_DOMAIN, [bytes]);
}

/** What a caller is about to send. */
export interface RequestSigInput {
  /**
   * The HTTP method, exactly as it will appear on the wire — `GET`, `POST`,
   * `HEAD`. Not folded: see the module note.
   */
  method: string;
  /**
   * The path, **without** the query string. `/admin-api/namespaces`, not
   * `/admin-api/namespaces?token=…`.
   */
  path: string;
  /**
   * The request body, or nothing. Pass exactly the bytes you will send: the
   * signature commits to their hash, so a body re-serialized between signing
   * and sending is a signature for a different request.
   */
  body?: Uint8Array | string;
  /** Unix seconds at signing. */
  issuedAt: number | bigint;
  /**
   * Unix seconds after which the node must refuse it.
   *
   * Keep it short — minutes, not hours. It is what bounds replay, and nothing
   * else does.
   */
  expiresAt: number | bigint;
  /**
   * The ed25519 signing secret, hex (32 bytes): the session key on the
   * three-link chain, the device key on the two-link one.
   *
   * Never sent anywhere. It signs locally and only the signature travels.
   */
  signerSecret: string;
}

/**
 * Sign one request and return it hex-encoded, ready to present.
 *
 * Returns the encoding rather than an object for the reason `signWarrant` and
 * `signLoginStatement` do: the signature covers exactly these bytes, and a
 * caller that rebuilt the fields from JSON would have a second spelling able to
 * disagree with what was signed.
 */
export async function signRequest(input: RequestSigInput): Promise<string> {
  const key = await importSigningKey(input.signerSecret);
  const bodyHash = await requestBodyHash(input.body);

  const issuedAt = u64le(input.issuedAt);
  const expiresAt = u64le(input.expiresAt);

  const encoder = new TextEncoder();
  const preimage = await domainHash(SIGN_DOMAIN, [
    encoder.encode(input.method),
    encoder.encode(input.path),
    bodyHash,
    issuedAt,
    expiresAt,
  ]);

  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "Ed25519" }, key, preimage),
  );

  return hex(
    concat(
      borshString(input.method),
      borshString(input.path),
      bodyHash,
      issuedAt,
      expiresAt,
      signature,
    ),
  );
}

/** Re-exported so a caller can check a hex signer key before signing with it. */
export { fromHex };
