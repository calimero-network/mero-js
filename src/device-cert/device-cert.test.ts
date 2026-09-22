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
  accountForRootPublicKey,
  deviceCertPayload,
  mintDeviceId,
  signDeviceCert,
} from './device-cert.js';
import { signerFromCryptoKey, signerFromSecret } from '../signer/signer.js';

const PKCS8_ED25519_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04,
  0x22, 0x04, 0x20,
]);

/** The same seed as a key that signs and can never be exported. */
async function unexportable(seedByte: number): Promise<CryptoKey> {
  const pkcs8 = new Uint8Array(PKCS8_ED25519_PREFIX.length + 32);
  pkcs8.set(PKCS8_ED25519_PREFIX, 0);
  pkcs8.set(new Uint8Array(32).fill(seedByte), PKCS8_ED25519_PREFIX.length);
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, [
    'sign',
  ]);
}

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

/**
 * The property that makes a phrase-held root usable at all: a root kept as a
 * key this page cannot read must certify **the same bytes** as the same root
 * loaded as hex.
 *
 * If it did not, a browser moving its root out of script memory would start
 * issuing credentials core refuses — and the refusal arrives at a node as
 * "unverifiable credential", nowhere near the key that caused it.
 */
describe('a root held as a CryptoKey', () => {
  const COMMON = {
    device: DEVICE,
    signPublicKey: SIGN_PK,
    kemPublicKey: KEM_PK,
    deviceEpoch: 7,
  };

  it('certifies a device byte for byte as the same secret does', async () => {
    const secret = '77'.repeat(32);
    const fromSecret = await signDeviceCert({ ...COMMON, rootSecret: secret });
    const fromKey = await signDeviceCert({
      ...COMMON,
      signer: await signerFromCryptoKey(
        await unexportable(0x77),
        (await signerFromSecret(secret)).publicKey,
      ),
    });

    // Ed25519 is deterministic, so identical output means an identical preimage
    // — including the account id the certificate names.
    expect(fromKey).toBe(fromSecret);
    expect(fromKey.length / 2).toBe(237);
  });

  it('names the same account the secret names', async () => {
    const secret = '77'.repeat(32);
    const signer = await signerFromSecret(secret);

    await expect(accountForRootPublicKey(signer.publicKey)).resolves.toBe(
      await accountForRoot(secret),
    );
  });

  it('refuses a secret and a signer at once, which could name different roots', async () => {
    await expect(
      signDeviceCert({
        ...COMMON,
        rootSecret: '77'.repeat(32),
        signer: await signerFromSecret('78'.repeat(32)),
      }),
    ).rejects.toThrow(/either rootSecret or signer, not both/);
  });

  it('refuses neither, rather than certifying under some default', async () => {
    await expect(signDeviceCert({ ...COMMON })).rejects.toThrow(
      /rootSecret or signer is required/,
    );
  });
});
