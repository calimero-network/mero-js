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

/** What the cloud sends the person back to: our callback URL plus the fragment. */
function callbackFor(consentUrl: string, account: string): URL {
  const back = new URL(new URL(consentUrl).searchParams.get("callback-url")!);
  back.hash = `grant=attacker-grant&account=${account}`;
  return back;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  fakeStorage();
});

describe("readCloudLinkCallback", () => {
  it("refuses a grant when this browser began no link", () => {
    expect(() =>
      readCloudLinkCallback({
        hash: `#grant=attacker-grant&account=${ACCOUNT}`,
        search: "",
      }),
    ).toThrow(/did not make/);
  });

  it("refuses a grant that carries the wrong state", () => {
    cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO });
    expect(() =>
      readCloudLinkCallback({
        hash: `#grant=attacker-grant&account=${ACCOUNT}`,
        search: "?link_state=guessed",
      }),
    ).toThrow(/did not make/);
  });

  it("refuses a grant sealed for a different account than the one this browser began for", () => {
    const back = callbackFor(
      cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
      OTHER,
    );
    expect(() =>
      readCloudLinkCallback({ hash: back.hash, search: back.search }),
    ).toThrow(/did not make/);
  });

  it("accepts the callback of the link this browser began, once", () => {
    const back = callbackFor(
      cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
      ACCOUNT,
    );
    expect(
      readCloudLinkCallback({ hash: back.hash, search: back.search }),
    ).toEqual({
      grant: "attacker-grant",
      account: ACCOUNT,
    });
    expect(() =>
      readCloudLinkCallback({ hash: back.hash, search: back.search }),
    ).toThrow(/did not make/);
  });

  it("keeps the pending link when a foreign grant is refused", () => {
    const back = callbackFor(
      cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
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
    ).toBe("attacker-grant");
  });
});

describe("CloudClient.readAccountLinkCallback", () => {
  it("reports a grant this browser never asked for as an error, not a grant", () => {
    const out = CloudClient.readAccountLinkCallback(
      `${RETURN_TO}#grant=attacker-grant&account=${ACCOUNT}`,
    );
    expect(out.grant).toBeUndefined();
    expect(out.error).toBe("unexpected_callback");
  });

  it("accepts the callback of a handoff this browser began", () => {
    const { url } = CloudClient.accountLinkHandoff({
      portalUrl: "https://cloud.calimero.network",
      accountId: ACCOUNT,
      callbackUrl: RETURN_TO,
    });
    const back = callbackFor(url, ACCOUNT);
    expect(CloudClient.readAccountLinkCallback(back.toString())).toEqual({
      grant: "attacker-grant",
      accountId: ACCOUNT,
    });
  });

  it("refuses a grant sealed for a different account than the handoff named", () => {
    const { url } = CloudClient.accountLinkHandoff({
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
  it("is found by a callback in another tab, which does not share session storage", () => {
    const unusable = () => {
      throw new Error("session storage is not shared with a noopener tab");
    };
    vi.stubGlobal("sessionStorage", {
      getItem: unusable,
      setItem: unusable,
      removeItem: unusable,
    });
    const back = callbackFor(
      cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
      ACCOUNT,
    );
    expect(
      readCloudLinkCallback({ hash: back.hash, search: back.search })?.account,
    ).toBe(ACCOUNT);
  });

  it("keeps an earlier consent URL valid when another is built for the same account", () => {
    const first = callbackFor(
      cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
      ACCOUNT,
    );
    cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO });
    expect(
      readCloudLinkCallback({ hash: first.hash, search: first.search })
        ?.account,
    ).toBe(ACCOUNT);
  });

  it("keeps links for two accounts apart", () => {
    const a = callbackFor(
      cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
      ACCOUNT,
    );
    const b = callbackFor(
      cloudLinkUrl({ accountId: OTHER, returnTo: RETURN_TO }),
      OTHER,
    );
    expect(
      readCloudLinkCallback({ hash: b.hash, search: b.search })?.account,
    ).toBe(OTHER);
    expect(
      readCloudLinkCallback({ hash: a.hash, search: a.search })?.account,
    ).toBe(ACCOUNT);
  });

  it("refuses a callback after the link has expired", () => {
    vi.useFakeTimers();
    const back = callbackFor(
      cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
      ACCOUNT,
    );
    vi.advanceTimersByTime(11 * 60 * 1000);
    expect(() =>
      readCloudLinkCallback({ hash: back.hash, search: back.search }),
    ).toThrow(/did not make/);
  });

  it("does not replace a pending link when the return URL is invalid", () => {
    const back = callbackFor(
      cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
      ACCOUNT,
    );
    expect(() =>
      cloudLinkUrl({ accountId: OTHER, returnTo: "/relative" }),
    ).toThrow();
    expect(
      readCloudLinkCallback({ hash: back.hash, search: back.search })?.account,
    ).toBe(ACCOUNT);
  });

  it("spends a handoff callback once", () => {
    const { url } = CloudClient.accountLinkHandoff({
      portalUrl: "https://cloud.calimero.network",
      accountId: ACCOUNT,
      callbackUrl: RETURN_TO,
    });
    const back = callbackFor(url, ACCOUNT).toString();
    expect(CloudClient.readAccountLinkCallback(back).grant).toBe(
      "attacker-grant",
    );
    expect(CloudClient.readAccountLinkCallback(back).error).toBe(
      "unexpected_callback",
    );
  });

  it("refuses a handoff for an account id the cloud would reject", () => {
    expect(() =>
      CloudClient.accountLinkHandoff({
        portalUrl: "https://cloud.calimero.network",
        accountId: ACCOUNT.toUpperCase(),
        callbackUrl: RETURN_TO,
      }),
    ).toThrow(/64 lowercase hex/);
  });
});

describe("pending links hygiene", () => {
  it("gives each consent URL its own state", () => {
    const a = new URL(
      cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
    );
    const b = new URL(
      cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
    );
    const state = (u: URL) =>
      new URL(u.searchParams.get("callback-url")!).searchParams.get(
        "link_state",
      );
    expect(state(a)).not.toBe(state(b));
  });

  it("forgets a link whose consent was declined", () => {
    const back = callbackFor(
      cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
      ACCOUNT,
    );
    expect(() =>
      readCloudLinkCallback({ hash: "#error=denied", search: back.search }),
    ).toThrow(/declined/);
    expect(() =>
      readCloudLinkCallback({ hash: back.hash, search: back.search }),
    ).toThrow(/did not make/);
  });

  it("keeps link_state out of the address bar after a callback", () => {
    const replaceState = vi.fn();
    vi.stubGlobal("history", { replaceState });
    vi.stubGlobal("location", {
      pathname: "/connected",
      search: "?keep=1&link_state=abc",
    });
    const back = callbackFor(
      cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
      ACCOUNT,
    );
    readCloudLinkCallback({ hash: back.hash, search: back.search });
    expect(replaceState).toHaveBeenCalledWith(null, "", "/connected?keep=1");
  });

  it("survives corrupted storage", () => {
    localStorage.setItem("calimero.cloud.link.pending", '{"x":null}');
    expect(() =>
      cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
    ).not.toThrow();
    localStorage.setItem("calimero.cloud.link.pending", "null");
    expect(() =>
      cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }),
    ).not.toThrow();
  });

  it("refuses state values that name object prototype members", () => {
    cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO });
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

  it("bounds how many pending links are kept", () => {
    for (let i = 0; i < 30; i++)
      cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO });
    const kept = JSON.parse(
      localStorage.getItem("calimero.cloud.link.pending")!,
    );
    expect(Object.keys(kept)).toHaveLength(20);
  });
});
