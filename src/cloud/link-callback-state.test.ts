/**
 * A link grant is only spent for a link this browser began.
 *
 * Whoever consents at the cloud can forward the redirect URL to someone else, so
 * a callback that arrives without the state this browser minted is somebody else's.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CloudClient } from "./cloud-client.js";
import { cloudLinkUrl, readCloudLinkCallback } from "./link-redirect.js";

const ACCOUNT = "1f".repeat(32);
const OTHER = "2e".repeat(32);
const RETURN_TO = "https://app.example/connected";

function fakeStorage(): void {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
}

/** A grant shaped as the cloud seals one for `account`. */
function grantFor(account: string): string {
  const claims = { use: "account-link-grant", sub: "owner@example.com", acc: account, chal: "ab".repeat(32), exp: 1 };
  return `${btoa(JSON.stringify(claims)).replace(/=+$/, "")}.dGFn`;
}

/** What the cloud sends the person back to: our callback URL plus the fragment. */
function callbackFor(consentUrl: string, account: string): URL {
  const back = new URL(new URL(consentUrl).searchParams.get("callback-url")!);
  back.hash = `grant=${grantFor(account)}&account=${account}`;
  return back;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  fakeStorage();
});

describe("readCloudLinkCallback", () => {
  it("refuses a grant when this browser began no link", async () => {
    expect(() =>
      readCloudLinkCallback({
        hash: `#grant=attacker-grant&account=${ACCOUNT}`,
        search: "",
      }),
    ).toThrow(/did not make/);
  });

  it("refuses a grant that carries the wrong state", async () => {
    await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO });
    expect(() =>
      readCloudLinkCallback({
        hash: `#grant=attacker-grant&account=${ACCOUNT}`,
        search: "?link_state=guessed",
      }),
    ).toThrow(/did not make/);
  });

  it("refuses a grant sealed for a different account than the one this browser began for", async () => {
    const back = callbackFor(
      await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
      OTHER,
    );
    expect(() =>
      readCloudLinkCallback({ hash: back.hash, search: back.search }),
    ).toThrow(/did not make/);
  });

  it("drops the pending link when its callback names a different account", async () => {
    const consent = await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO });
    const wrong = callbackFor(consent, OTHER);
    const right = callbackFor(consent, ACCOUNT);
    expect(() =>
      readCloudLinkCallback({ hash: wrong.hash, search: wrong.search }),
    ).toThrow(/did not make/);
    expect(() =>
      readCloudLinkCallback({ hash: right.hash, search: right.search }),
    ).toThrow(/did not make/);
  });

  it("accepts the callback of the link this browser began, once", async () => {
    const back = callbackFor(
      await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
      ACCOUNT,
    );
    expect(
      readCloudLinkCallback({ hash: back.hash, search: back.search }),
    ).toEqual({
      grant: grantFor(ACCOUNT),
      account: ACCOUNT,
      login: "owner@example.com",
      verifier: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(() =>
      readCloudLinkCallback({ hash: back.hash, search: back.search }),
    ).toThrow(/did not make/);
  });

  it("keeps the pending link when a foreign grant is refused", async () => {
    const back = callbackFor(
      await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
      ACCOUNT,
    );
    expect(() =>
      readCloudLinkCallback({
        hash: `#grant=x&account=${ACCOUNT}`,
        search: "",
      }),
    ).toThrow(/did not make/);
    expect(
      readCloudLinkCallback({ hash: back.hash, search: back.search })?.grant,
    ).toBe(grantFor(ACCOUNT));
  });
});

describe("CloudClient.readAccountLinkCallback", () => {
  it("reports a grant this browser never asked for as an error, not a grant", async () => {
    const out = CloudClient.readAccountLinkCallback(
      `${RETURN_TO}#grant=attacker-grant&account=${ACCOUNT}`,
    );
    expect(out.grant).toBeUndefined();
    expect(out.error).toBe("unexpected_callback");
  });

  it("accepts the callback of a handoff this browser began", async () => {
    const { url } = await CloudClient.accountLinkHandoff({
      portalUrl: "https://cloud.calimero.network",
      accountId: ACCOUNT,
      callbackUrl: RETURN_TO,
    });
    const back = callbackFor(url, ACCOUNT);
    expect(CloudClient.readAccountLinkCallback(back.toString())).toEqual({
      grant: grantFor(ACCOUNT),
      accountId: ACCOUNT,
      login: "owner@example.com",
      verifier: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("refuses a grant sealed for a different account than the handoff named", async () => {
    const { url } = await CloudClient.accountLinkHandoff({
      portalUrl: "https://cloud.calimero.network",
      accountId: ACCOUNT,
      callbackUrl: RETURN_TO,
    });
    const out = CloudClient.readAccountLinkCallback(
      callbackFor(url, OTHER).toString(),
    );
    expect(out.grant).toBeUndefined();
    expect(out.error).toBe("unexpected_callback");
  });
});

describe("pending links", () => {
  it("is found by a callback in another tab, which does not share session storage", async () => {
    const unusable = () => {
      throw new Error("session storage is not shared with a noopener tab");
    };
    vi.stubGlobal("sessionStorage", {
      getItem: unusable,
      setItem: unusable,
      removeItem: unusable,
    });
    const back = callbackFor(
      await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
      ACCOUNT,
    );
    expect(
      readCloudLinkCallback({ hash: back.hash, search: back.search })?.account,
    ).toBe(ACCOUNT);
  });

  it("keeps an earlier consent URL valid when another is built for the same account", async () => {
    const first = callbackFor(
      await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
      ACCOUNT,
    );
    await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO });
    expect(
      readCloudLinkCallback({ hash: first.hash, search: first.search })
        ?.account,
    ).toBe(ACCOUNT);
  });

  it("keeps links for two accounts apart", async () => {
    const a = callbackFor(
      await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
      ACCOUNT,
    );
    const b = callbackFor(
      await cloudLinkUrl({ accountId: OTHER, returnTo: RETURN_TO }),
      OTHER,
    );
    expect(
      readCloudLinkCallback({ hash: b.hash, search: b.search })?.account,
    ).toBe(OTHER);
    expect(
      readCloudLinkCallback({ hash: a.hash, search: a.search })?.account,
    ).toBe(ACCOUNT);
  });

  it("refuses a callback after the link has expired", async () => {
    vi.useFakeTimers();
    const back = callbackFor(
      await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
      ACCOUNT,
    );
    vi.advanceTimersByTime(11 * 60 * 1000);
    expect(() =>
      readCloudLinkCallback({ hash: back.hash, search: back.search }),
    ).toThrow(/did not make/);
  });

  it("does not replace a pending link when the return URL is invalid", async () => {
    const back = callbackFor(
      await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
      ACCOUNT,
    );
    await expect(
      cloudLinkUrl({ accountId: OTHER, returnTo: "/relative" }),
    ).rejects.toThrow();
    expect(
      readCloudLinkCallback({ hash: back.hash, search: back.search })?.account,
    ).toBe(ACCOUNT);
  });

  it("spends a handoff callback once", async () => {
    const { url } = await CloudClient.accountLinkHandoff({
      portalUrl: "https://cloud.calimero.network",
      accountId: ACCOUNT,
      callbackUrl: RETURN_TO,
    });
    const back = callbackFor(url, ACCOUNT).toString();
    expect(CloudClient.readAccountLinkCallback(back).grant).toBe(
      grantFor(ACCOUNT),
    );
    expect(CloudClient.readAccountLinkCallback(back).error).toBe(
      "unexpected_callback",
    );
  });

  it("refuses a handoff for an account id the cloud would reject", async () => {
    await expect(
      CloudClient.accountLinkHandoff({
        portalUrl: "https://cloud.calimero.network",
        accountId: ACCOUNT.toUpperCase(),
        callbackUrl: RETURN_TO,
      }),
    ).rejects.toThrow(/64 lowercase hex/);
  });
});

describe("pending links hygiene", () => {
  it("gives each consent URL its own state", async () => {
    const a = new URL(
      await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
    );
    const b = new URL(
      await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
    );
    const state = (u: URL) =>
      new URL(u.searchParams.get("callback-url")!).searchParams.get(
        "link_state",
      );
    expect(state(a)).not.toBe(state(b));
  });

  it("forgets a link whose consent was declined", async () => {
    const back = callbackFor(
      await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
      ACCOUNT,
    );
    expect(() =>
      readCloudLinkCallback({ hash: "#error=denied", search: back.search }),
    ).toThrow(/declined/);
    expect(() =>
      readCloudLinkCallback({ hash: back.hash, search: back.search }),
    ).toThrow(/did not make/);
  });

  it("keeps link_state out of the address bar after a callback", async () => {
    const replaceState = vi.fn();
    vi.stubGlobal("history", { replaceState });
    vi.stubGlobal("location", {
      pathname: "/connected",
      search: "?keep=1&link_state=abc",
    });
    const back = callbackFor(
      await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
      ACCOUNT,
    );
    readCloudLinkCallback({ hash: back.hash, search: back.search });
    expect(replaceState).toHaveBeenCalledWith(null, "", "/connected?keep=1");
  });

  it("survives corrupted storage", async () => {
    localStorage.setItem("calimero.cloud.link.pending", '{"x":null}');
    await expect(
      cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
    ).resolves.toBeTruthy();
    localStorage.setItem("calimero.cloud.link.pending", "null");
    await expect(
      cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
    ).resolves.toBeTruthy();
  });

  it("begins without storage and refuses the callback", async () => {
    vi.stubGlobal("localStorage", undefined);
    const back = callbackFor(
      await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
      ACCOUNT,
    );
    expect(() =>
      readCloudLinkCallback({ hash: back.hash, search: back.search }),
    ).toThrow(/did not make/);
  });

  it("refuses state values that name object prototype members", async () => {
    await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO });
    for (const state of [
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
    ]) {
      expect(() =>
        readCloudLinkCallback({
          hash: `#grant=g&account=${ACCOUNT}`,
          search: `?link_state=${state}`,
        }),
      ).toThrow(/did not make/);
    }
  });

  it("bounds how many pending links are kept", async () => {
    for (let i = 0; i < 30; i++)
      await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO });
    const kept = JSON.parse(
      localStorage.getItem("calimero.cloud.link.pending")!,
    );
    expect(Object.keys(kept)).toHaveLength(20);
  });
});
