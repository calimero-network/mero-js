import { describe, expect, it } from "vitest";

import { createProofSigner } from "./proof-signer.js";

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
      credential: "028a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c0000000004cfa21629a77f8cd8ddd3f821ed514009a9f572b2ce8e0a11f5cbb5e25340b09aeef190d5865e90861a94ec2e0b28de56ff7412f13806ff78322eb2d7a7d71d17cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080ce09090909090909090909090909090909090909090909090909090909090909090000000000000000ffb06b89ad31e732ed1bbec65b9d9c0ba1aead6faa37850432387b56dd69278670f6bb57b945ebe1a83997761ede1faed02bd0e37c7a7f3fbbdf934c14bbbb0e",
      session: "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c027777777777777777777777777777777777777777777777777777777777777777d62f016a1efd1e4fdf793eb42cd84471e1ba9f0cf04d1287b5cc71f616287cb817cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080ce00f153650000000010ff53650000000056554af3cbf04380c22898aa2b15397f526d9dec50ab792b76fd45ca01668488be57b317015d9e4aada80a8dda0367f7390071051e2b3855c5e7eeaf0119520c",
      signerSecret: SESSION_SECRET,
      ttlSeconds: 300,
      now: () => NOW,
    });

    await expect(
      sign({ method: "GET", path: "/admin-api/namespaces" }),
    ).resolves.toBe("028a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c0000000004cfa21629a77f8cd8ddd3f821ed514009a9f572b2ce8e0a11f5cbb5e25340b09aeef190d5865e90861a94ec2e0b28de56ff7412f13806ff78322eb2d7a7d71d17cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080ce09090909090909090909090909090909090909090909090909090909090909090000000000000000ffb06b89ad31e732ed1bbec65b9d9c0ba1aead6faa37850432387b56dd69278670f6bb57b945ebe1a83997761ede1faed02bd0e37c7a7f3fbbdf934c14bbbb0e01ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c027777777777777777777777777777777777777777777777777777777777777777d62f016a1efd1e4fdf793eb42cd84471e1ba9f0cf04d1287b5cc71f616287cb817cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080ce00f153650000000010ff53650000000056554af3cbf04380c22898aa2b15397f526d9dec50ab792b76fd45ca01668488be57b317015d9e4aada80a8dda0367f7390071051e2b3855c5e7eeaf0119520c03000000474554150000002f61646d696e2d6170692f6e616d65737061636573ea5bb92ca52d40a333e56e353225c6a569e2afbcb7a9152aa9727bed602872f900f15365000000002cf2536500000000299cd5a4a5566805c03ff461f68b9609d09ca0c82185fe488b6816a8cc1544e1e863d1a7b62274c7c0a4b30de72ad92e74ad1ebd9350976c6b3961430dfd2e02");
  });

  it("produces the two-link encoding when there is no session", async () => {
    const sign = createProofSigner({
      credential: "028a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c0000000004cfa21629a77f8cd8ddd3f821ed514009a9f572b2ce8e0a11f5cbb5e25340b09aeef190d5865e90861a94ec2e0b28de56ff7412f13806ff78322eb2d7a7d71d17cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080ce09090909090909090909090909090909090909090909090909090909090909090000000000000000ffb06b89ad31e732ed1bbec65b9d9c0ba1aead6faa37850432387b56dd69278670f6bb57b945ebe1a83997761ede1faed02bd0e37c7a7f3fbbdf934c14bbbb0e",
      signerSecret: SESSION_SECRET,
      ttlSeconds: 300,
      now: () => NOW,
    });

    // Same request, same key — only the absent session differs, and it changes
    // the bytes rather than shortening them.
    await expect(
      sign({ method: "GET", path: "/admin-api/namespaces" }),
    ).resolves.toBe("028a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c0000000004cfa21629a77f8cd8ddd3f821ed514009a9f572b2ce8e0a11f5cbb5e25340b09aeef190d5865e90861a94ec2e0b28de56ff7412f13806ff78322eb2d7a7d71d17cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080ce09090909090909090909090909090909090909090909090909090909090909090000000000000000ffb06b89ad31e732ed1bbec65b9d9c0ba1aead6faa37850432387b56dd69278670f6bb57b945ebe1a83997761ede1faed02bd0e37c7a7f3fbbdf934c14bbbb0e0003000000474554150000002f61646d696e2d6170692f6e616d65737061636573ea5bb92ca52d40a333e56e353225c6a569e2afbcb7a9152aa9727bed602872f900f15365000000002cf2536500000000299cd5a4a5566805c03ff461f68b9609d09ca0c82185fe488b6816a8cc1544e1e863d1a7b62274c7c0a4b30de72ad92e74ad1ebd9350976c6b3961430dfd2e02");
  });

  it("refuses a body it cannot commit to, naming the type", async () => {
    const sign = createProofSigner({
      credential: "028a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c0000000004cfa21629a77f8cd8ddd3f821ed514009a9f572b2ce8e0a11f5cbb5e25340b09aeef190d5865e90861a94ec2e0b28de56ff7412f13806ff78322eb2d7a7d71d17cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080ce09090909090909090909090909090909090909090909090909090909090909090000000000000000ffb06b89ad31e732ed1bbec65b9d9c0ba1aead6faa37850432387b56dd69278670f6bb57b945ebe1a83997761ede1faed02bd0e37c7a7f3fbbdf934c14bbbb0e",
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
      credential: "028a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c0000000004cfa21629a77f8cd8ddd3f821ed514009a9f572b2ce8e0a11f5cbb5e25340b09aeef190d5865e90861a94ec2e0b28de56ff7412f13806ff78322eb2d7a7d71d17cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080ce09090909090909090909090909090909090909090909090909090909090909090000000000000000ffb06b89ad31e732ed1bbec65b9d9c0ba1aead6faa37850432387b56dd69278670f6bb57b945ebe1a83997761ede1faed02bd0e37c7a7f3fbbdf934c14bbbb0e",
      signerSecret: SESSION_SECRET,
      now: () => NOW,
    });
    captured = await sign({ method: "GET", path: "/admin-api/namespaces" });

    // 120s default: the two encodings differ only in expires_at, so an
    // accidental change to the default shows up here rather than in production.
    const withExplicit = await createProofSigner({
      credential: "028a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c0000000004cfa21629a77f8cd8ddd3f821ed514009a9f572b2ce8e0a11f5cbb5e25340b09aeef190d5865e90861a94ec2e0b28de56ff7412f13806ff78322eb2d7a7d71d17cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080ce09090909090909090909090909090909090909090909090909090909090909090000000000000000ffb06b89ad31e732ed1bbec65b9d9c0ba1aead6faa37850432387b56dd69278670f6bb57b945ebe1a83997761ede1faed02bd0e37c7a7f3fbbdf934c14bbbb0e",
      signerSecret: SESSION_SECRET,
      ttlSeconds: 120,
      now: () => NOW,
    })({ method: "GET", path: "/admin-api/namespaces" });

    expect(captured).toBe(withExplicit);
  });
});
