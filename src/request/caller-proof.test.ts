import { describe, expect, it } from "vitest";

import { callerProof } from "./caller-proof.js";

/**
 * Bytes produced by core, not by this file.
 *
 * Generated from `calimero-server`'s own `proof_auth.rs` test fixtures — the
 * `chain_for(1, key(7))` chain — by borsh-serializing each field and the whole
 * `CallerProof`, then hex-encoding. To regenerate, print these four values from
 * that module:
 *
 * ```rust
 * let (proof, _) = chain_for(1, &key(7));
 * hex::encode(borsh::to_vec(&proof.account_proof).unwrap());
 * hex::encode(borsh::to_vec(proof.session.as_ref().unwrap()).unwrap());
 * hex::encode(borsh::to_vec(&proof.request).unwrap());
 * hex::encode(borsh::to_vec(&proof).unwrap());
 * ```
 *
 * A test that built the expectation from this file's own concatenation would
 * agree with itself no matter what the node expects, which is the one thing
 * worth ruling out: the header only has to match Rust.
 */
const CREDENTIAL = "028a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c0000000004cfa21629a77f8cd8ddd3f821ed514009a9f572b2ce8e0a11f5cbb5e25340b09aeef190d5865e90861a94ec2e0b28de56ff7412f13806ff78322eb2d7a7d71d17cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080ce09090909090909090909090909090909090909090909090909090909090909090000000000000000ffb06b89ad31e732ed1bbec65b9d9c0ba1aead6faa37850432387b56dd69278670f6bb57b945ebe1a83997761ede1faed02bd0e37c7a7f3fbbdf934c14bbbb0e";
const SESSION = "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c027777777777777777777777777777777777777777777777777777777777777777d62f016a1efd1e4fdf793eb42cd84471e1ba9f0cf04d1287b5cc71f616287cb817cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080ce00f153650000000010ff53650000000056554af3cbf04380c22898aa2b15397f526d9dec50ab792b76fd45ca01668488be57b317015d9e4aada80a8dda0367f7390071051e2b3855c5e7eeaf0119520c";
const REQUEST = "03000000474554150000002f61646d696e2d6170692f6e616d65737061636573ea5bb92ca52d40a333e56e353225c6a569e2afbcb7a9152aa9727bed602872f900f15365000000002cf2536500000000299cd5a4a5566805c03ff461f68b9609d09ca0c82185fe488b6816a8cc1544e1e863d1a7b62274c7c0a4b30de72ad92e74ad1ebd9350976c6b3961430dfd2e02";
const FULL_WITH_SESSION = "028a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c0000000004cfa21629a77f8cd8ddd3f821ed514009a9f572b2ce8e0a11f5cbb5e25340b09aeef190d5865e90861a94ec2e0b28de56ff7412f13806ff78322eb2d7a7d71d17cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080ce09090909090909090909090909090909090909090909090909090909090909090000000000000000ffb06b89ad31e732ed1bbec65b9d9c0ba1aead6faa37850432387b56dd69278670f6bb57b945ebe1a83997761ede1faed02bd0e37c7a7f3fbbdf934c14bbbb0e01ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c027777777777777777777777777777777777777777777777777777777777777777d62f016a1efd1e4fdf793eb42cd84471e1ba9f0cf04d1287b5cc71f616287cb817cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080ce00f153650000000010ff53650000000056554af3cbf04380c22898aa2b15397f526d9dec50ab792b76fd45ca01668488be57b317015d9e4aada80a8dda0367f7390071051e2b3855c5e7eeaf0119520c03000000474554150000002f61646d696e2d6170692f6e616d65737061636573ea5bb92ca52d40a333e56e353225c6a569e2afbcb7a9152aa9727bed602872f900f15365000000002cf2536500000000299cd5a4a5566805c03ff461f68b9609d09ca0c82185fe488b6816a8cc1544e1e863d1a7b62274c7c0a4b30de72ad92e74ad1ebd9350976c6b3961430dfd2e02";
const FULL_WITHOUT_SESSION = "028a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c0000000004cfa21629a77f8cd8ddd3f821ed514009a9f572b2ce8e0a11f5cbb5e25340b09aeef190d5865e90861a94ec2e0b28de56ff7412f13806ff78322eb2d7a7d71d17cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080ce09090909090909090909090909090909090909090909090909090909090909090000000000000000ffb06b89ad31e732ed1bbec65b9d9c0ba1aead6faa37850432387b56dd69278670f6bb57b945ebe1a83997761ede1faed02bd0e37c7a7f3fbbdf934c14bbbb0e0003000000474554150000002f61646d696e2d6170692f6e616d65737061636573ea5bb92ca52d40a333e56e353225c6a569e2afbcb7a9152aa9727bed602872f900f15365000000002cf2536500000000299cd5a4a5566805c03ff461f68b9609d09ca0c82185fe488b6816a8cc1544e1e863d1a7b62274c7c0a4b30de72ad92e74ad1ebd9350976c6b3961430dfd2e02";

describe("callerProof", () => {
  it("matches the bytes core produces for a three-link chain", () => {
    expect(
      callerProof({ credential: CREDENTIAL, session: SESSION, request: REQUEST }),
    ).toBe(FULL_WITH_SESSION);
  });

  it("matches the bytes core produces for a two-link chain", () => {
    // No session: the device key signed the request itself. Borsh writes the
    // absent Option as a single 0 byte, so this is not the three-link value
    // minus a field — it is a different encoding, and the node parses the tag
    // before anything else.
    expect(callerProof({ credential: CREDENTIAL, request: REQUEST })).toBe(
      FULL_WITHOUT_SESSION,
    );
  });

  it("does not treat an omitted session as an empty one", () => {
    const omitted = callerProof({ credential: CREDENTIAL, request: REQUEST });
    const empty = callerProof({
      credential: CREDENTIAL,
      session: "",
      request: REQUEST,
    });
    expect(omitted).not.toBe(empty);
    // The tag is what differs, and it is the first byte after the credential.
    expect(omitted.slice(CREDENTIAL.length, CREDENTIAL.length + 2)).toBe("00");
    expect(empty.slice(CREDENTIAL.length, CREDENTIAL.length + 2)).toBe("01");
  });

  it("refuses input that is not hex rather than signing something else", () => {
    expect(() =>
      callerProof({ credential: "nothex", request: REQUEST }),
    ).toThrow(/credential/);
    expect(() =>
      callerProof({ credential: CREDENTIAL, request: "abc" }),
    ).toThrow(/request signature/);
  });
});
