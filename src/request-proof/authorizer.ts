/**
 * A device cert, as something every transport can authenticate a request with.
 *
 * {@link signRequestProof} signs one request. This wraps it in the shape the
 * rest of the SDK can consume without knowing what a proof is: a function from
 * `(method, path, body)` to the headers that request should carry. The HTTP
 * client, the SSE client and the admin client each take that function, so a
 * keyholder is authenticated the same way on all three and none of them holds a
 * second copy of the encoding.
 *
 * ## Why the authorizer, and not a token
 *
 * A bearer token is one value reused across requests, so `getAuthToken` can be
 * called once and its result cached. A proof commits to the method, the path and
 * the body, so it cannot be: every request needs its own, and the signature has
 * to be taken where those three are known. That is the whole reason this is a
 * per-request callback rather than another token provider.
 *
 * Measured against a node built from core `aecba573b`: reads answer `200` to a
 * proof with no session, `/sse` answers `200` and `/ws` upgrades `101`, and the
 * listings are caller-scoped — an account in one of the node's two namespaces is
 * shown one, and a WS subscribe naming a context it is not a member of is
 * refused while the one it is a member of is granted.
 */
import { REQUEST_PROOF_HEADER, signRequestProof } from './request-proof.js';
import type { Signer } from '../signer/index.js';

/** What a keyholder holds: a certificate, and the key it certifies. */
export interface ProofCredential {
  /** The `AccountProof<DeviceCert>` from `signDeviceCert`, hex. */
  credential: string;
  /** The certified device's ed25519 secret, hex. Or pass `signer`. */
  deviceSecret?: string;
  /** A signer, for a key that cannot be exported to hex. */
  signer?: Signer;
  /** Seconds each signature stays valid. Defaults to `signRequestProof`'s. */
  validForSeconds?: number;
}

/** One request, as the proof has to see it. */
export interface RequestToAuthorize {
  method: string;
  /** Path only — a query string is excluded from the signature by design. */
  path: string;
  /** The body exactly as it will be sent, if there is one. */
  body?: string | Uint8Array;
}

/**
 * A per-request authorizer. Returns the headers to merge into the request.
 *
 * Returning headers rather than setting them keeps the caller in charge of the
 * request: a transport that already has an `Authorization` header can decide
 * which wins, and core decides the same way — a request carrying a token is
 * answered by that token, and the proof is only consulted when there is none.
 */
export type RequestAuthorizer = (
  request: RequestToAuthorize,
) => Promise<Record<string, string>>;

/**
 * Turn a device cert into a {@link RequestAuthorizer}.
 *
 * The credential is validated once, here, rather than on the first request:
 * a malformed one otherwise surfaces as a 401 from whichever read happened to
 * run first, which reads as "the node refused me" and sends the caller looking
 * in the wrong place.
 */
export function createProofAuthorizer(credential: ProofCredential): RequestAuthorizer {
  if (!credential.credential) {
    throw new Error('a proof authorizer needs the `credential` from signDeviceCert');
  }
  if (!credential.deviceSecret && !credential.signer) {
    throw new Error('a proof authorizer needs either `deviceSecret` or `signer`');
  }

  return async ({ method, path, body }) => {
    const proof = await signRequestProof({
      method,
      path,
      body,
      credential: credential.credential,
      deviceSecret: credential.deviceSecret,
      signer: credential.signer,
      validForSeconds: credential.validForSeconds,
    });
    return { [REQUEST_PROOF_HEADER]: proof };
  };
}

/**
 * The path a proof must be signed over, taken from a URL.
 *
 * Callers hold a base URL and a relative path; the proof commits to the path the
 * node will see, which is their join with the query dropped. Deriving it from
 * the assembled URL rather than concatenating strings is what keeps a base URL
 * carrying its own prefix (`…/admin-api`) from signing a path the node never
 * receives.
 */
export function signedPath(url: string): string {
  return new URL(url).pathname;
}
