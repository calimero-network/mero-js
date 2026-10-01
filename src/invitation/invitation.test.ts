/**
 * Vectors produced by core's own code — `borsh::to_vec(&GroupInvitationFromAdmin)`,
 * `Sha256::digest` over it, `PrivateKey::sign`, and `serde_json` for the JSON
 * shape — from a scratch program run against core. Ed25519 is deterministic, so
 * the signature is pinned too.
 */
import { describe, it, expect } from 'vitest';

import type { GroupMember } from '../admin-api/admin-types.js';
import {
  defaultAdmitters,
  encodeGroupInvitation,
  groupInvitationHash,
  MAX_INVITATION_VALIDITY_SECS,
  signGroupInvitation,
} from './invitation.js';
import { encodeSignedInvitation } from '../namespace-op/namespace-op.js';
import { signerFromSecret } from '../signer/signer.js';
import { hex } from '../crypto/internal.js';

const DEVICE_SECRET = '6d'.repeat(32);
const DEVICE_PK = '8b237d788e8eaaef550c6d125823fa45f1fd5fc29b2c88bdf871119471fc1312';
const GROUP = '42'.repeat(32);
const NOW = 1_790_000_000;
const ADMITTERS = ['0a'.repeat(32), '0b'.repeat(32)];
const INVITER_ACCOUNT = 'cc'.repeat(32);

const CORE_JSON = {"inviter_identity":[139,35,125,120,142,142,170,239,85,12,109,18,88,35,250,69,241,253,95,194,155,44,136,189,248,113,17,148,113,252,19,18],"group_id":[66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66,66],"expiration_timestamp":1790086400,"secret_salt":[7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7],"invited_role":1,"admitters":["0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a","0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b"]};
const CORE_BORSH =
  '8b237d788e8eaaef550c6d125823fa45f1fd5fc29b2c88bdf871119471fc13124242424242424242424242424242424242424242424242424242424242424242008db26a00000000070707070707070707070707070707070707070707070707070707070707070701020000000a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b';
const CORE_HASH = '0739d4d206f6dc3359ea7510766139b908a5b58e4d53552c62da72cea5c4af72';
const CORE_SIG =
  'a9945492839aa130892dc8056fd1a4c882792a0c1426a68f6bd90fac7218ebb2086b505e2f9cbdeb4b7dd1c60199cd8d589a1c14a0c8721bbb1331a20f0a7309';

const input = {
  groupId: GROUP,
  inviterAccount: INVITER_ACCOUNT,
  deviceSecret: DEVICE_SECRET,
  admitters: ADMITTERS,
  now: NOW,
  nonce: new Uint8Array(32).fill(0x07),
};

describe('group invitation', () => {
  it('encodes and hashes the body core does', async () => {
    expect(hex(encodeGroupInvitation(CORE_JSON))).toBe(CORE_BORSH);
    expect(hex(await groupInvitationHash(CORE_JSON))).toBe(CORE_HASH);
  });

  it('signs what core signs, in the JSON shape core emits', async () => {
    const signed = await signGroupInvitation(input);
    expect(signed.invitation).toEqual(CORE_JSON);
    expect(signed.inviter_signature).toBe(CORE_SIG);
    expect(signed.inviter_account).toBe(INVITER_ACCOUNT);
    expect(hex(new Uint8Array(signed.invitation.inviter_identity))).toBe(DEVICE_PK);
  });

  it('signs the same bytes through a Signer', async () => {
    const signer = await signerFromSecret(DEVICE_SECRET, 'deviceSecret');
    const signed = await signGroupInvitation({ ...input, deviceSecret: undefined, signer });
    expect(signed.inviter_signature).toBe(CORE_SIG);
  });

  it('embeds in a join op through the same encoder', async () => {
    const signed = await signGroupInvitation(input);
    expect(hex(encodeSignedInvitation(signed)).startsWith(CORE_BORSH)).toBe(true);
  });

  it('defaults the admitters to the admins, sorted as core sorts them', async () => {
    const members: GroupMember[] = [
      { identity: '0B'.repeat(32), role: 'Admin' },
      { identity: '0f'.repeat(32), role: 'Member' },
      { identity: '0a'.repeat(32), role: 'Admin' },
      { identity: '0b'.repeat(32), role: 'Admin' },
    ];
    expect(defaultAdmitters(members)).toEqual(ADMITTERS);
    const signed = await signGroupInvitation({ ...input, admitters: undefined, members });
    expect(signed.inviter_signature).toBe(CORE_SIG);
  });

  it('never mints an invitation claimable by broadcast', async () => {
    await expect(signGroupInvitation({ ...input, admitters: [] })).rejects.toThrow(/broadcast/);
    await expect(
      signGroupInvitation({
        ...input,
        admitters: [],
        members: [{ identity: '0f'.repeat(32), role: 'Member' }],
      }),
    ).rejects.toThrow(/no admin/);
  });

  it('clamps validity to what a node would issue', async () => {
    const signed = await signGroupInvitation({ ...input, validForSecs: 10 * MAX_INVITATION_VALIDITY_SECS });
    expect(signed.invitation.expiration_timestamp).toBe(NOW + MAX_INVITATION_VALIDITY_SECS);
    const short = await signGroupInvitation({ ...input, validForSecs: 60 });
    expect(short.invitation.expiration_timestamp).toBe(NOW + 60);
  });

  it('carries the unsigned bootstrap fields outside the signature', async () => {
    const signed = await signGroupInvitation({
      ...input,
      applicationId: '33'.repeat(32),
      appKey: '44'.repeat(32),
      admitterAddrs: ['/ip4/127.0.0.1/tcp/2528/p2p/12D3KooW'],
    });
    expect(signed.inviter_signature).toBe(CORE_SIG);
    expect(signed.application_id).toEqual(new Array(32).fill(0x33));
    expect(signed.app_key).toEqual(new Array(32).fill(0x44));
  });
});
