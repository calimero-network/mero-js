/**
 * Passkeys: the browser's WebAuthn API, or anything that answers like it.
 *
 * Every binary field crosses the wire as base64url, matching
 * `calimero-identity`'s `Registration` and `Assertion`.
 */

export interface RegistrationJSON {
  attestationObject: string;
  clientDataJson: string;
}

export interface AssertionJSON {
  credentialId: string;
  authenticatorData: string;
  clientDataJson: string;
  signature: string;
}

/** Something that holds a passkey. */
export interface PasskeyProvider {
  /** Answer `navigator.credentials.create` for the node's options. */
  create(options: Record<string, unknown>): Promise<RegistrationJSON>;
  /** Sign `challenge` (an assertion), optionally limited to `allowCredentials`. */
  get(challenge: Uint8Array, rpId: string, allowCredentials?: string[]): Promise<AssertionJSON>;
}

export function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const buf = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** The platform authenticator (Touch ID, Face ID, Windows Hello, a security key, a synced passkey). */
export function browserPasskey(): PasskeyProvider {
  return {
    async create(options) {
      const o = options as {
        challenge: string;
        rp: { id: string; name: string };
        user: { id: string; name: string; displayName: string };
        pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>;
        excludeCredentials?: Array<{ type: 'public-key'; id: string }>;
        authenticatorSelection?: AuthenticatorSelectionCriteria;
        timeout?: number;
      };
      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge: buf(fromB64url(o.challenge)),
          rp: o.rp,
          user: { ...o.user, id: buf(fromB64url(o.user.id)) },
          pubKeyCredParams: o.pubKeyCredParams,
          excludeCredentials: (o.excludeCredentials ?? []).map((c) => ({ type: c.type, id: buf(fromB64url(c.id)) })),
          authenticatorSelection: o.authenticatorSelection,
          attestation: 'none',
          timeout: o.timeout,
        },
      })) as PublicKeyCredential | null;
      if (!cred) throw new Error('passkey creation was cancelled');
      const r = cred.response as AuthenticatorAttestationResponse;
      return {
        attestationObject: b64url(new Uint8Array(r.attestationObject)),
        clientDataJson: b64url(new Uint8Array(r.clientDataJSON)),
      };
    },
    async get(challenge, rpId, allowCredentials) {
      const cred = (await navigator.credentials.get({
        publicKey: {
          challenge: buf(challenge),
          rpId,
          userVerification: 'preferred',
          allowCredentials: (allowCredentials ?? []).map((id) => ({ type: 'public-key', id: buf(fromB64url(id)) })),
        },
      })) as PublicKeyCredential | null;
      if (!cred) throw new Error('passkey sign-in was cancelled');
      const r = cred.response as AuthenticatorAssertionResponse;
      return {
        credentialId: b64url(new Uint8Array(cred.rawId)),
        authenticatorData: b64url(new Uint8Array(r.authenticatorData)),
        clientDataJson: b64url(new Uint8Array(r.clientDataJSON)),
        signature: b64url(new Uint8Array(r.signature)),
      };
    },
  };
}
