/**
 * Owner-op proofs, pinned byte for byte to core.
 *
 * Every constant here is core's own output: `crates/account/src/tests/owner_op.rs`
 * (`signing_payload_and_encoding_are_pinned`) and
 * `crates/governance-types/src/tests.rs` (`root_guarded_vectors_are_stable`). A
 * wrong byte on this side is a proof the node refuses as "for another op" or
 * "does not verify", so these are compared exactly.
 */
import { describe, expect, it } from 'vitest';

import { hex } from '../crypto/internal.js';
import {
  adminChangedOp,
  groupDeleteOp,
  ownerOpDigest,
  ownerOpSigningPayload,
  rootGuardedOpBytes,
  signOwnerOpProof,
  teeAdmissionPolicyOp,
  teeAuthoringPolicyOp,
  teeReleaseAdmissionPolicyOp,
  transferOwnershipOp,
  type OwnerOp,
} from './owner-op.js';

/** core's test root: `PrivateKey::from([7; 32])`. */
const ROOT = '07'.repeat(32);
/** The account that root owns. */
const ACCOUNT = '9f9d3474c108b0bc7809ba35b5434980dd5b34f4a5042bdbb4de5519102324fb';
const NAMESPACE = '11'.repeat(32);
const GROUP = '22'.repeat(32);
const SOMEONE = '44'.repeat(32);

describe('owner-op proof (calimero_account::OwnerOpAuthorization)', () => {
  // core signs over arbitrary op bytes here, so the op is hand-built.
  const op: OwnerOp = {
    kind: 'transferOwnership',
    plane: 'group',
    bytes: new TextEncoder().encode('transfer to bob'),
  };

  it('digests the op under the owner-op body domain', async () => {
    expect(hex(await ownerOpDigest(op.bytes))).toBe(
      '350519af50455451fe2a1f181ec2f4c5363104f168055c6e9088c5a5b65384df',
    );
  });

  it('signs the payload core verifies', async () => {
    const payload = await ownerOpSigningPayload({
      account: ACCOUNT,
      namespaceId: NAMESPACE,
      groupId: GROUP,
      kind: op.kind,
      opDigest: await ownerOpDigest(op.bytes),
      counter: 3,
      keyEpoch: 0,
    });
    expect(hex(payload)).toBe(
      'a0855fcab12a8f8000345a0f25658f87d7650da170c50924be55fa780ca345a8',
    );
  });

  it('encodes the whole proof as core does', async () => {
    const proof = await signOwnerOpProof({
      rootSecret: ROOT,
      namespaceId: NAMESPACE,
      groupId: GROUP,
      op,
      counter: 3,
    });
    expect(proof).toBe(
    '02ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d2' +
    '2c000000009f9d3474c108b0bc7809ba35b5434980dd5b34f4a5042bdbb4de55' +
    '19102324fb111111111111111111111111111111111111111111111111111111' +
    '1111111111222222222222222222222222222222222222222222222222222222' +
    '222222222200350519af50455451fe2a1f181ec2f4c5363104f168055c6e9088' +
    'c5a5b65384df030000000000000000000000c62ebe7140bdffe975203603a4dc' +
    '27d4ced893a0e337698479885822deccf5ea97f1d4efdf071656a5ea50cc4446' +
    'abbb1a2f2a2e6720b8a1f2ac416bbf32020f',
    );
  });

  it('refuses a key epoch its chain cannot reach', async () => {
    await expect(
      signOwnerOpProof({
        rootSecret: ROOT,
        namespaceId: NAMESPACE,
        groupId: GROUP,
        op,
        counter: 0,
        keyEpoch: 1,
      }),
    ).rejects.toThrow(/needs 1 handoffs/);
  });
});

describe('owner-level op encoders (GroupOp / RootOp)', () => {
  it('encodes a transfer, and its RootGuarded wrapper, as core does', async () => {
    const transfer = transferOwnershipOp(SOMEONE);
    expect(hex(await ownerOpDigest(transfer.bytes))).toBe(
      'a8d53a53c6d1007d055fbfd972aa7a99b27d5a816defdf826d49d1b0799b2c8f',
    );
    const proof = await signOwnerOpProof({
      rootSecret: ROOT,
      namespaceId: NAMESPACE,
      groupId: GROUP,
      op: transfer,
      counter: 5,
    });
    expect(hex(rootGuardedOpBytes(transfer, proof))).toBe(
    '2a15444444444444444444444444444444444444444444444444444444444444' +
    '444402ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea6914' +
    '46d22c000000009f9d3474c108b0bc7809ba35b5434980dd5b34f4a5042bdbb4' +
    'de5519102324fb11111111111111111111111111111111111111111111111111' +
    '1111111111111122222222222222222222222222222222222222222222222222' +
    '2222222222222200a8d53a53c6d1007d055fbfd972aa7a99b27d5a816defdf82' +
    '6d49d1b0799b2c8f050000000000000000000000d9fefff69e034d07a996f2f0' +
    'dac5052865a93a780b58f935b3ff7a509ab88ed1f8171ee9c65b2b66a946ec53' +
    'd8aba76d53c4fd41553973d2fc87a05215f09502',
    );
  });

  it('encodes an admin change as a root op', async () => {
    const op = adminChangedOp(SOMEONE);
    expect(op.plane).toBe('root');
    expect(hex(await ownerOpDigest(op.bytes))).toBe(
      'bf73aaf8507327573528f38fdf5b003399a4773a7272539548188bc844d8a598',
    );
  });

  it('encodes the TEE policies and the deletion as core does', () => {
    expect(hex(teeAuthoringPolicyOp(['aa']).bytes)).toBe('2101000000020000006161');
    expect(
      hex(
        teeAdmissionPolicyOp({
          allowedMrtd: ['aa'],
          allowedRtmr0: [],
          allowedRtmr1: [],
          allowedRtmr2: [],
          allowedRtmr3: ['bb'],
          allowedTcbStatuses: ['UpToDate'],
          acceptMock: false,
          mode: 'relay',
        }).bytes,
      ),
    ).toBe(
    '2501000000020000006161000000000000000000000000010000000200000062' +
    '6201000000080000005570546f446174650001',
    );
    expect(
      hex(
        teeReleaseAdmissionPolicyOp({
          allowedProfiles: ['locked-read-only'],
          minReleaseVersion: '2.3.72',
          allowedTcbStatuses: [],
          acceptMock: true,
        }).bytes,
      ),
    ).toBe(
    '2601000000100000006c6f636b65642d726561642d6f6e6c790106000000322e' +
    '332e3732000000000100',
    );
    expect(hex(groupDeleteOp().bytes)).toBe('0e');
  });
});
