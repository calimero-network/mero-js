import { describe, expect, it } from "vitest";

import { createProofSigner } from "./proof-signer.js";
import { signerFromCryptoKey, signerFromSecret } from "../signer/signer.js";

/**
 * The whole chain, reproduced byte for byte from core's own fixture.
 *
 * `caller-proof.test.ts` proves the assembler concatenates correctly given the
 * three links. This proves the link this package actually MINTS — the request
 * signature — matches what core produces for the same inputs, and that the
 * assembled header is identical to the one core borsh-serializes. Together they
 * close the loop: if either the preimage or the field order drifted, this value
 * would change and nothing else in the suite would notice.
 *
 * Inputs are core's `chain_for(1, &key(7))`: session key `PrivateKey::from([101;
 * 32])` (101 == 0x65), `NOW = 1_700_000_000`, and
 * `RequestSig::sign(&session_sk, "GET", "/admin-api/namespaces", b"", NOW, NOW +
 * 300)`.
 */
const SESSION_SECRET = "65".repeat(32);
const NOW = 1_700_000_000;

describe("createProofSigner", () => {
  it("reproduces core's CallerProof byte for byte", async () => {
    const sign = createProofSigner({
      credential: "028a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c0000000004cfa21629a77f8cd8ddd3f821ed514009a9f572b2ce8e0a11f5cbb5e25340b0222222222222222222222222222222229aeef190d5865e90861a94ec2e0b28de17cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080ce09090909090909090909090909090909090909090909090909090909090909090000000000000000bba802950e323563e8cef9867dfd562dfbd50e106ccd07c779acf3e4daba6a964e0d1354ee521747c38e0aa9839d9460dbc5a278822ac729e58f62ed8835120f",
      session: "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c027777777777777777777777777777777777777777777777777777777777777777d62f016a1efd1e4fdf793eb42cd84471e1ba9f0cf04d1287b5cc71f616287cb817cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080ce00f153650000000010ff53650000000056554af3cbf04380c22898aa2b15397f526d9dec50ab792b76fd45ca01668488be57b317015d9e4aada80a8dda0367f7390071051e2b3855c5e7eeaf0119520c",
      signerSecret: SESSION_SECRET,
      ttlSeconds: 300,
      now: () => NOW,
    });

    await expect(
      sign({ method: "GET", path: "/admin-api/namespaces" }),
    ).resolves.toBe("028a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c0000000004cfa21629a77f8cd8ddd3f821ed514009a9f572b2ce8e0a11f5cbb5e25340b0222222222222222222222222222222229aeef190d5865e90861a94ec2e0b28de17cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080ce09090909090909090909090909090909090909090909090909090909090909090000000000000000bba802950e323563e8cef9867dfd562dfbd50e106ccd07c779acf3e4daba6a964e0d1354ee521747c38e0aa9839d9460dbc5a278822ac729e58f62ed8835120f01ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c027777777777777777777777777777777777777777777777777777777777777777d62f016a1efd1e4fdf793eb42cd84471e1ba9f0cf04d1287b5cc71f616287cb817cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080ce00f153650000000010ff53650000000056554af3cbf04380c22898aa2b15397f526d9dec50ab792b76fd45ca01668488be57b317015d9e4aada80a8dda0367f7390071051e2b3855c5e7eeaf0119520c03000000474554150000002f61646d696e2d6170692f6e616d65737061636573ea5bb92ca52d40a333e56e353225c6a569e2afbcb7a9152aa9727bed602872f900f15365000000002cf2536500000000603ab514b9df40ba389f9eae5d3c3040fa9ef473a4e00ac0000f8db1b08f50ada268bbcf7daf351e6afec3176e7aa2f6c5cab57a2ff930bd7962035358a8db0c");
  });

  it("produces the two-link encoding when there is no session", async () => {
    const sign = createProofSigner({
      credential: "028a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c0000000004cfa21629a77f8cd8ddd3f821ed514009a9f572b2ce8e0a11f5cbb5e25340b0222222222222222222222222222222229aeef190d5865e90861a94ec2e0b28de17cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080ce09090909090909090909090909090909090909090909090909090909090909090000000000000000bba802950e323563e8cef9867dfd562dfbd50e106ccd07c779acf3e4daba6a964e0d1354ee521747c38e0aa9839d9460dbc5a278822ac729e58f62ed8835120f",
      signerSecret: SESSION_SECRET,
      ttlSeconds: 300,
      now: () => NOW,
    });

    // Same request, same key — only the absent session differs, and it changes
    // the bytes rather than shortening them.
    await expect(
      sign({ method: "GET", path: "/admin-api/namespaces" }),
    ).resolves.toBe("028a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c0000000004cfa21629a77f8cd8ddd3f821ed514009a9f572b2ce8e0a11f5cbb5e25340b0222222222222222222222222222222229aeef190d5865e90861a94ec2e0b28de17cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080ce09090909090909090909090909090909090909090909090909090909090909090000000000000000bba802950e323563e8cef9867dfd562dfbd50e106ccd07c779acf3e4daba6a964e0d1354ee521747c38e0aa9839d9460dbc5a278822ac729e58f62ed8835120f0003000000474554150000002f61646d696e2d6170692f6e616d65737061636573ea5bb92ca52d40a333e56e353225c6a569e2afbcb7a9152aa9727bed602872f900f15365000000002cf2536500000000603ab514b9df40ba389f9eae5d3c3040fa9ef473a4e00ac0000f8db1b08f50ada268bbcf7daf351e6afec3176e7aa2f6c5cab57a2ff930bd7962035358a8db0c");
  });

  it("refuses a body it cannot commit to, naming the type", async () => {
    const sign = createProofSigner({
      credential: "028a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c0000000004cfa21629a77f8cd8ddd3f821ed514009a9f572b2ce8e0a11f5cbb5e25340b0222222222222222222222222222222229aeef190d5865e90861a94ec2e0b28de17cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080ce09090909090909090909090909090909090909090909090909090909090909090000000000000000bba802950e323563e8cef9867dfd562dfbd50e106ccd07c779acf3e4daba6a964e0d1354ee521747c38e0aa9839d9460dbc5a278822ac729e58f62ed8835120f",
      signerSecret: SESSION_SECRET,
      now: () => NOW,
    });

    // Signing a guess here would produce a signature over bytes that never
    // travelled, and the node would reject it as a bad signature — pointing at
    // the key rather than at the body.
    await expect(
      sign({ method: "POST", path: "/x", body: new ReadableStream() }),
    ).rejects.toThrow(/ReadableStream/);
  });

  it("defaults to a short expiry, because that is what bounds replay", async () => {
    let captured = "";
    const sign = createProofSigner({
      credential: "028a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c0000000004cfa21629a77f8cd8ddd3f821ed514009a9f572b2ce8e0a11f5cbb5e25340b0222222222222222222222222222222229aeef190d5865e90861a94ec2e0b28de17cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080ce09090909090909090909090909090909090909090909090909090909090909090000000000000000bba802950e323563e8cef9867dfd562dfbd50e106ccd07c779acf3e4daba6a964e0d1354ee521747c38e0aa9839d9460dbc5a278822ac729e58f62ed8835120f",
      signerSecret: SESSION_SECRET,
      now: () => NOW,
    });
    captured = await sign({ method: "GET", path: "/admin-api/namespaces" });

    // 120s default: the two encodings differ only in expires_at, so an
    // accidental change to the default shows up here rather than in production.
    const withExplicit = await createProofSigner({
      credential: "028a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c0000000004cfa21629a77f8cd8ddd3f821ed514009a9f572b2ce8e0a11f5cbb5e25340b0222222222222222222222222222222229aeef190d5865e90861a94ec2e0b28de17cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080ce09090909090909090909090909090909090909090909090909090909090909090000000000000000bba802950e323563e8cef9867dfd562dfbd50e106ccd07c779acf3e4daba6a964e0d1354ee521747c38e0aa9839d9460dbc5a278822ac729e58f62ed8835120f",
      signerSecret: SESSION_SECRET,
      ttlSeconds: 120,
      now: () => NOW,
    })({ method: "GET", path: "/admin-api/namespaces" });

    expect(captured).toBe(withExplicit);
  });

  it("signs the same bytes through a key that cannot be exported", async () => {
    const prefix = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];
    const key = await crypto.subtle.importKey("pkcs8", new Uint8Array([...prefix, ...new Array(32).fill(0x65)]), { name: "Ed25519" }, false, ["sign"]);
    const signer = await signerFromCryptoKey(key, (await signerFromSecret(SESSION_SECRET)).publicKey);
    const options = { credential: "02", ttlSeconds: 300, now: () => NOW };
    const request = { method: "GET", path: "/admin-api/namespaces" };

    await expect(createProofSigner({ ...options, signer })(request)).resolves.toBe(
      await createProofSigner({ ...options, signerSecret: SESSION_SECRET })(request),
    );
  });
});
