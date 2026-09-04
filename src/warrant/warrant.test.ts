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
/** 32 bytes of 0x11 — the same bytes core's fixture uses, now spelled in hex. */
const CONTEXT = '11'.repeat(32);
/** The same bytes in base58, which this module no longer accepts anywhere. */
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
      context: CONTEXT,
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
      context: CONTEXT,
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
    context: CONTEXT,
    authorAccount: AUTHOR_ACCOUNT,
    executor: EXECUTOR,
    method: METHOD,
    argsJson: ARGS,
    nonce: 1,
    notAfter: 1,
    deviceSecret: DEVICE_SECRET,
  };

  // Every id on this interface is hex now, so there is one rule and base58 is
  // simply not it. This inverts two tests that pinned the opposite — that a hex
  // context was refused, once on the alphabet and once by a canonical
  // round-trip, because `context` was base58 while the accounts were hex.
  it('refuses a base58 context', async () => {
    await expect(
      signWarrant({ ...base, context: CONTEXT_B58 }),
    ).rejects.toThrow(/context must be 64 hex/);
  });

  it('accepts the hex that used to be refused as non-canonical base58', async () => {
    // This exact string was the dangerous case: hex digits are mostly base58
    // characters, so `'11'.repeat(32)` decoded to 32 zero bytes rather than
    // failing, and only a canonical round-trip caught it. With one alphabet
    // there is nothing to confuse it with — it is the context, and it signs.
    await expect(
      signWarrant({ ...base, context: '11'.repeat(32) }),
    ).resolves.toMatch(/^[0-9a-f]+$/);
  });

  it('refuses a base58 account', async () => {
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
    context: CONTEXT,
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
