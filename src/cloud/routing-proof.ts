/**
 * Proving an account to the cloud for the one read a joiner cannot avoid.
 *
 * `GET /api/cloud/namespaces/{ns}/admitters` answers where to send a signed
 * membership op. A joiner needs it and *cannot* hold a cloud login: it is by
 * construction not the namespace owner, and not needing an account on the cloud
 * is the entire point of the path — a keyholder mints a root, certifies a
 * device and signs its own join offline, and this read is the only thing that
 * tells it where to post the result.
 *
 * So the caller proves possession of the credential it already holds. The cloud
 * mints a sealed, namespace-bound nonce; the device signs it; the read carries
 * the certificate and that signature.
 *
 * ## What this establishes, and what it does not
 *
 * It establishes that the caller holds a device key certified by some account
 * root, and *which* account that is. It does **not** establish that the account
 * was invited to the namespace, nor that it is a member — the cloud cannot
 * check either, because membership is governance state held by the nodes.
 * Anyone can mint an account root offline, so this is not a wall. It buys
 * attribution (every read names an account and can be rate-limited) and it ends
 * anonymous bulk discovery. Authorization stays where it always was: at the
 * node, on the signed op.
 *
 * ## Why the DEVICE signs, not the root
 *
 * The opposite choice from {@link signAccountLink}, deliberately. That one
 * exists for the device-loss case, so only the root will do. This one runs on
 * every routing read from a browser that discards the root immediately after
 * certifying its device — requiring the root would mean re-entering a 24-word
 * phrase to look up a URL.
 *
 * The certificate alone is not enough and the signature is not redundant with
 * it: a certificate travels in the clear inside every device-link op, so anyone
 * who has seen one can replay it. Only the nonce signature binds the presenter
 * to the device.
 */

import { concat, fromHex, importSigningKey } from '../crypto/internal.js';

/**
 * The signing domain, followed immediately by the nonce as UTF-8.
 *
 * A flat prefix rather than this SDK's usual length-prefixed `domainHash`,
 * because the verifier is MDMA's `verify_routing_proof` and it checks
 * `DOMAIN ‖ nonce` against the raw message. The trailing NUL is part of the
 * domain string on both sides; it is what stops a domain that is a prefix of
 * some future one from colliding with it.
 */
const ROUTING_PROOF_DOMAIN = new TextEncoder().encode(
  'calimero.mdma.routing-read.v1\0',
);

/**
 * The credential a routing read presents: a certificate, and the key to sign
 * the challenge with.
 *
 * `credential` is the 237-byte `AccountProof<DeviceCert>` as hex — exactly what
 * {@link signDeviceCert} returns, and the same string a login statement and a
 * warrant carry. It is public by construction.
 *
 * `deviceSecret` never leaves the process. It signs the challenge locally and
 * only the signature travels.
 */
export interface RoutingCredential {
  /** The `AccountProof<DeviceCert>`, hex borsh, as `signDeviceCert` returns it. */
  credential: string;
  /** The certified device's ed25519 signing secret, hex (32 bytes). */
  deviceSecret: string;
}

/** A challenge to sign, as the cloud minted it. */
export interface RoutingChallenge {
  namespaceId: string;
  /** Opaque and sealed — the client neither parses nor constructs this. */
  nonce: string;
  /** Epoch **milliseconds**, as MDMA reports it. Nonces live about two minutes. */
  expiresAtMs: number;
}

/**
 * The three header values a proven routing read carries.
 *
 * Intersected with `Record<string, string>` rather than declared as a plain
 * interface so it drops straight into a headers bag: an interface has no index
 * signature, so TypeScript refuses it where `Record<string, string>` is wanted
 * even though every field is a string.
 */
export type RoutingProofHeaders = Record<string, string> & {
  'X-Calimero-Credential': string;
  'X-Calimero-Nonce': string;
  'X-Calimero-Signature': string;
};

/**
 * Sign a routing challenge with the device key.
 *
 * Returns base64, which is what the header carries and what MDMA's verifier
 * decodes — the one place this SDK does not spell a signature as hex, because
 * the wire format is not ours to choose.
 */
export async function signRoutingChallenge(
  nonce: string,
  deviceSecret: string,
): Promise<string> {
  // Validate the secret the same way every other signing path does, so a
  // truncated or mis-cased key fails here rather than as a 403 from the cloud.
  fromHex(deviceSecret, 'deviceSecret', 32);
  const key = await importSigningKey(deviceSecret);

  const message = concat(
    ROUTING_PROOF_DOMAIN,
    new TextEncoder().encode(nonce),
  );

  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'Ed25519' }, key, message),
  );

  return base64(signature);
}

/**
 * Build the headers for one routing read, from a challenge the cloud minted.
 *
 * Separated from the request so a caller that fetches its own challenge — a
 * test, or a client batching several reads against one nonce — can use the same
 * encoding rather than a second spelling of it.
 */
export async function routingProofHeaders(
  challenge: RoutingChallenge,
  credential: RoutingCredential,
): Promise<RoutingProofHeaders> {
  return {
    'X-Calimero-Credential': credential.credential,
    'X-Calimero-Nonce': challenge.nonce,
    'X-Calimero-Signature': await signRoutingChallenge(
      challenge.nonce,
      credential.deviceSecret,
    ),
  };
}

/**
 * base64, the encoding the header carries.
 *
 * `btoa` is global in every browser and in Node since 16, and this package
 * requires Node 18 — so there is no runtime here that needs a `Buffer`
 * fallback, and adding one would pull a Node-only global into browser code.
 */
function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
