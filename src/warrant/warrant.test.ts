/**
 * Conformance against core's pinned vectors.
 *
 * These constants are not chosen here — they are the ones
 * `crates/account/src/tests/warrant_wire_fixture.rs` asserts, with the same fixed
 * inputs. If core's format moves, that test fails on core's side and this one
 * fails here; the pair is what turns a silent 403 at a relay into a red build.
 *
 * The device secret is 32 bytes of 0x07, matching `key(7)` in core's test
 * helpers. It owns nothing.
 */
import { describe, expect, it } from 'vitest';

import { intentHash, signWarrant } from './warrant.js';

const DEVICE_SECRET = '07'.repeat(32);
/** base58 of 32 bytes of 0x11 — core's fixture uses the raw bytes. */
const CONTEXT_B58 = '29d2S7vB453rNYFdR5Ycwt7y9haRT5fwVwL9zTmBhfV2';
const AUTHOR_ACCOUNT = '22'.repeat(32);
const EXECUTOR = '33'.repeat(32);
const METHOD = 'set';
const ARGS = { key: 'k', value: 'v' };

const EXPECTED_INTENT_HASH =
  'dc066cc8524c74dc21714174009df536376e3151f5b92f0a676defde599dbae5';
const EXPECTED_DEVICE_KEY =
  'ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c';
const EXPECTED_SIGNATURE =
  'a3ddd5294a755f875a275d61f79105115a2d4fb115339ee2483fc17c0ae96c6d' +
  'e21e02f26ea103cfe87bb2365ca858c27fb688a99cf1835ed473de226eb24709';

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

describe('warrant signing conformance', () => {
  it('computes the intent hash core computes', async () => {
    expect(hex(await intentHash(METHOD, ARGS))).toBe(EXPECTED_INTENT_HASH);
  });

  it('produces the exact 240 bytes core produces', async () => {
    const warrant = await signWarrant({
      context: CONTEXT_B58,
      authorAccount: AUTHOR_ACCOUNT,
      executor: EXECUTOR,
      method: METHOD,
      argsJson: ARGS,
      nonce: 42,
      notAfter: 1_700_000_000,
      deviceSecret: DEVICE_SECRET,
    });

    // Length first: every field is fixed-width, which is the property that lets
    // this module concatenate instead of carrying a borsh encoder. A different
    // length means that stopped being true.
    expect(warrant.length).toBe(480);

    // Field by field, so a failure names which one moved rather than printing
    // 480 characters of hex twice.
    expect(warrant.slice(0, 64)).toBe('11'.repeat(32));
    expect(warrant.slice(64, 128)).toBe(AUTHOR_ACCOUNT);
    expect(warrant.slice(128, 192)).toBe(EXPECTED_DEVICE_KEY);
    expect(warrant.slice(192, 256)).toBe(EXECUTOR);
    expect(warrant.slice(256, 320)).toBe(EXPECTED_INTENT_HASH);
    // u64 LITTLE-endian: 42 and 1_700_000_000.
    expect(warrant.slice(320, 336)).toBe('2a00000000000000');
    expect(warrant.slice(336, 352)).toBe('00f1536500000000');
    expect(warrant.slice(352)).toBe(EXPECTED_SIGNATURE);
  });

  it('derives the device key rather than trusting a caller', async () => {
    // A caller able to name a key it does not hold could produce a warrant it
    // cannot sign, and the field would stop meaning "who authorised this".
    const warrant = await signWarrant({
      context: CONTEXT_B58,
      authorAccount: AUTHOR_ACCOUNT,
      executor: EXECUTOR,
      method: METHOD,
      argsJson: ARGS,
      nonce: 42,
      notAfter: 1_700_000_000,
      deviceSecret: DEVICE_SECRET,
    });
    expect(warrant.slice(128, 192)).toBe(EXPECTED_DEVICE_KEY);
  });
});

describe('input encodings', () => {
  const base = {
    context: CONTEXT_B58,
    authorAccount: AUTHOR_ACCOUNT,
    executor: EXECUTOR,
    method: METHOD,
    argsJson: ARGS,
    nonce: 1,
    notAfter: 1,
    deviceSecret: DEVICE_SECRET,
  };

  // The ids do not share an encoding, and mixing them up yields a
  // valid-looking value that only fails against real data.
  // Two shapes, because they fail for different reasons and only one of them
  // fails on the alphabet.
  it('refuses a hex context containing non-base58 characters', async () => {
    // '0' is not in the base58 alphabet, so this is caught on sight.
    await expect(
      signWarrant({ ...base, context: '10'.repeat(32) }),
    ).rejects.toThrow(/not base58/);
  });

  it('refuses a hex context that happens to be valid base58', async () => {
    // The dangerous one. Hex digits are mostly base58 characters, so
    // `'11'.repeat(32)` DECODES — to 32 zero bytes — rather than failing. Only
    // the canonical round-trip catches it: those bytes encode as 32 '1's, not
    // 64, so the input was never a canonical id.
    await expect(
      signWarrant({ ...base, context: '11'.repeat(32) }),
    ).rejects.toThrow(/canonical base58/);
  });

  it('refuses a base58 account, which is the hex one', async () => {
    await expect(
      signWarrant({ ...base, authorAccount: CONTEXT_B58 }),
    ).rejects.toThrow(/authorAccount must be 64 hex/);
  });

  it('refuses a device secret of the wrong length', async () => {
    await expect(
      signWarrant({ ...base, deviceSecret: '07'.repeat(16) }),
    ).rejects.toThrow(/deviceSecret must be 64 hex/);
  });
});

describe('the intent it authorises', () => {
  const base = {
    context: CONTEXT_B58,
    authorAccount: AUTHOR_ACCOUNT,
    executor: EXECUTOR,
    nonce: 7,
    notAfter: 1_700_000_000,
    deviceSecret: DEVICE_SECRET,
  };

  /** The intent hash a node recomputes from what `performIntent` carries. */
  const commitmentOf = (warrant: string) => warrant.slice(256, 320);

  it('commits to the method, so a relay cannot substitute another', async () => {
    const set = await signWarrant({ ...base, method: 'set', argsJson: ARGS });
    const del = await signWarrant({ ...base, method: 'delete', argsJson: ARGS });

    expect(commitmentOf(set)).not.toBe(commitmentOf(del));
  });

  it('commits to the arguments, so a warrant is not a blank cheque', async () => {
    const mine = await signWarrant({ ...base, method: METHOD, argsJson: ARGS });
    const theirs = await signWarrant({
      ...base,
      method: METHOD,
      argsJson: { key: 'k', value: 'SOMETHING ELSE' },
    });

    expect(commitmentOf(mine)).not.toBe(commitmentOf(theirs));
  });

  it('matches what performIntent will send for the same intent', async () => {
    // The pairing that matters: `signWarrant` is given the same `method` and
    // `argsJson` a caller then passes to `performIntent`, and the node checks
    // the warrant covers exactly that. Computing the commitment from different
    // JSON than the request carries is the one way to build a warrant that
    // verifies as a signature and is refused as authorisation.
    const method = 'set';
    const argsJson = { key: 'k', value: 'v' };

    const warrant = await signWarrant({ ...base, method, argsJson });

    expect(commitmentOf(warrant)).toBe(hex(await intentHash(method, argsJson)));
  });

  it('a different nonce is a different warrant', async () => {
    // Single-use: the signature stays valid forever, so replay is stopped by the
    // nonce ledger rather than by the envelope check.
    const first = await signWarrant({ ...base, method: METHOD, argsJson: ARGS, nonce: 1 });
    const second = await signWarrant({ ...base, method: METHOD, argsJson: ARGS, nonce: 2 });

    expect(first).not.toBe(second);
    expect(first.slice(320, 336)).toBe('0100000000000000');
    expect(second.slice(320, 336)).toBe('0200000000000000');
  });
});
