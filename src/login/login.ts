/**
 * Sign the statement a device key presents to obtain a session on a node.
 *
 * This is the half of password-free login that has to run where the device key
 * lives, and for the case delegated execution exists for that is a browser tab.
 * Until this module, the only thing that could produce a login statement was
 * `merod account login-statement` — which is to say, a client had to hold a node
 * to ask a node for a session.
 *
 * **What this gets you, and what it does not.** A statement proves a device key
 * asked for this session. It says nothing about which account that device
 * belongs to: that is the `AccountProof` travelling beside it, which the node
 * checks separately. Signing here and presenting no proof gets a 401 that looks
 * exactly like a bad signature.
 *
 * **The session key is minted by the caller, not here.** The device key signs
 * once, over a short-lived key the caller generates and keeps; that key does the
 * talking for the rest of the session, which is what keeps the device key off
 * the wire. Passing a key you do not hold the private half of produces a session
 * you cannot speak on.
 *
 * **`node` must come from something you pinned.** Not from the challenge
 * response, and not from any field the node itself chose — an attacker who can
 * answer on the node's behalf would otherwise pick what your device signs about,
 * which is the whole reason the field exists. Read it out of band from the node
 * operator.
 *
 * **The byte contract is pinned in core**, at
 * `crates/account/src/tests/login_wire_fixture.rs`, for the same reason the
 * warrant one is: `AUTH_LOGIN_SIGN_DOMAIN` is `pub(crate)` there and the field
 * order is implicit in a `derive`, so nothing on that side forces anyone to
 * notice this file depends on both. This module's test asserts the same vectors.
 */

import {
  concat,
  derivePublicKey,
  domainHash,
  fromHex,
  hex,
  importSigningKey,
  u32le,
  u64le,
} from '../crypto/internal.js';

const SIGN_DOMAIN = new TextEncoder().encode('calimero.auth.login.v1');

/**
 * The client surface a session is bound to.
 *
 * A session minted for one surface cannot be presented from another, so a single
 * compromised surface does not yield sessions usable everywhere.
 */
export type Audience =
  | {
      /**
       * A browser origin, spelled exactly as the browser spells it
       * (`https://host:port`, no trailing slash).
       *
       * Compared byte for byte by the node. Do not normalize it here: two
       * spellings of one origin would mean a verifier that disagrees with the
       * browser about which one a token was for. `location.origin` is already
       * the spelling you want.
       */
      kind: 'webOrigin';
      origin: string;
    }
  | {
      /** A signed native client, named by its code-signing identity. */
      kind: 'codeSigningId';
      id: string;
    }
  | {
      /**
       * A command-line client, which has no origin and no signing identity.
       *
       * Carries no payload deliberately: a string here would be an audience that
       * binds nothing while looking like it binds something.
       */
      kind: 'cli';
    };

/** The borsh enum tag for each variant, in core's declaration order. */
const AUDIENCE_TAG: Record<Audience['kind'], number> = {
  webOrigin: 0,
  codeSigningId: 1,
  cli: 2,
};

/** The variant's payload as UTF-8 — empty for the payload-free `cli`. */
function audienceBody(audience: Audience): Uint8Array {
  const encoder = new TextEncoder();
  switch (audience.kind) {
    case 'webOrigin':
      return encoder.encode(audience.origin);
    case 'codeSigningId':
      return encoder.encode(audience.id);
    case 'cli':
      return new Uint8Array(0);
  }
}

/**
 * What the audience contributes to the **signing preimage**: tag then body, with
 * no length between them.
 *
 * `domainHash` length-prefixes every part it is handed, so a length written here
 * would be counted twice and the preimage would verify nowhere. This is the one
 * field spelled differently in the two encodings — see {@link audienceWire}.
 */
function audienceSigningBytes(audience: Audience): Uint8Array {
  return concat(
    Uint8Array.from([AUDIENCE_TAG[audience.kind]]),
    audienceBody(audience),
  );
}

/**
 * What the audience contributes to the **wire encoding**: the borsh enum tag,
 * then for the two payload-carrying variants a borsh `String` — its own `u32`
 * little-endian length, then the UTF-8.
 *
 * `cli` is a bare tag. Writing a `u32` zero after it instead produces four extra
 * bytes that a node reads as the start of the challenge, so the statement fails
 * as a bad signature rather than as a malformed one.
 */
function audienceWire(audience: Audience): Uint8Array {
  const tag = Uint8Array.from([AUDIENCE_TAG[audience.kind]]);
  if (audience.kind === 'cli') {
    return tag;
  }
  const body = audienceBody(audience);
  return concat(tag, u32le(body.length), body);
}

/** What a device is asking for. */
export interface LoginStatementInput {
  /**
   * The node this session is for, hex (32 bytes) — its identity public key, as
   * you pinned it. See the module note: this must not come from the node.
   */
  node: string;
  /** The client surface the session is bound to. */
  audience: Audience;
  /** The challenge this node issued, hex (32 bytes). Proves freshness. */
  challenge: string;
  /**
   * The public half of the ephemeral key this session will speak with, hex (32
   * bytes). Minted per session by the caller and thrown away with it.
   */
  sessionKey: string;
  /** Unix seconds at signing. */
  issuedAt: number | bigint;
  /** Unix seconds after which the node must refuse it. */
  expiresAt: number | bigint;
  /**
   * The device's ed25519 signing secret, hex (32 bytes).
   *
   * Never sent anywhere. It signs locally and only the signature travels, which
   * is what lets a statement be minted by something holding no node.
   */
  deviceSecret: string;
}

/**
 * Sign a login statement and return it hex-encoded, ready to present with an
 * account proof.
 *
 * Returns the encoding rather than an object for the reason `signWarrant` does:
 * the signature covers exactly these bytes, and a caller that rebuilt the fields
 * from JSON would have a second spelling able to disagree with what was signed.
 */
export async function signLoginStatement(
  input: LoginStatementInput,
): Promise<string> {
  const node = fromHex(input.node, 'node', 32);
  const challenge = fromHex(input.challenge, 'challenge', 32);
  const sessionKey = fromHex(input.sessionKey, 'sessionKey', 32);

  const key = await importSigningKey(input.deviceSecret);
  const deviceKey = await derivePublicKey(input.deviceSecret);

  const issuedAt = u64le(input.issuedAt);
  const expiresAt = u64le(input.expiresAt);

  const preimage = await domainHash(SIGN_DOMAIN, [
    node,
    audienceSigningBytes(input.audience),
    challenge,
    sessionKey,
    deviceKey,
    issuedAt,
    expiresAt,
  ]);

  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'Ed25519' }, key, preimage),
  );

  return hex(
    concat(
      node,
      audienceWire(input.audience),
      challenge,
      sessionKey,
      deviceKey,
      issuedAt,
      expiresAt,
      signature,
    ),
  );
}
