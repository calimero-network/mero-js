/**
 * Vectors produced by core's own code — `DeviceScope::signing_payload`,
 * `DeviceScope::sign` and `borsh::to_vec(&AccountProof<DeviceScope>)` — from a
 * scratch program run against core at the commit that added
 * `POST /admin-api/namespaces/{namespace_id}/account/link-device`, then
 * re-derived for the account-bound device id by an independent transcription
 * that first reproduced the earlier vectors. Ed25519 is deterministic, so the
 * whole proof, signature included, is pinned.
 */
import { describe, it, expect } from 'vitest';

import { accountForRoot, mintDeviceId } from './device-cert.js';
import { deviceScopePayload, signDeviceScope } from './device-scope.js';
import { signerFromSecret } from '../signer/signer.js';
import { hex } from '../crypto/internal.js';

const ROOT_SECRET = '5c'.repeat(32);
const ACCOUNT = 'ca999783990fd7f4ea0c192135f78c17ac77745bf580b2ed20fea455a8133845';
const DEVICE = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1044305da225179a277d6d96e07ff21ea';
const APPS = ['11'.repeat(32), '22'.repeat(32)];

const PROOF_EMPTY =
  '02ed6a47a39da869b5446155e40b2d93f1e3f0167be26732bae7a3ef9d8e3a3fd300000000ca999783990fd7f4ea0c192135f78c17ac77745bf580b2ed20fea455a8133845a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1044305da225179a277d6d96e07ff21ea0000000000000000000000000d5f35a9d8060be917868b9c98efef2b8e3a3908c22c4faf17eb950da490fa64c9a7c3c52c49944c2f624cbbf0d4c24a5faf1aa57ec3a8005279b94e738ebf05';
const PROOF_TWO_APPS =
  '02ed6a47a39da869b5446155e40b2d93f1e3f0167be26732bae7a3ef9d8e3a3fd300000000ca999783990fd7f4ea0c192135f78c17ac77745bf580b2ed20fea455a8133845a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1044305da225179a277d6d96e07ff21ea02000000111111111111111111111111111111111111111111111111111111111111111122222222222222222222222222222222222222222222222222222222222222220700000000000000ea5ac9c4c48801393fb2161892b2f267c65b23bf75fb33de559178644d2214c783ffdcb5e3c4ad4d310c235663c811b06762f829f0c7b9d87fcc6315bd590101';

describe('device scope', () => {
  it('derives the account and device core derives', async () => {
    await expect(accountForRoot(ROOT_SECRET)).resolves.toBe(ACCOUNT);
    await expect(mintDeviceId(ACCOUNT, new Uint8Array(16).fill(0xa1))).resolves.toBe(DEVICE);
  });

  it('computes the payload core signs', async () => {
    const empty = await deviceScopePayload({
      account: ACCOUNT,
      device: DEVICE,
      applications: [],
      scopeEpoch: 0,
      keyEpoch: 0,
    });
    expect(hex(empty)).toBe('99d56fe161047241aedab847a4325f64fe678ab4883460c502bec57a2ab11261');
    const two = await deviceScopePayload({
      account: ACCOUNT,
      device: DEVICE,
      applications: APPS,
      scopeEpoch: 7,
      keyEpoch: 0,
    });
    expect(hex(two)).toBe('14ab8d9fa7c2cb5fd8957fcb8dcc02c7347b40c9871d73ab1dc3e6ed8a812476');
  });

  it('encodes the proof core encodes, with and without applications', async () => {
    await expect(signDeviceScope({ rootSecret: ROOT_SECRET, device: DEVICE })).resolves.toBe(
      PROOF_EMPTY,
    );
    await expect(
      signDeviceScope({ rootSecret: ROOT_SECRET, device: DEVICE, applications: APPS, scopeEpoch: 7 }),
    ).resolves.toBe(PROOF_TWO_APPS);
  });

  it('signs the same bytes through a Signer', async () => {
    const signer = await signerFromSecret(ROOT_SECRET, 'rootSecret');
    await expect(signDeviceScope({ signer, device: DEVICE })).resolves.toBe(PROOF_EMPTY);
  });

  it('refuses both a secret and a signer, and an epoch that is not a u32', async () => {
    const signer = await signerFromSecret(ROOT_SECRET, 'rootSecret');
    await expect(
      signDeviceScope({ rootSecret: ROOT_SECRET, signer, device: DEVICE }),
    ).rejects.toThrow(/not both/);
    await expect(
      signDeviceScope({ rootSecret: ROOT_SECRET, device: DEVICE, scopeEpoch: -1 }),
    ).rejects.toThrow(/u32/);
  });
});
