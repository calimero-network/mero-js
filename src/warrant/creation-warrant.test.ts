/**
 * Conformance against core's pinned creation-warrant vectors.
 *
 * These constants are the ones `crates/account/src/tests/creation_wire_fixture.rs`
 * asserts, with the same fixed inputs. If core's format moves, that test fails
 * on core's side and this one fails here.
 *
 * The device secret is 32 bytes of 0x07, matching `key(7)` in core's test
 * helpers. It owns nothing.
 */
import { describe, expect, it } from 'vitest';

import {
  creationInitHash,
  creationWarrantPreimage,
  parseCreationWarrant as parse,
  signCreationWarrant,
  type CreationWarrantInput,
} from './creation-warrant.js';
import { fromHex } from '../crypto/internal.js';
import { signerFromCryptoKey, signerFromSecret, type Signer } from '../signer/signer.js';

const DEVICE_SECRET = '07'.repeat(32);

/** Ed25519 PKCS#8 prefix, so the raw seed can be imported as a non-extractable key. */
const PKCS8_ED25519_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04,
  0x22, 0x04, 0x20,
]);
const GROUP = '11'.repeat(32);
const SEED = '12'.repeat(32);
const AUTHOR_ACCOUNT = '22'.repeat(32);
const EXECUTOR = '33'.repeat(32);
const APPLICATION_ID = '44'.repeat(32);
const ACCOUNT_HEAD = '55'.repeat(32);
const GOVERNANCE_HEAD = '66'.repeat(32);
/** Serializes to exactly `{"name":"general"}`, the bytes core's fixture hashes. */
const INIT_ARGS = { name: 'general' };

const EXPECTED_INIT_HASH =
  '074dc4be8c7abe685532a48947430edd0301b42f60222e715a834e723d2a055e';
const EXPECTED_PREIMAGE =
  'f838cd94995573a7fea9768a82b6207632c4a89ce37c860e0d05febf5609644f';
const EXPECTED_DEVICE_KEY =
  'ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c';
const EXPECTED_SIGNATURE =
  '7e47c0655b1b0ef65a420ef301f6888328579abc153b122d9e7f6396c8757aa5' +
  '14d8a4e65ff85912dfb20f6858fcdbfc60818214ca2e6adcbfbf4dae3d9fd906';
/** core's 389-byte wire encoding, field by field. */
const EXPECTED_WIRE = [
  GROUP,
  SEED,
  AUTHOR_ACCOUNT,
  EXPECTED_DEVICE_KEY,
  EXECUTOR,
  APPLICATION_ID,
  '00', // service_name: None
  '01' + '07000000' + '67656e6572616c', // name: Some("general")
  EXPECTED_INIT_HASH,
  '01000000' + ACCOUNT_HEAD,
  '01000000' + GOVERNANCE_HEAD,
  '2a00000000000000', // nonce 42
  '00f1536500000000', // not_after 1_700_000_000
  EXPECTED_SIGNATURE,
].join('');

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const FIXTURE: CreationWarrantInput = {
  group: GROUP,
  seed: SEED,
  authorAccount: AUTHOR_ACCOUNT,
  executor: EXECUTOR,
  applicationId: APPLICATION_ID,
  name: 'general',
  initArgs: INIT_ARGS,
  accountHeads: [ACCOUNT_HEAD],
  governanceFloor: [GOVERNANCE_HEAD],
  nonce: 42,
  notAfter: 1_700_000_000,
  deviceSecret: DEVICE_SECRET,
};

describe('creation warrant conformance', () => {
  it('computes the init hash core computes', async () => {
    expect(JSON.stringify(INIT_ARGS)).toBe('{"name":"general"}');
    expect(hex(await creationInitHash(INIT_ARGS))).toBe(EXPECTED_INIT_HASH);
  });

  it('computes the signing preimage core computes', async () => {
    const preimage = await creationWarrantPreimage({
      group: fromHex(GROUP, 'group', 32),
      seed: fromHex(SEED, 'seed', 32),
      authorAccount: fromHex(AUTHOR_ACCOUNT, 'authorAccount', 32),
      deviceKey: fromHex(EXPECTED_DEVICE_KEY, 'deviceKey', 32),
      executor: fromHex(EXECUTOR, 'executor', 32),
      applicationId: fromHex(APPLICATION_ID, 'applicationId', 32),
      serviceName: null,
      name: new TextEncoder().encode('general'),
      initHash: fromHex(EXPECTED_INIT_HASH, 'initHash', 32),
      accountHeads: [fromHex(ACCOUNT_HEAD, 'head', 32)],
      governanceFloor: [fromHex(GOVERNANCE_HEAD, 'head', 32)],
      nonce: 42,
      notAfter: 1_700_000_000,
    });
    expect(hex(preimage)).toBe(EXPECTED_PREIMAGE);
  });

  it('produces the exact 389 bytes core produces', async () => {
    const { warrant, seed } = await signCreationWarrant(FIXTURE);

    expect(seed).toBe(SEED);
    expect(warrant.length).toBe(389 * 2);
    expect(warrant).toBe(EXPECTED_WIRE);
  });

  it('signs the preimage with the derived device key', async () => {
    const { warrant } = await signCreationWarrant(FIXTURE);
    const fields = parse(warrant);
    const key = await crypto.subtle.importKey(
      'raw',
      fromHex(fields.deviceKey, 'deviceKey', 32),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      fromHex(fields.signature, 'signature', 64),
      fromHex(EXPECTED_PREIMAGE, 'preimage', 32),
    );
    expect(ok).toBe(true);
  });
});

describe('parseCreationWarrant', () => {
  it('round-trips every field', async () => {
    const { warrant } = await signCreationWarrant({ ...FIXTURE, serviceName: 'chat' });
    expect(parse(warrant)).toEqual({
      group: GROUP,
      seed: SEED,
      authorAccount: AUTHOR_ACCOUNT,
      deviceKey: EXPECTED_DEVICE_KEY,
      executor: EXECUTOR,
      applicationId: APPLICATION_ID,
      serviceName: 'chat',
      name: 'general',
      initHash: EXPECTED_INIT_HASH,
      accountHeads: [ACCOUNT_HEAD],
      governanceFloor: [GOVERNANCE_HEAD],
      nonce: 42n,
      notAfter: 1_700_000_000n,
      signature: parse(warrant).signature,
    });
  });

  it('decodes the golden wire bytes', () => {
    const fields = parse(EXPECTED_WIRE);
    expect(fields.serviceName).toBeNull();
    expect(fields.name).toBe('general');
    expect(fields.signature).toBe(EXPECTED_SIGNATURE);
  });

  it('refuses truncated and trailing bytes', () => {
    expect(() => parse(EXPECTED_WIRE.slice(0, -2))).toThrow(/ends inside signature/);
    expect(() => parse(EXPECTED_WIRE + '00')).toThrow(/390 bytes but its fields account for 389/);
  });

  it('refuses a bad option tag', () => {
    const tampered = EXPECTED_WIRE.slice(0, 192 * 2) + '02' + EXPECTED_WIRE.slice(193 * 2);
    expect(() => parse(tampered)).toThrow(/serviceName has option tag 2/);
  });
});

describe('what the signature covers', () => {
  const signatureOf = async (input: CreationWarrantInput) =>
    parse((await signCreationWarrant(input)).warrant).signature;

  it.each<[string, Partial<CreationWarrantInput>]>([
    ['group', { group: 'a1'.repeat(32) }],
    ['seed', { seed: 'a2'.repeat(32) }],
    ['authorAccount', { authorAccount: 'a3'.repeat(32) }],
    ['executor', { executor: 'a4'.repeat(32) }],
    ['applicationId', { applicationId: 'a5'.repeat(32) }],
    ['serviceName', { serviceName: 'chat' }],
    ['name', { name: 'other' }],
    ['initArgs', { initArgs: { name: 'other' } }],
    ['accountHeads', { accountHeads: [] }],
    ['governanceFloor', { governanceFloor: [] }],
    ['nonce', { nonce: 43 }],
    ['notAfter', { notAfter: 1_700_000_001 }],
    ['deviceSecret', { deviceSecret: '08'.repeat(32) }],
  ])('%s', async (_field, change) => {
    expect(await signatureOf({ ...FIXTURE, ...change })).not.toBe(
      await signatureOf(FIXTURE),
    );
  });

  it('distinguishes which list a head was cited in', async () => {
    const asAccount = await signatureOf({
      ...FIXTURE,
      accountHeads: [ACCOUNT_HEAD, GOVERNANCE_HEAD],
      governanceFloor: [],
    });
    expect(asAccount).not.toBe(await signatureOf(FIXTURE));
  });

  it('keeps an absent label distinct from an empty one', async () => {
    const absent = await signCreationWarrant({ ...FIXTURE, name: undefined });
    const empty = await signCreationWarrant({ ...FIXTURE, name: '' });

    expect(parse(absent.warrant).name).toBeNull();
    expect(parse(empty.warrant).name).toBe('');
    expect(parse(absent.warrant).signature).not.toBe(parse(empty.warrant).signature);
    // 0x00 vs 0x01 + u32 zero length on the wire.
    expect(empty.warrant.length - absent.warrant.length).toBe(4 * 2);
  });
});

describe('limits and inputs', () => {
  it('refuses more than 64 heads in either list', async () => {
    const many = Array.from({ length: 65 }, () => ACCOUNT_HEAD);
    await expect(
      signCreationWarrant({ ...FIXTURE, accountHeads: many }),
    ).rejects.toThrow(/accountHeads cites 65 heads, over the 64/);
    await expect(
      signCreationWarrant({ ...FIXTURE, governanceFloor: many }),
    ).rejects.toThrow(/governanceFloor cites 65 heads, over the 64/);
  });

  it('accepts exactly 64 heads', async () => {
    const { warrant } = await signCreationWarrant({
      ...FIXTURE,
      accountHeads: Array.from({ length: 64 }, () => ACCOUNT_HEAD),
    });
    expect(parse(warrant).accountHeads).toHaveLength(64);
  });

  it('caps labels at 256 UTF-8 bytes, not characters', async () => {
    await expect(
      signCreationWarrant({ ...FIXTURE, name: 'x'.repeat(256) }),
    ).resolves.toBeDefined();
    await expect(
      signCreationWarrant({ ...FIXTURE, name: 'x'.repeat(257) }),
    ).rejects.toThrow(/name is 257 UTF-8 bytes, over the 256/);
    // 129 two-byte characters: 129 characters, 258 bytes.
    await expect(
      signCreationWarrant({ ...FIXTURE, serviceName: 'é'.repeat(129) }),
    ).rejects.toThrow(/serviceName is 258 UTF-8 bytes/);
  });

  it('refuses malformed ids', async () => {
    await expect(
      signCreationWarrant({ ...FIXTURE, group: '11'.repeat(31) }),
    ).rejects.toThrow(/group must be 64 hex/);
    await expect(
      signCreationWarrant({ ...FIXTURE, applicationId: 'zz'.repeat(32) }),
    ).rejects.toThrow(/applicationId must be 64 hex/);
    await expect(
      signCreationWarrant({ ...FIXTURE, seed: '12' }),
    ).rejects.toThrow(/seed must be 64 hex/);
  });

  it('draws a fresh random seed when none is given, and returns it', async () => {
    const { seed: _omit, ...noSeed } = FIXTURE;
    const first = await signCreationWarrant(noSeed);
    const second = await signCreationWarrant(noSeed);

    expect(first.seed).toMatch(/^[0-9a-f]{64}$/);
    expect(first.seed).not.toBe(second.seed);
    expect(parse(first.warrant).seed).toBe(first.seed);
    expect(parse(second.warrant).seed).toBe(second.seed);
  });

  it('defaults the head lists to empty', async () => {
    const { warrant } = await signCreationWarrant({
      ...FIXTURE,
      accountHeads: undefined,
      governanceFloor: undefined,
    });
    expect(parse(warrant).accountHeads).toEqual([]);
    expect(parse(warrant).governanceFloor).toEqual([]);
  });
});

const wireOf = (signed: { warrant: string }) => signed.warrant;

describe('signing through a Signer', () => {
  /** The same seed as `DEVICE_SECRET`, as a key that can sign and never be exported. */
  async function unexportable(): Promise<CryptoKey> {
    const pkcs8 = new Uint8Array(PKCS8_ED25519_PREFIX.length + 32);
    pkcs8.set(PKCS8_ED25519_PREFIX, 0);
    pkcs8.set(fromHex(DEVICE_SECRET, 'seed', 32), PKCS8_ED25519_PREFIX.length);
    return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
  }

  it('yields core\'s exact bytes from a non-extractable CryptoKey', async () => {
    const key = await unexportable();
    expect(key.extractable).toBe(false);
    const signer = await signerFromCryptoKey(key, EXPECTED_DEVICE_KEY);
    const { deviceSecret: _unused, ...terms } = FIXTURE;
    expect(wireOf(await signCreationWarrant({ ...terms, signer }))).toBe(EXPECTED_WIRE);
  });

  it('yields core\'s exact bytes from a hand-rolled async signer, signing the preimage as is', async () => {
    // Stands in for a passkey, hardware or remote signer: nothing but a public
    // key and an async sign call that may resolve later.
    const key = await unexportable();
    const seen: Uint8Array[] = [];
    const signer: Signer = {
      publicKey: EXPECTED_DEVICE_KEY,
      async sign(message) {
        seen.push(message);
        await new Promise((resolve) => setTimeout(resolve, 1));
        return new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, message));
      },
    };
    const { deviceSecret: _unused, ...terms } = FIXTURE;
    const viaSigner = wireOf(await signCreationWarrant({ ...terms, signer }));
    const viaSecret = wireOf(await signCreationWarrant(FIXTURE));
    expect(viaSigner).toBe(viaSecret);
    expect(viaSigner).toBe(EXPECTED_WIRE);
    expect(seen.map(hex)).toEqual([EXPECTED_PREIMAGE]);
  });

  it('refuses both a secret and a signer, and neither', async () => {
    const signer = await signerFromSecret(DEVICE_SECRET);
    await expect(signCreationWarrant({ ...FIXTURE, signer })).rejects.toThrow(/not both/);
    const { deviceSecret: _unused, ...terms } = FIXTURE;
    await expect(signCreationWarrant(terms as CreationWarrantInput)).rejects.toThrow(
      /deviceSecret or signer is required/,
    );
  });

  it('refuses a signer whose output is not a 64-byte signature', async () => {
    const signer: Signer = {
      publicKey: EXPECTED_DEVICE_KEY,
      sign: async () => new Uint8Array(63),
    };
    const { deviceSecret: _unused, ...terms } = FIXTURE;
    await expect(signCreationWarrant({ ...terms, signer })).rejects.toThrow(/signer returned 63 bytes/);
  });
});
