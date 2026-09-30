/**
 * Turn a device key into something the HTTP client can call per request.
 *
 * A session is a bearer token: mint once, present many times. A request-carried
 * proof is the opposite — it commits to one method, one path and one body, so
 * it has to be produced at the moment of the call, by something holding the
 * signing key. This is that something, shaped like `getAuthToken` so the key
 * stays with the caller and never reaches the transport.
 */

import { callerProof } from "./caller-proof.js";
import { signRequest } from "./request-sig.js";

/** What the transport knows about the call it is about to make. */
export interface ProofRequest {
  /** `GET`, `POST`, … exactly as it will be sent. */
  method: string;
  /** The URL path the node will see, **without** the query string. */
  path: string;
  /** The exact bytes that will be sent, if any. */
  body?: unknown;
}

export interface ProofSignerOptions {
  /** `signDeviceCert(...)`, hex. */
  credential: string;
  /**
   * `signLoginStatement(...)`, hex — the three-link chain.
   *
   * Omit for the two-link chain, where `signerSecret` is the device key itself.
   */
  session?: string;
  /**
   * The ed25519 secret that signs each request, hex: the session key when
   * `session` is set, otherwise the device key.
   */
  signerSecret: string;
  /**
   * How long each signature stays valid. Seconds, default 120.
   *
   * This is what bounds replay and nothing else does, so it is deliberately
   * short and deliberately not configurable to "never". A clock skew allowance
   * lives on the node; this only has to outlive the flight time.
   */
  ttlSeconds?: number;
  /** Unix seconds. Injectable so a test does not depend on the wall clock. */
  now?: () => number;
}

/**
 * The bytes a body will actually be sent as.
 *
 * Refuses what it cannot hash without consuming or re-encoding. A stream can be
 * read once, and reading it here would send an empty body; `FormData` and
 * `URLSearchParams` are serialized by `fetch` in ways this cannot reproduce
 * byte for byte. Signing a guess would produce a signature over bytes that
 * never travelled, and the node would reject it with a signature error that
 * says nothing about the real cause — so this throws, naming the type.
 */
function bodyBytes(body: unknown): Uint8Array | string {
  if (body === undefined || body === null) return new Uint8Array(0);
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  throw new Error(
    `a request-carried proof cannot commit to a ${
      (body as { constructor?: { name?: string } })?.constructor?.name ?? typeof body
    } body: pass a string or bytes, or use a session for this call`,
  );
}

/**
 * Build the `X-Calimero-Proof` value for one request.
 *
 * Pass the result to the HTTP client's `getProof`.
 */
export function createProofSigner(
  options: ProofSignerOptions,
): (request: ProofRequest) => Promise<string> {
  const ttl = options.ttlSeconds ?? 120;
  const clock = options.now ?? (() => Math.floor(Date.now() / 1000));

  return async (request: ProofRequest): Promise<string> => {
    const issuedAt = clock();
    return callerProof({
      credential: options.credential,
      session: options.session,
      request: await signRequest({
        method: request.method,
        path: request.path,
        body: bodyBytes(request.body),
        issuedAt,
        expiresAt: issuedAt + ttl,
        signerSecret: options.signerSecret,
      }),
    });
  };
}
