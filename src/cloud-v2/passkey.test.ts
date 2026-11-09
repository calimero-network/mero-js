import { afterEach, describe, expect, it, vi } from "vitest";
import { browserPasskey, b64url } from "./passkey";

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
  it("asks the browser's own API when an extension refuses with a request already pending", async () => {
    const browser = vi.fn(async () => assertion());
    page({ extension: async () => Promise.reject(pending()), browser });
    const out = await browserPasskey().get(
      new Uint8Array([9]),
      "calimero.network",
    );
    expect(out.credentialId).toBe(b64url(new Uint8Array([1, 2, 3])));
    expect(browser).toHaveBeenCalledTimes(1);
  });

  it("uses an extension that answers", async () => {
    const browser = vi.fn(async () => assertion());
    const extension = vi.fn(async () => assertion());
    page({ extension, browser });
    await browserPasskey().get(new Uint8Array([9]), "calimero.network");
    expect(extension).toHaveBeenCalledTimes(1);
    expect(browser).not.toHaveBeenCalled();
  });

  it("passes any other refusal through, and does not ask twice", async () => {
    const browser = vi.fn(async () => assertion());
    const declined = Object.assign(
      new Error("The operation either timed out or was not allowed."),
      { name: "NotAllowedError" },
    );
    page({ extension: async () => Promise.reject(declined), browser });
    await expect(
      browserPasskey().get(new Uint8Array([9]), "calimero.network"),
    ).rejects.toBe(declined);
    expect(browser).not.toHaveBeenCalled();
  });

  it("with no extension, the browser's own refusal stands (nothing else to ask)", async () => {
    const browser = vi.fn(async () => Promise.reject(pending()));
    page({ browser });
    await expect(
      browserPasskey().get(new Uint8Array([9]), "calimero.network"),
    ).rejects.toThrow("already pending");
    expect(browser).toHaveBeenCalledTimes(1);
  });
});
