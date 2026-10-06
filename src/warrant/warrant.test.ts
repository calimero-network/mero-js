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

import { intentHash, parseWarrant as parse, signWarrant } from './warrant.js';
import { fromHex } from '../crypto/internal.js';

const DEVICE_SECRET = '07'.repeat(32);
/** 32 bytes of 0x11 — the same bytes core's fixture uses, now spelled in hex. */
const CONTEXT = '11'.repeat(32);
/** The same bytes in base58, which this module no longer accepts anywhere. */
const CONTEXT_B58 = '29d2S7vB453rNYFdR5Ycwt7y9haRT5fwVwL9zTmBhfV2';
const AUTHOR_ACCOUNT = '22'.repeat(32);
const EXECUTOR = '33'.repeat(32);
const EXECUTOR_KEY = '77'.repeat(32);
const METHOD = 'set';
const ARGS = { key: 'k', value: 'v' };

const EXPECTED_INTENT_HASH =
  'dc066cc8524c74dc21714174009df536376e3151f5b92f0a676defde599dbae5';
const EXPECTED_DEVICE_KEY =
  'ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c';
const RELEASE_BYTECODE_ID = '44'.repeat(32);
const RELEASE_VERSION = '1.0.0';
const ACCOUNT_HEAD = '55'.repeat(32);
const GOVERNANCE_HEAD = '66'.repeat(32);
const EXPECTED_PREIMAGE =
  'f38e2c9eb7e78025f8797bb34168fe48da95a20320fc62fc2da41e3efd30607c';
const EXPECTED_SIGNATURE =
  'e42f753e1a30657fe036b0c0a07030f3f6d92ea56749921c5a6ae07eb966cb50' +
  '1ed439f7a8007dfce0ccb6b5a8b94bdda9f48db9c84f181e9fbaa0d208726b02';
/** core's 392-byte wire encoding, field by field. */
const EXPECTED_WIRE = [
  CONTEXT,
  AUTHOR_ACCOUNT,
  EXPECTED_DEVICE_KEY,
  EXECUTOR,
  EXECUTOR_KEY,
  RELEASE_BYTECODE_ID,
  '05000000' + '312e302e30', // release_version: "1.0.0"
  '03000000' + '736574', // method: "set"
  EXPECTED_INTENT_HASH,
  '01000000' + ACCOUNT_HEAD,
  '01000000' + GOVERNANCE_HEAD,
  '2a00000000000000', // nonce 42
  '00f1536500000000', // not_after 1_700_000_000
  EXPECTED_SIGNATURE,
].join('');

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

describe('warrant signing conformance', () => {
  it('computes the intent hash core computes', async () => {
    expect(hex(await intentHash(METHOD, ARGS))).toBe(EXPECTED_INTENT_HASH);
  });

  it('produces the exact bytes core produces', async () => {
    const warrant = await signWarrant({
      context: CONTEXT,
      authorAccount: AUTHOR_ACCOUNT,
      executor: EXECUTOR,
      executorKey: EXECUTOR_KEY,
      releaseBytecodeId: RELEASE_BYTECODE_ID,
      releaseVersion: RELEASE_VERSION,
      method: METHOD,
      argsJson: ARGS,
      accountHeads: [ACCOUNT_HEAD],
      governanceFloor: [GOVERNANCE_HEAD],
      nonce: 42,
      notAfter: 1_700_000_000,
      deviceSecret: DEVICE_SECRET,
    });

    // 392 bytes for these inputs: no longer a constant of the format, since a
    // method of another length moves everything after it. Pinned anyway: it is
    // the cheapest signal that a field changed shape again.
    expect(warrant.length).toBe(784);
    expect(warrant).toBe(EXPECTED_WIRE);

    const fields = parse(warrant);
    expect(fields.context).toBe(CONTEXT);
    expect(fields.authorAccount).toBe(AUTHOR_ACCOUNT);
    expect(fields.deviceKey).toBe(EXPECTED_DEVICE_KEY);
    expect(fields.executor).toBe(EXECUTOR);
    expect(fields.executorKey).toBe(EXECUTOR_KEY);
    expect(fields.releaseBytecodeId).toBe(RELEASE_BYTECODE_ID);
    // u32 LE length 5, then "1.0.0" in ASCII.
    expect(fields.releaseVersion).toBe('312e302e30');
    // u32 LE length 3, then "set" in ASCII.
    expect(fields.method).toBe('736574');
    expect(fields.intentHash).toBe(EXPECTED_INTENT_HASH);
    expect(fields.accountHeads).toEqual([ACCOUNT_HEAD]);
    expect(fields.governanceFloor).toEqual([GOVERNANCE_HEAD]);
    // u64 LITTLE-endian: 42 and 1_700_000_000.
    expect(fields.nonce).toBe('2a00000000000000');
    expect(fields.notAfter).toBe('00f1536500000000');
    expect(fields.signature).toBe(EXPECTED_SIGNATURE);
  });

  it("signs core's preimage with the derived device key", async () => {
    const key = await crypto.subtle.importKey(
      'raw',
      fromHex(EXPECTED_DEVICE_KEY, 'deviceKey', 32),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      fromHex(EXPECTED_SIGNATURE, 'signature', 64),
      fromHex(EXPECTED_PREIMAGE, 'preimage', 32),
    );
    expect(ok).toBe(true);
  });

  /**
   * The counts are the reason `signWarrant` cannot just concatenate the two
   * lists. `domainHash` length-prefixes every part it is handed, so each head is
   * unambiguous on its own — but the lists are adjacent, so without a count in
   * front of each, moving a head from one to the other would hash the same and a
   * relay could relabel which plane it was cited from.
   */
  it('distinguishes which list a head was cited in', async () => {
    const base = {
      context: CONTEXT,
      authorAccount: AUTHOR_ACCOUNT,
      executor: EXECUTOR,
      executorKey: EXECUTOR_KEY,
      releaseBytecodeId: RELEASE_BYTECODE_ID,
      method: METHOD,
      argsJson: ARGS,
      nonce: 1,
      notAfter: 1,
      deviceSecret: DEVICE_SECRET,
    };

    const asAccount = await signWarrant({
      ...base,
      accountHeads: [ACCOUNT_HEAD, GOVERNANCE_HEAD],
      governanceFloor: [],
    });
    const split = await signWarrant({
      ...base,
      accountHeads: [ACCOUNT_HEAD],
      governanceFloor: [GOVERNANCE_HEAD],
    });

    expect(parse(asAccount).signature).not.toBe(parse(split).signature);
  });

  it('refuses more cited heads than a node will accept', async () => {
    await expect(
      signWarrant({
        context: CONTEXT,
        authorAccount: AUTHOR_ACCOUNT,
        executor: EXECUTOR,
        executorKey: EXECUTOR_KEY,
        releaseBytecodeId: RELEASE_BYTECODE_ID,
        method: METHOD,
        argsJson: ARGS,
        accountHeads: Array.from({ length: 65 }, () => ACCOUNT_HEAD),
        nonce: 1,
        notAfter: 1,
        deviceSecret: DEVICE_SECRET,
      }),
    ).rejects.toThrow(/65 heads, over the 64/);
  });

  /**
   * core's `MAX_WARRANT_RELEASE_VERSION_LEN`, counted in UTF-8 bytes: 129
   * two-byte characters are 258 bytes, so a count of characters would let it through.
   */
  it('refuses a release version over 256 bytes before signing', async () => {
    const terms = {
      context: CONTEXT,
      authorAccount: AUTHOR_ACCOUNT,
      executor: EXECUTOR,
      executorKey: EXECUTOR_KEY,
      releaseBytecodeId: RELEASE_BYTECODE_ID,
      method: METHOD,
      argsJson: ARGS,
      nonce: 1,
      notAfter: 1,
      deviceSecret: DEVICE_SECRET,
    };

    await expect(signWarrant({ ...terms, releaseVersion: 'x'.repeat(256) })).resolves.toMatch(
      /^[0-9a-f]+$/,
    );
    await expect(signWarrant({ ...terms, releaseVersion: '\u00e9'.repeat(129) })).rejects.toThrow(
      /releaseVersion is 258 bytes, over the 256 a node accepts/,
    );
  });

  it('refuses to decode a release version over 256 bytes', async () => {
    const at256 = await signWarrant({
      context: CONTEXT,
      authorAccount: AUTHOR_ACCOUNT,
      executor: EXECUTOR,
      executorKey: EXECUTOR_KEY,
      releaseBytecodeId: RELEASE_BYTECODE_ID,
      releaseVersion: 'x'.repeat(256),
      method: METHOD,
      argsJson: ARGS,
      nonce: 1,
      notAfter: 1,
      deviceSecret: DEVICE_SECRET,
    });
    // Same bytes with one more character and its length prefix bumped to 257,
    // so only the cap can refuse it.
    const lengthAt = 6 * 32 * 2;
    const at257 =
      at256.slice(0, lengthAt) + '01010000' + '78' + at256.slice(lengthAt + 8);

    expect(parse(at256).releaseVersion).toBe('78'.repeat(256));
    expect(() => parse(at257)).toThrow(/releaseVersion is 257 bytes, over the 256 a node accepts/);
  });

  it('derives the device key rather than trusting a caller', async () => {
    // A caller able to name a key it does not hold could produce a warrant it
    // cannot sign, and the field would stop meaning "who authorised this".
    const warrant = await signWarrant({
      context: CONTEXT,
      authorAccount: AUTHOR_ACCOUNT,
      executor: EXECUTOR,
      executorKey: EXECUTOR_KEY,
      releaseBytecodeId: RELEASE_BYTECODE_ID,
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
    executorKey: EXECUTOR_KEY,
    releaseBytecodeId: RELEASE_BYTECODE_ID,
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

  it('refuses an executor key that is not 32 bytes of hex', async () => {
    await expect(
      signWarrant({ ...base, executorKey: EXECUTOR_KEY.slice(2) }),
    ).rejects.toThrow(/executorKey must be 64 hex/);
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
    executorKey: EXECUTOR_KEY,
    releaseBytecodeId: RELEASE_BYTECODE_ID,
    nonce: 7,
    notAfter: 1_700_000_000,
    deviceSecret: DEVICE_SECRET,
  };

  /** The intent hash a node recomputes from what `performIntent` carries. */
  const commitmentOf = (warrant: string) => parse(warrant).intentHash;

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

  it('signs the executor key, so another device of the relay cannot spend it', async () => {
    const mine = await signWarrant({ ...base, method: METHOD, argsJson: ARGS });
    const other = await signWarrant({
      ...base,
      method: METHOD,
      argsJson: ARGS,
      executorKey: 'a4'.repeat(32),
    });

    expect(parse(mine).signature).not.toBe(parse(other).signature);
  });

  it('a different nonce is a different warrant', async () => {
    // Single-use: the signature stays valid forever, so replay is stopped by the
    // nonce ledger rather than by the envelope check.
    const first = await signWarrant({ ...base, method: METHOD, argsJson: ARGS, nonce: 1 });
    const second = await signWarrant({ ...base, method: METHOD, argsJson: ARGS, nonce: 2 });

    expect(first).not.toBe(second);
    expect(parse(first).nonce).toBe('0100000000000000');
    expect(parse(second).nonce).toBe('0200000000000000');
  });
});
