/**
 * Conformance against core's pinned delegable-op vectors:
 * `delegable_governance_op_vectors_for_non_rust_encoders_are_stable`
 * (crates/governance-types/src/tests.rs, core#4272). Same inputs: account
 * [0x44;32], group [0x55;32], parent [0x11;32], context [0x66;32].
 */
import { describe, expect, it } from 'vitest';

import { governanceOpHash } from './governance-warrant.js';
import {
  contextCapabilityGrantedOp,
  contextCapabilityRevokedOp,
  contextDetachedOp,
  contextMetadataSetOp,
  defaultCapabilitiesSetOp,
  groupDeletedOp,
  groupMetadataSetOp,
  groupReparentedOp,
  memberCapabilitySetOp,
  memberJoinedOpenOp,
  memberLeftOp,
  memberMetadataSetOp,
  memberRemovedOp,
  memberRoleSetOp,
  subgroupVisibilitySetOp,
  type GovernanceOp,
} from './governance-op.js';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const A = '44'.repeat(32);
const G = '55'.repeat(32);
const P = '11'.repeat(32);
const C = '66'.repeat(32);
const DATA = { topic: 'rust' };
/** core's fixed-byte AccountProof<DeviceCert> fixture (layout only; does not verify). */
const CREDENTIAL =
  '02' + '77'.repeat(32) + '00000000' +
  '44'.repeat(32) + '88'.repeat(32) + '99'.repeat(32) + 'aa'.repeat(32) +
  '00000000' + '01000000' + 'bb'.repeat(64);

const cases: Array<[string, () => GovernanceOp, string, string]> = [
  ['MemberRemoved', () => memberRemovedOp(A),
    '024444444444444444444444444444444444444444444444444444444444444444000000000000000000000000000000000000000000000000000000000000000000000000',
    'fdc08345155864f7a9481194c7f12b313994b1a95955ee0969422f0147ab2779'],
  ['MemberLeft', () => memberLeftOp(A),
    '034444444444444444444444444444444444444444444444444444444444444444000000000000000000000000000000000000000000000000000000000000000000000000',
    '05392aaa36e0e7d08fc9150536d1c9906cd6f5445b0afb6cedec2f03938c6b3d'],
  ['MemberRoleSet Admin', () => memberRoleSetOp(A, 'Admin'),
    '04444444444444444444444444444444444444444444444444444444444444444400',
    '79a70a143fb990f2f92478812b0c142ec8e94a75769d415b3e3bbf769168b2bb'],
  ['MemberRoleSet ReadOnly', () => memberRoleSetOp(A, 'ReadOnly'),
    '04444444444444444444444444444444444444444444444444444444444444444402',
    '843978d9ed8c38856a33df18ed3ca9a1e60800b3c0985949ce0db831dd57c75d'],
  ['MemberCapabilitySet 0b1', () => memberCapabilitySetOp(A, 0b1),
    '05444444444444444444444444444444444444444444444444444444444444444401000000',
    '4266c138e10d5aa8837fcb1d1e7bb81b88c215d4ddea5f7ec413c7a87c995758'],
  ['MemberCapabilitySet 231', () => memberCapabilitySetOp(A, 231),
    '054444444444444444444444444444444444444444444444444444444444444444e7000000',
    '9225ce03739ea127393321b4b517b5badd05290131e865bd6bb2a5a34af57287'],
  ['DefaultCapabilitiesSet 231', () => defaultCapabilitiesSetOp(231),
    '06e7000000',
    '0bc00f5f7627b34a104b6aa059887c2cf30f59f468711462176f35592fcf95fd'],
  ['ContextDetached', () => contextDetachedOp(C),
    '096666666666666666666666666666666666666666666666666666666666666666',
    '363e49ed17f870151deed61caa14f493fad3f4e1d9c4781f35b21b833a4f2bf3'],
  ['SubgroupVisibilitySet Open', () => subgroupVisibilitySetOp('open'),
    '0a00', '99d379e4656d5711132d0d44491446ab93480b6ad58bc216aba9358bf693d57b'],
  ['SubgroupVisibilitySet Restricted', () => subgroupVisibilitySetOp('restricted'),
    '0a01', '42b90a291fb2b5e5d8a5da5a1096facde5d34c2d3ad92903507e1709434020a1'],
  ['GroupMetadataSet Some', () => groupMetadataSetOp({ name: 'general', data: DATA }),
    '0b010700000067656e6572616c0100000005000000746f7069630400000072757374',
    '2d789be70265d50780fc8cac9b1c3ff847352fccd2ad36e76ffdc464134d4bc9'],
  ['GroupMetadataSet None', () => groupMetadataSetOp(),
    '0b0000000000', '4fc9cfd6f2af5690ff47fc685c8ef1408c2c49f41aac2a2a8151223e5dfe2e1d'],
  ['MemberMetadataSet Some', () => memberMetadataSetOp(A, { name: 'alice', data: DATA }),
    '0c44444444444444444444444444444444444444444444444444444444444444440105000000616c6963650100000005000000746f7069630400000072757374',
    '58a5290db3c57d34bb40679071c4739eff0ff81e0e728ff98d707ed570c1eeab'],
  ['MemberMetadataSet None', () => memberMetadataSetOp(A),
    '0c44444444444444444444444444444444444444444444444444444444444444440000000000',
    'd682f73eacf1b2b04aa85e1abde1b37c5e16399a5f41b2d385581a0c401db32e'],
  ['ContextMetadataSet Some', () => contextMetadataSetOp(C, { name: 'general', data: DATA }),
    '0d6666666666666666666666666666666666666666666666666666666666666666010700000067656e6572616c0100000005000000746f7069630400000072757374',
    '81768a47949bec9245da34acbfc9d90ff8152e65df38026e99691f2d0f4e3f86'],
  ['ContextMetadataSet None', () => contextMetadataSetOp(C),
    '0d66666666666666666666666666666666666666666666666666666666666666660000000000',
    '4de9794df28cbcfb3fae1c960eaf4a8244b5f415a1a7506b963ec82c1bf1033d'],
  ['ContextCapabilityGranted 0b1', () => contextCapabilityGrantedOp(C, A, 0b1),
    '106666666666666666666666666666666666666666666666666666666666666666444444444444444444444444444444444444444444444444444444444444444401',
    'af5093cfd553f9431d4c2c6eacc8c5ac90c709d520122fa5420982d2594f0ff1'],
  ['ContextCapabilityRevoked 231', () => contextCapabilityRevokedOp(C, A, 231),
    '1166666666666666666666666666666666666666666666666666666666666666664444444444444444444444444444444444444444444444444444444444444444e7',
    '1ba014f559da55169bdcb663f3cd79b5b6519aecf7a09dc5976b9c28e3cd94fd'],
  ['GroupReparented', () => groupReparentedOp(G, P),
    '0155555555555555555555555555555555555555555555555555555555555555551111111111111111111111111111111111111111111111111111111111111111',
    'a52c81b6b15c534a10db72373a4213f0ea75c7b99dbea1c93d510169b804d427'],
  ['GroupDeleted', () => groupDeletedOp(G),
    '0255555555555555555555555555555555555555555555555555555555555555550000000000000000',
    'b2dd53fba1c8b83ef704de1fcc868cc68d4f74cd2a54cd1db4998213500fddd0'],
  ['MemberJoinedOpen', () => memberJoinedOpenOp({ member: A, groupId: G, credential: CREDENTIAL }),
    '07' + A + G + CREDENTIAL,
    'b9642890aae8b920d6bd9376e532423b6074becd9eb568843b2de025fd294192'],
];

describe("delegable governance ops match core's pinned vectors", () => {
  it.each(cases)('%s', async (_name, build, bytes, opHash) => {
    const op = build();
    expect(hex(op.bytes)).toBe(bytes);
    expect(hex(await governanceOpHash(op))).toBe(opHash);
  });
});

describe('guards', () => {
  it('refuses CAN_AUTHOR_ON_BEHALF in a member capability change', () => {
    expect(() => memberCapabilitySetOp(A, 512)).toThrow(/CAN_AUTHOR_ON_BEHALF/);
  });
  it('refuses a zero or oversized per-context capability', () => {
    expect(() => contextCapabilityGrantedOp(C, A, 0)).toThrow(/non-zero u8/);
    expect(() => contextCapabilityRevokedOp(C, A, 256)).toThrow(/non-zero u8/);
  });
  it('sorts metadata keys by their bytes, as a BTreeMap does', () => {
    const a = groupMetadataSetOp({ data: { b: '2', a: '1' } });
    const b = groupMetadataSetOp({ data: { a: '1', b: '2' } });
    expect(hex(a.bytes)).toBe(hex(b.bytes));
  });
});
