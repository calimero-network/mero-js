/**
 * Conformance against core's pinned governance-warrant and op vectors.
 *
 * The warrant constants are the ones
 * `crates/account/src/tests/governance_wire_fixture.rs` asserts, and the op
 * constants the ones `delegated_governance_op_vectors_are_stable` in
 * `crates/governance-types/src/tests.rs` asserts, with the same fixed inputs.
 * If core's format moves, those tests fail on core's side and these fail here.
 *
 * The device secret is 32 bytes of 0x07, matching `key(7)` in core's test
 * helpers. It owns nothing.
 */
import { describe, expect, it } from 'vitest';

import {
  governanceOpHash,
  governanceWarrantPreimage,
  parseGovernanceWarrant as parse,
  signGovernanceWarrant,
  type GovernanceWarrantInput,
} from './governance-warrant.js';
import {
  createdSubgroupId,
  groupCreatedOp,
  groupDeletedOp,
  groupReparentedOp,
  memberAddedOp,
  memberLeftOp,
  memberRemovedOp,
  memberRoleSetOp,
  subgroupCreation,
  type GovernanceOp,
} from './governance-op.js';
import { fromHex } from '../crypto/internal.js';
import { signerFromCryptoKey, signerFromSecret, type Signer } from '../signer/signer.js';

const DEVICE_SECRET = '07'.repeat(32);

/** Ed25519 PKCS#8 prefix, so the raw seed can be imported as a non-extractable key. */
const PKCS8_ED25519_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04,
  0x22, 0x04, 0x20,
]);
const SCOPE = '11'.repeat(32);
const AUTHOR_ACCOUNT = '22'.repeat(32);
const EXECUTOR = '33'.repeat(32);
const ACCOUNT_HEAD = '55'.repeat(32);
const GOVERNANCE_HEAD = '66'.repeat(32);
/** A stand-in for an op's bytes: the commitment treats them as opaque. */
const OP: GovernanceOp = { kind: 'root', bytes: new Uint8Array([1, 2, 3]) };

const EXPECTED_OP_HASH = 'd6bc121f9fcf7b85bea94d356d620c14dd8e1ae5fa2317cbcfc2c486cf04dfb3';
const EXPECTED_PREIMAGE = '23110c9012218d6996c33991173280928db4cc030a77164a31a2b1e47946bf80';
const EXPECTED_DEVICE_KEY = 'ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c';
const EXPECTED_SIGNATURE =
  '27a7c779c5d7aef80dcf7125c2ef733bb0f4bbe20d84a75d0b132516d3b2a1a0' +
  '0e292b674f927df135d6f631dc7768f2e40a0c1c1040f5fc923385d2b5b05e07';
/** core's 313-byte wire encoding, field by field. */
const EXPECTED_WIRE = [
  SCOPE,
  '01', // kind: Root
  AUTHOR_ACCOUNT,
  EXPECTED_DEVICE_KEY,
  EXECUTOR,
  EXPECTED_OP_HASH,
  '01000000' + ACCOUNT_HEAD,
  '01000000' + GOVERNANCE_HEAD,
  '2a00000000000000', // nonce 42
  '00f1536500000000', // not_after 1_700_000_000
  EXPECTED_SIGNATURE,
].join('');

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const FIXTURE: GovernanceWarrantInput = {
  scope: SCOPE,
  op: OP,
  authorAccount: AUTHOR_ACCOUNT,
  executor: EXECUTOR,
  accountHeads: [ACCOUNT_HEAD],
  governanceFloor: [GOVERNANCE_HEAD],
  nonce: 42,
  notAfter: 1_700_000_000,
  deviceSecret: DEVICE_SECRET,
};

describe('governance warrant conformance', () => {
  it('computes the op hash core computes', async () => {
    expect(hex(await governanceOpHash(OP))).toBe(EXPECTED_OP_HASH);
  });

  it('computes the signing preimage core computes', async () => {
    const preimage = await governanceWarrantPreimage({
      scope: fromHex(SCOPE, 'scope', 32),
      kind: 'root',
      authorAccount: fromHex(AUTHOR_ACCOUNT, 'authorAccount', 32),
      deviceKey: fromHex(EXPECTED_DEVICE_KEY, 'deviceKey', 32),
      executor: fromHex(EXECUTOR, 'executor', 32),
      opHash: fromHex(EXPECTED_OP_HASH, 'opHash', 32),
      accountHeads: [fromHex(ACCOUNT_HEAD, 'head', 32)],
      governanceFloor: [fromHex(GOVERNANCE_HEAD, 'head', 32)],
      nonce: 42,
      notAfter: 1_700_000_000,
    });
    expect(hex(preimage)).toBe(EXPECTED_PREIMAGE);
  });

  it('produces the exact 313 bytes core produces', async () => {
    const warrant = await signGovernanceWarrant(FIXTURE);
    expect(warrant.length).toBe(313 * 2);
    expect(warrant).toBe(EXPECTED_WIRE);
  });

  it('signs the preimage with the derived device key', async () => {
    const fields = parse(await signGovernanceWarrant(FIXTURE));
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

describe('governance op encoders', () => {
  const MEMBER = '44'.repeat(32);

  it('encodes MemberAdded as core does, and hashes it on the group plane', async () => {
    const op = memberAddedOp(MEMBER, 'Member');
    expect(op.kind).toBe('group');
    expect(hex(op.bytes)).toBe('01' + MEMBER + '01');
    expect(hex(await governanceOpHash(op))).toBe(
      'c48dce4ba9da20980a86832b133e7040ec67c293987c0f131140291a71041cd6',
    );
  });

  it('encodes MemberRemoved in its delegable form, hashes cleared', () => {
    expect(hex(memberRemovedOp(MEMBER).bytes)).toBe(
      '02' + MEMBER + '00'.repeat(32) + '00000000',
    );
  });

  it('encodes GroupCreated as core does, and hashes it on the root plane', async () => {
    const op = groupCreatedOp({
      groupId: '55'.repeat(32),
      parentId: '11'.repeat(32),
      restricted: true,
      admin: '22'.repeat(32),
      salt: '33'.repeat(32),
    });
    expect(op.kind).toBe('root');
    expect(hex(op.bytes)).toBe(
      '00' + '55'.repeat(32) + '11'.repeat(32) + '01' + '22'.repeat(32) + '33'.repeat(32),
    );
    expect(hex(await governanceOpHash(op))).toBe(
      '3a30eacf28687109de2b63b649cb0d8a532f344212066897547f52a416a1be0e',
    );
  });

  // Core's `created_subgroup_id_has_a_known_answer`.
  it('derives a subgroup id as core does', async () => {
    await expect(
      createdSubgroupId('11'.repeat(32), '33'.repeat(32), true, '22'.repeat(32)),
    ).resolves.toBe('6c949a0f0e0c3c55310223f4cd03f888b6e84c7e963f9171a5639fc54ea93b1a');
  });

  it('builds a subgroup creation whose id is the derived one', async () => {
    const created = await subgroupCreation({
      parentId: '11'.repeat(32),
      restricted: false,
      admin: '22'.repeat(32),
    });
    expect(created.salt).toMatch(/^[0-9a-f]{64}$/);
    expect(created.groupId).toBe(
      await createdSubgroupId('22'.repeat(32), '11'.repeat(32), false, created.salt),
    );
    expect(hex(created.op.bytes)).toBe(
      '00' + created.groupId + '11'.repeat(32) + '00' + '22'.repeat(32) + created.salt,
    );
  });

  // Not pinned by a core vector; the discriminants are the variants' positions
  // in core's `GroupOp` / `RootOp` / `GroupMemberRole`.
  it('encodes the remaining ops by their position in core\'s enums', () => {
    expect(hex(memberLeftOp(MEMBER).bytes)).toBe('03' + MEMBER + '00'.repeat(32) + '00000000');
    expect(hex(memberRoleSetOp(MEMBER, 'Admin').bytes)).toBe('04' + MEMBER + '00');
    expect(hex(memberRoleSetOp(MEMBER, 'ReadOnly').bytes)).toBe('04' + MEMBER + '02');
    expect(hex(groupReparentedOp('aa'.repeat(32), 'bb'.repeat(32)).bytes)).toBe(
      '01' + 'aa'.repeat(32) + 'bb'.repeat(32),
    );
    expect(hex(groupDeletedOp('aa'.repeat(32)).bytes)).toBe(
      '02' + 'aa'.repeat(32) + '00000000' + '00000000',
    );
    expect(groupReparentedOp('aa'.repeat(32), 'bb'.repeat(32)).kind).toBe('root');
    expect(groupDeletedOp('aa'.repeat(32)).kind).toBe('root');
  });

  it('refuses a malformed account and a TEE role', () => {
    expect(() => memberAddedOp('44'.repeat(31), 'Member')).toThrow(/member must be 64 hex/);
    expect(() => memberAddedOp(MEMBER, 'RelayTee' as never)).toThrow(/role must be/);
  });

  it('keeps the plane inside the commitment', async () => {
    const asGroup = await governanceOpHash({ kind: 'group', bytes: OP.bytes });
    expect(hex(asGroup)).not.toBe(EXPECTED_OP_HASH);
  });
});

describe('parseGovernanceWarrant', () => {
  it('round-trips every field', async () => {
    const warrant = await signGovernanceWarrant(FIXTURE);
    expect(parse(warrant)).toEqual({
      scope: SCOPE,
      kind: 'root',
      authorAccount: AUTHOR_ACCOUNT,
      deviceKey: EXPECTED_DEVICE_KEY,
      executor: EXECUTOR,
      opHash: EXPECTED_OP_HASH,
      accountHeads: [ACCOUNT_HEAD],
      governanceFloor: [GOVERNANCE_HEAD],
      nonce: 42n,
      notAfter: 1_700_000_000n,
      signature: EXPECTED_SIGNATURE,
    });
  });

  it('refuses truncated and trailing bytes', () => {
    expect(() => parse(EXPECTED_WIRE.slice(0, -2))).toThrow(/ends inside signature/);
    expect(() => parse(EXPECTED_WIRE + '00')).toThrow(/314 bytes but its fields account for 313/);
  });

  it('refuses an unknown kind', () => {
    const tampered = EXPECTED_WIRE.slice(0, 64) + '02' + EXPECTED_WIRE.slice(66);
    expect(() => parse(tampered)).toThrow(/kind 2/);
  });
});

describe('what the signature covers', () => {
  const signatureOf = async (input: GovernanceWarrantInput) =>
    parse(await signGovernanceWarrant(input)).signature;

  it.each<[string, Partial<GovernanceWarrantInput>]>([
    ['scope', { scope: 'a1'.repeat(32) }],
    ['op bytes', { op: { kind: 'root', bytes: new Uint8Array([1, 2, 4]) } }],
    ['op kind', { op: { kind: 'group', bytes: OP.bytes } }],
    ['authorAccount', { authorAccount: 'a3'.repeat(32) }],
    ['executor', { executor: 'a4'.repeat(32) }],
    ['accountHeads', { accountHeads: [] }],
    ['governanceFloor', { governanceFloor: [] }],
    ['nonce', { nonce: 43 }],
    ['notAfter', { notAfter: 1_700_000_001 }],
    ['deviceSecret', { deviceSecret: '08'.repeat(32) }],
  ])('%s', async (_field, change) => {
    expect(await signatureOf({ ...FIXTURE, ...change })).not.toBe(await signatureOf(FIXTURE));
  });

  it('distinguishes which list a head was cited in', async () => {
    const moved = await signatureOf({
      ...FIXTURE,
      accountHeads: [ACCOUNT_HEAD, GOVERNANCE_HEAD],
      governanceFloor: [],
    });
    expect(moved).not.toBe(await signatureOf(FIXTURE));
  });
});

describe('limits and inputs', () => {
  it('refuses more than 64 heads in either list', async () => {
    const many = Array.from({ length: 65 }, () => ACCOUNT_HEAD);
    await expect(signGovernanceWarrant({ ...FIXTURE, accountHeads: many })).rejects.toThrow(
      /accountHeads cites 65 heads, over the 64/,
    );
    await expect(signGovernanceWarrant({ ...FIXTURE, governanceFloor: many })).rejects.toThrow(
      /governanceFloor cites 65 heads, over the 64/,
    );
  });

  it('refuses a malformed scope and an unknown kind', async () => {
    await expect(signGovernanceWarrant({ ...FIXTURE, scope: '11' })).rejects.toThrow(
      /scope must be 64 hex/,
    );
    await expect(
      signGovernanceWarrant({ ...FIXTURE, op: { kind: 'other' as never, bytes: OP.bytes } }),
    ).rejects.toThrow(/op kind must be/);
  });

  it('defaults the head lists to empty', async () => {
    const warrant = await signGovernanceWarrant({
      ...FIXTURE,
      accountHeads: undefined,
      governanceFloor: undefined,
    });
    expect(parse(warrant).accountHeads).toEqual([]);
    expect(parse(warrant).governanceFloor).toEqual([]);
  });
});

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
    expect((await signGovernanceWarrant({ ...terms, signer }))).toBe(EXPECTED_WIRE);
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
    const viaSigner = (await signGovernanceWarrant({ ...terms, signer }));
    const viaSecret = (await signGovernanceWarrant(FIXTURE));
    expect(viaSigner).toBe(viaSecret);
    expect(viaSigner).toBe(EXPECTED_WIRE);
    expect(seen.map(hex)).toEqual([EXPECTED_PREIMAGE]);
  });

  it('refuses both a secret and a signer, and neither', async () => {
    const signer = await signerFromSecret(DEVICE_SECRET);
    await expect(signGovernanceWarrant({ ...FIXTURE, signer })).rejects.toThrow(/not both/);
    const { deviceSecret: _unused, ...terms } = FIXTURE;
    await expect(signGovernanceWarrant(terms as GovernanceWarrantInput)).rejects.toThrow(
      /deviceSecret or signer is required/,
    );
  });

  it('refuses a signer whose output is not a 64-byte signature', async () => {
    const signer: Signer = {
      publicKey: EXPECTED_DEVICE_KEY,
      sign: async () => new Uint8Array(63),
    };
    const { deviceSecret: _unused, ...terms } = FIXTURE;
    await expect(signGovernanceWarrant({ ...terms, signer })).rejects.toThrow(/signer returned 63 bytes/);
  });
});
