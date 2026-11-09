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

/** How strongly an assertion must verify the user (WebAuthn's `UserVerificationRequirement`). */
export type PasskeyUserVerification = "required" | "preferred" | "discouraged";

/** What a confirmation asks of the passkey beyond the challenge. */
export interface PasskeyGetOptions {
  /**
   * `"required"` for a confirmation (`412 CONFIRM_REQUIRED`): the node
   * accepts only an assertion with the user-verified flag (PIN or
   * biometric). Absent for a plain sign-in, where `"preferred"` is enough.
   */
  userVerification?: PasskeyUserVerification;
}

/** Something that holds a passkey. */
export interface PasskeyProvider {
  /** Answer `navigator.credentials.create` for the node's options. */
  create(options: Record<string, unknown>): Promise<RegistrationJSON>;
  /**
   * Sign `challenge` (an assertion), optionally limited to
   * `allowCredentials`. `options.userVerification` is `"required"` when the
   * client answers a confirmation; a provider that always verifies the user
   * may ignore it.
   */
  get(
    challenge: Uint8Array,
    rpId: string,
    allowCredentials?: string[],
    options?: PasskeyGetOptions,
  ): Promise<AssertionJSON>;
}

export function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array {
  const pad =
    s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const buf = (b: Uint8Array): ArrayBuffer =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** A dismissed prompt, named as WebAuthn names one (`NotAllowedError`), so a confirmation reads it as declined. */
function cancelled(message: string): Error {
  const error = new Error(message);
  error.name = "NotAllowedError";
  return error;
}

/**
 * Ask `navigator.credentials[method]`. When a password manager extension has
 * replaced it on the page and answers "A request is already pending" with no
 * request of the browser's open, ask the browser's own
 * `CredentialsContainer.prototype[method]` once instead.
 *
 * LastPass does this: after one passkey prompt it refuses every later one in
 * the tab, and a sign-up takes two (create, then approve with the new
 * passkey). The browser's own API, asked directly, shows its prompt (iCloud
 * Keychain, Google Password Manager, Windows Hello, a phone). An extension
 * that answers normally is still used.
 */
type Ask = (
  options: CredentialCreationOptions | CredentialRequestOptions,
) => Promise<Credential | null>;

async function ask(
  method: "create" | "get",
  options: CredentialCreationOptions | CredentialRequestOptions,
): Promise<Credential | null> {
  const container = navigator.credentials;
  const page = container[method] as Ask;
  try {
    return await page.call(container, options);
  } catch (error) {
    const own = (
      globalThis as unknown as {
        CredentialsContainer?: { prototype: Record<string, unknown> };
      }
    ).CredentialsContainer?.prototype?.[method] as Ask | undefined;
    if (!own || own === page || !stuck(error)) throw error;
    return own.call(container, options);
  }
}

/** The refusal of a prompt while another is open, as browsers and extensions word it. */
function stuck(error: unknown): boolean {
  return /request is already pending/i.test(
    (error as { message?: unknown } | null)?.message?.toString() ?? "",
  );
}

/** The platform authenticator (Touch ID, Face ID, Windows Hello, a security key, a synced passkey). */
export function browserPasskey(): PasskeyProvider {
  return {
    async create(options) {
      const o = options as {
        challenge: string;
        rp: { id: string; name: string };
        user: { id: string; name: string; displayName: string };
        pubKeyCredParams: Array<{ type: "public-key"; alg: number }>;
        excludeCredentials?: Array<{ type: "public-key"; id: string }>;
        authenticatorSelection?: AuthenticatorSelectionCriteria;
        timeout?: number;
      };
      const cred = (await ask("create", {
        publicKey: {
          challenge: buf(fromB64url(o.challenge)),
          rp: o.rp,
          user: { ...o.user, id: buf(fromB64url(o.user.id)) },
          pubKeyCredParams: o.pubKeyCredParams,
          excludeCredentials: (o.excludeCredentials ?? []).map((c) => ({
            type: c.type,
            id: buf(fromB64url(c.id)),
          })),
          authenticatorSelection: o.authenticatorSelection,
          attestation: "none",
          timeout: o.timeout,
        },
      })) as PublicKeyCredential | null;
      if (!cred) throw cancelled("passkey creation was cancelled");
      const r = cred.response as AuthenticatorAttestationResponse;
      return {
        attestationObject: b64url(new Uint8Array(r.attestationObject)),
        clientDataJson: b64url(new Uint8Array(r.clientDataJSON)),
      };
    },
    async get(challenge, rpId, allowCredentials, options) {
      const cred = (await ask("get", {
        publicKey: {
          challenge: buf(challenge),
          rpId,
          userVerification: options?.userVerification ?? "preferred",
          allowCredentials: (allowCredentials ?? []).map((id) => ({
            type: "public-key",
            id: buf(fromB64url(id)),
          })),
        },
      })) as PublicKeyCredential | null;
      if (!cred) throw cancelled("passkey sign-in was cancelled");
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
