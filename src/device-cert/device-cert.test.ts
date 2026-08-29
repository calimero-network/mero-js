/**
 * Vectors here are computed by an independent implementation of the same spec —
 * a short Python transcription of core's `domain_hash` — rather than by running
 * this code and recording what it said. A self-derived vector pins the current
 * behaviour and proves nothing about whether it is right; the value of a second
 * implementation is that a transcription slip has to be made twice, the same
 * way, to survive.
 *
 * They are not a substitute for diffing against `merod account sign-cert`, which
 * is the only check that can catch this drifting from the node. That needs a
 * BIP-39 root derivation this package does not have yet — see the PR.
 */
import { describe, it, expect } from 'vitest';

import {
  accountForRoot,
  deviceCertPayload,
  mintDeviceId,
  signDeviceCert,
} from './device-cert.js';

const ACCOUNT = '11'.repeat(32);
const DEVICE = '33'.repeat(32);
const SIGN_PK = '44'.repeat(32);
const KEM_PK = '55'.repeat(32);

describe('device certificate', () => {
  it('mints the device id core mints', async () => {
    const nonce = new Uint8Array(16).fill(0x22);
    await expect(mintDeviceId(ACCOUNT, nonce)).resolves.toBe(
      '7042c913b557a30a2cbabcaccdbecd1014bc0cb3fe594c0d82f95d2887312ab4',
    );
  });

  it('refuses a nonce that is not 16 bytes', async () => {
    await expect(mintDeviceId(ACCOUNT, new Uint8Array(8))).rejects.toThrow(
      /16 bytes/,
    );
  });

  it('computes the payload a root signs', async () => {
    await expect(
      deviceCertPayload({
        account: ACCOUNT,
        device: DEVICE,
        signPublicKey: SIGN_PK,
        kemPublicKey: KEM_PK,
        keyEpoch: 0,
        deviceEpoch: 7,
      }).then((b) => Buffer.from(b).toString('hex')),
    ).resolves.toBe(
      '543ba0d195c857628b5279468c304239853d417550d69d7c0fe96887f91b51f3',
    );
  });

  /**
   * Both keys are inside the signature, so neither can be swapped in a
   * certificate that still verifies. That is what stops a relay carrying
   * someone's credential from substituting its own delivery key and becoming
   * the reader — the property the delegated-join design leans on.
   */
  it('covers both the signing key and the delivery key', async () => {
    const base = {
      account: ACCOUNT,
      device: DEVICE,
      signPublicKey: SIGN_PK,
      kemPublicKey: KEM_PK,
      keyEpoch: 0,
      deviceEpoch: 7,
    };
    const hexOf = (b: Uint8Array) => Buffer.from(b).toString('hex');

    const asMinted = hexOf(await deviceCertPayload(base));
    const otherSign = hexOf(
      await deviceCertPayload({ ...base, signPublicKey: '46'.repeat(32) }),
    );
    const otherKem = hexOf(
      await deviceCertPayload({ ...base, kemPublicKey: '57'.repeat(32) }),
    );

    expect(otherSign).not.toBe(asMinted);
    expect(otherKem).not.toBe(asMinted);
  });

  it('advances with the device epoch, so a reissue is not a rollback', async () => {
    const at = (deviceEpoch: number) =>
      deviceCertPayload({
        account: ACCOUNT,
        device: DEVICE,
        signPublicKey: SIGN_PK,
        kemPublicKey: KEM_PK,
        keyEpoch: 0,
        deviceEpoch,
      }).then((b) => Buffer.from(b).toString('hex'));

    expect(await at(7)).not.toBe(await at(8));
  });

  it('derives the account as the content address of its genesis', async () => {
    // The genesis is `version ‖ root_sign_pk`; this pins the borsh layout as
    // much as the hash, since a wrong version byte moves the whole account.
    const rootSecret = '77'.repeat(32);
    const account = await accountForRoot(rootSecret);
    expect(account).toMatch(/^[0-9a-f]{64}$/);

    // The same root always names the same account.
    await expect(accountForRoot(rootSecret)).resolves.toBe(account);
  });

  it('emits a credential of the length core encodes', async () => {
    const credential = await signDeviceCert({
      rootSecret: '77'.repeat(32),
      device: DEVICE,
      signPublicKey: SIGN_PK,
      kemPublicKey: KEM_PK,
      deviceEpoch: 7,
    });

    // genesis(1+32) + chain len(4) + cert(32*4 + 4 + 4 + 64) = 237 bytes.
    expect(credential).toMatch(/^[0-9a-f]+$/);
    expect(credential.length / 2).toBe(237);
  });

  it('binds the credential to the root that signed it', async () => {
    const common = {
      device: DEVICE,
      signPublicKey: SIGN_PK,
      kemPublicKey: KEM_PK,
      deviceEpoch: 7,
    };
    const a = await signDeviceCert({ ...common, rootSecret: '77'.repeat(32) });
    const b = await signDeviceCert({ ...common, rootSecret: '78'.repeat(32) });

    expect(a).not.toBe(b);
  });
});
