import { afterEach, describe, expect, it, vi } from "vitest";
import { browserPasskey, b64url, es256First } from "./passkey";

// A page where an extension (LastPass) has replaced navigator.credentials:
// after one prompt it answers every later one in the tab with "A request is
// already pending", though the browser itself has none open. A sign-up takes
// two prompts in a row (create, then approve), so its second always failed.

const pending = () =>
  Object.assign(new Error("A request is already pending."), {
    name: "OperationError",
  });

function assertion(): PublicKeyCredential {
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  return {
    rawId: bytes,
    response: {
      authenticatorData: bytes,
      clientDataJSON: bytes,
      signature: bytes,
    },
  } as unknown as PublicKeyCredential;
}

function page({
  extension,
  browser,
}: {
  extension?: (o: unknown) => Promise<unknown>;
  browser: (o: unknown) => Promise<unknown>;
}) {
  class CredentialsContainer {}
  Object.assign(CredentialsContainer.prototype, {
    get: browser,
    create: browser,
  });
  const container = new CredentialsContainer() as Record<string, unknown>;
  if (extension)
    Object.assign(container, { get: extension, create: extension });
  vi.stubGlobal("CredentialsContainer", CredentialsContainer);
  vi.stubGlobal("navigator", { credentials: container });
}

afterEach(() => vi.unstubAllGlobals());

describe("browserPasskey", () => {
  it("asks the browser's own API, never an extension's replacement of navigator.credentials", async () => {
    const browser = vi.fn(async () => assertion());
    const extension = vi.fn(async () => assertion());
    page({ extension, browser });
    const out = await browserPasskey().get(
      new Uint8Array([9]),
      "calimero.network",
    );
    expect(out.credentialId).toBe(b64url(new Uint8Array([1, 2, 3])));
    expect(browser).toHaveBeenCalledTimes(1);
    expect(extension).not.toHaveBeenCalled();
  });

  it("passes the browser's refusal through, asked once", async () => {
    const declined = Object.assign(
      new Error("The operation either timed out or was not allowed."),
      { name: "NotAllowedError" },
    );
    const browser = vi.fn(async () => Promise.reject(declined));
    page({ browser });
    await expect(
      browserPasskey().get(new Uint8Array([9]), "calimero.network"),
    ).rejects.toBe(declined);
    expect(browser).toHaveBeenCalledTimes(1);
  });

  it("uses navigator.credentials where there is no CredentialsContainer", async () => {
    const get = vi.fn(async () => assertion());
    vi.stubGlobal("CredentialsContainer", undefined);
    vi.stubGlobal("navigator", { credentials: { get } });
    await browserPasskey().get(new Uint8Array([9]), "calimero.network");
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe("browserPasskey.create", () => {
  it("asks the authenticator for ES256 only, never Ed25519 a password manager cannot sign with later", async () => {
    let asked: Array<{ alg: number }> = [];
    const bytes = new Uint8Array([1]).buffer;
    const made = {
      response: { attestationObject: bytes, clientDataJSON: bytes },
    };
    page({
      browser: async (o) => {
        asked = (
          o as { publicKey: { pubKeyCredParams: Array<{ alg: number }> } }
        ).publicKey.pubKeyCredParams;
        return made;
      },
    });
    await browserPasskey().create({
      challenge: "AA",
      rp: { id: "calimero.network", name: "Calimero" },
      user: { id: "AA", name: "ana", displayName: "ana" },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -8 },
      ],
    });
    expect(asked.map((p) => p.alg)).toEqual([-7]);
  });

  it("keeps what the node offers when ES256 is not among it", () => {
    expect(
      es256First([{ type: "public-key", alg: -8 }]).map((p) => p.alg),
    ).toEqual([-8]);
  });
});
