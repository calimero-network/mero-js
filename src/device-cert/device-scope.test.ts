/**
 * Vectors produced by core's own code — `DeviceScope::signing_payload`,
 * `DeviceScope::sign` and `borsh::to_vec(&AccountProof<DeviceScope>)` — from a
 * scratch program run against core at the commit that added
 * `POST /admin-api/namespaces/{namespace_id}/account/link-device`. Ed25519 is
 * deterministic, so the whole proof, signature included, is pinned.
 */
import { describe, it, expect } from 'vitest';

import { accountForRoot, mintDeviceId } from './device-cert.js';
import { deviceScopePayload, signDeviceScope } from './device-scope.js';
import { signerFromSecret } from '../signer/signer.js';
import { hex } from '../crypto/internal.js';

const ROOT_SECRET = '5c'.repeat(32);
const ACCOUNT = 'ca999783990fd7f4ea0c192135f78c17ac77745bf580b2ed20fea455a8133845';
const DEVICE = '044305da225179a277d6d96e07ff21ea2b3905c7e22b0b3625350f15c6f43293';
const APPS = ['11'.repeat(32), '22'.repeat(32)];

const PROOF_EMPTY =
  '02ed6a47a39da869b5446155e40b2d93f1e3f0167be26732bae7a3ef9d8e3a3fd300000000ca999783990fd7f4ea0c192135f78c17ac77745bf580b2ed20fea455a8133845044305da225179a277d6d96e07ff21ea2b3905c7e22b0b3625350f15c6f43293000000000000000000000000991beebc4353d21813988ded6b6be8309d77c7920ee2c0a90e770e63bbe22625765e93f99ecfc8e8b87c72ee5cc417a1fe417d74c7a1e9ddc1c356a202305602';
const PROOF_TWO_APPS =
  '02ed6a47a39da869b5446155e40b2d93f1e3f0167be26732bae7a3ef9d8e3a3fd300000000ca999783990fd7f4ea0c192135f78c17ac77745bf580b2ed20fea455a8133845044305da225179a277d6d96e07ff21ea2b3905c7e22b0b3625350f15c6f4329302000000111111111111111111111111111111111111111111111111111111111111111122222222222222222222222222222222222222222222222222222222222222220700000000000000ea673af66b7bd485ac61d7c0c1cce51b83228043e0388a2cab98cfdd4a5ea5d640fa5b2989c13c83f57dc04f02b32480e6ffcbf574c682f33d82fca839bf680f';

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
    expect(hex(empty)).toBe('1f6ded3ff326b1786665e2f5251742c8908ddc26ff06430f435920f31b464a17');
    const two = await deviceScopePayload({
      account: ACCOUNT,
      device: DEVICE,
      applications: APPS,
      scopeEpoch: 7,
      keyEpoch: 0,
    });
    expect(hex(two)).toBe('d177fb21094a347cde1effbed19f6e1f49713f85609f9de580f928d95b17ac49');
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
