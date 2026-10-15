/**
 * Conformance against core's pinned vectors.
 *
 * Every constant here is the one `crates/account/src/tests/request_wire_fixture.rs`
 * asserts, with the same fixed inputs. If these two files disagree, this package
 * signs requests that verify nowhere — and the failure arrives as a 401,
 * indistinguishable from a caller that simply is not who it claims.
 */

import { describe, expect, it } from "vitest";

import { signRequestProof } from "../request-proof/request-proof.js";
import { requestBodyHash, signRequest } from "./request-sig.js";

/** core's `key(3)` — a `PrivateKey` of 32 bytes of 0x03. */
const SIGNER_SECRET = "03".repeat(32);

const METHOD = "GET";
const PATH = "/admin-api/namespaces?limit=5&q=a%2Fb";
const BODY = '{"k":"v"}';
const ISSUED_AT = 1_700_000_000;
const EXPIRES_AT = 1_700_000_300;

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

describe("signRequest", () => {
  it("commits to the body under its own domain", async () => {
    expect(hex(await requestBodyHash(BODY))).toBe(
      "3b26137eb7b296bdf7d84b9193dd52d1947b2056731f38020f4a3b9b88d95121",
    );
  });

  /**
   * An empty body still hashes. There is no "absent body" encoding, so a
   * body-less request commits to the hash of nothing rather than to nothing.
   */
  it("commits to an empty body too, and to a different value", async () => {
    const empty = hex(await requestBodyHash());
    expect(empty).not.toBe("0".repeat(64));
    expect(empty).not.toBe(hex(await requestBodyHash(BODY)));
  });

  /**
   * The whole wire encoding, byte for byte. This is the assertion that fails
   * when either side changes the format, and it is the only one that would
   * catch a field reordered without being renamed.
   */
  it("reproduces core’s recorded encoding exactly", async () => {
    expect(
      await signRequest({
        method: METHOD,
        path: PATH,
        body: BODY,
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
        signerSecret: SIGNER_SECRET,
      }),
    ).toBe(
      // method: u32 LE 3, then "GET"
      "03000000" +
        "474554" +
        // path and query: u32 LE 37, then the ASCII bytes as sent
        "25000000" +
        "2f61646d696e2d6170692f6e616d657370616365" +
        "733f6c696d69743d3526713d6125324662" +
        // body_hash
        "3b26137eb7b296bdf7d84b9193dd52d1947b2056731f38020f4a3b9b88d95121" +
        // issued_at / expires_at, u64 LE
        "00f1536500000000" +
        "2cf2536500000000" +
        // signature
        "fab437d01e5fe97a376e9165a55e0ec91e73325b08bb997c8755776df0939d2f" +
        "c3001455d4c08e306244afd2f050c30a01237aa06187e185fc0a671941c8ac09",
    );
  });

  /**
   * Every field reaches the preimage. Without this a field could be added to
   * the encoding and left out of the hash — a signature that covers less than
   * it appears to, and one the node would accept for a request it was not
   * minted for.
   */
  it("signs differently when any signed field changes", async () => {
    const base = {
      method: METHOD,
      path: PATH,
      body: BODY,
      issuedAt: ISSUED_AT,
      expiresAt: EXPIRES_AT,
      signerSecret: SIGNER_SECRET,
    };
    const sig = async (over: Partial<typeof base>) =>
      signRequest({ ...base, ...over });

    const original = await sig({});
    for (const over of [
      { method: "POST" },
      { path: "/admin-api/namespaces?q=a%2Fb&limit=5" },
      { path: "/admin-api/namespaces?limit=5&q=a/b" },
      { path: "/admin-api/namespaces" },
      { body: '{"k":"w"}' },
      { issuedAt: ISSUED_AT + 1 },
      { expiresAt: EXPIRES_AT + 1 },
    ]) {
      expect(await sig(over)).not.toBe(original);
    }
  });

  /**
   * `HEAD` is the same permission as `GET` and not the same request. The node's
   * permission layer folds them on purpose; this layer must not, or a proof
   * minted for one could be presented as the other.
   */
  it("does not fold HEAD into GET", async () => {
    const base = {
      path: PATH,
      issuedAt: ISSUED_AT,
      expiresAt: EXPIRES_AT,
      signerSecret: SIGNER_SECRET,
    };
    expect(await signRequest({ ...base, method: "HEAD" })).not.toBe(
      await signRequest({ ...base, method: "GET" }),
    );
  });

  /** The device-key proof path signs the same request link, query included. */
  it("matches signRequestProof's request link", async () => {
    const link = await signRequest({
      method: METHOD,
      path: PATH,
      body: BODY,
      issuedAt: ISSUED_AT,
      expiresAt: EXPIRES_AT,
      signerSecret: SIGNER_SECRET,
    });
    await expect(
      signRequestProof({
        method: METHOD,
        path: PATH,
        body: BODY,
        credential: "ab",
        deviceSecret: SIGNER_SECRET,
        now: ISSUED_AT,
        validForSeconds: EXPIRES_AT - ISSUED_AT,
      }),
    ).resolves.toBe(`ab00${link}`);
  });
});
