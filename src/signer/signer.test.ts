/**
 * The signer indirection, and the one property it exists to guarantee:
 * a key held as a non-extractable `CryptoKey` signs **the same bytes** as the
 * same key held as a hex secret.
 *
 * That equivalence is what makes the interface safe to adopt. If it did not
 * hold, a browser that moved to an unexportable key would start producing
 * warrants and login statements refused at a node — a 403 or a 401 nowhere near
 * its cause, which is the failure this whole package pins fixtures to avoid.
 *
 * The seed is core's `key(7)` (32 bytes of 0x07), so the expected public key and
 * signature below are the same constants `warrant_wire_fixture.rs` asserts. This
 * file therefore checks conformance *through the signer path*, not merely
 * self-consistency between two of our own code paths.
 */
import { describe, expect, it } from 'vitest';

import { signWarrant } from '../warrant/warrant.js';
import { signLoginStatement } from '../login/login.js';
import { resolveSigner, signerFromCryptoKey, signerFromSecret } from './signer.js';

const SECRET = '07'.repeat(32);
/** `key(7)`'s public half, from core's fixture. */
const PUBLIC_KEY =
  'ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c';

const PKCS8_ED25519_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04,
  0x22, 0x04, 0x20,
]);

/** The same seed, as a key that can sign and can never be exported. */
async function unexportable(): Promise<CryptoKey> {
  const pkcs8 = new Uint8Array(32 + PKCS8_ED25519_PREFIX.length);
  pkcs8.set(PKCS8_ED25519_PREFIX, 0);
  pkcs8.set(new Uint8Array(32).fill(7), PKCS8_ED25519_PREFIX.length);
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, [
    'sign',
  ]);
}

const WARRANT_TERMS = {
  context: '11'.repeat(32),
  authorAccount: '22'.repeat(32),
  executor: '33'.repeat(32),
  appVersion: '44'.repeat(32),
  method: 'set',
  argsJson: { key: 'k', value: 'v' },
  accountHeads: ['55'.repeat(32)],
  governanceFloor: ['66'.repeat(32)],
  nonce: 42,
  notAfter: 1_700_000_000,
};

const LOGIN_TERMS = {
  node: '11'.repeat(32),
  audience: { kind: 'webOrigin', origin: 'https://app.example:8443' } as const,
  challenge: '22'.repeat(32),
  sessionKey: '33'.repeat(32),
  issuedAt: 1_700_000_000,
  expiresAt: 1_700_000_300,
};

describe('signerFromSecret', () => {
  it('names the public key core derives from the same seed', async () => {
    const signer = await signerFromSecret(SECRET);
    expect(signer.publicKey).toBe(PUBLIC_KEY);
  });

  it('refuses a malformed secret rather than signing something meaningless', async () => {
    await expect(signerFromSecret('not-hex', 'deviceSecret')).rejects.toThrow(
      /deviceSecret must be 64 hex/,
    );
  });
});

describe('signerFromCryptoKey', () => {
  it('accepts a key that cannot be exported', async () => {
    const signer = await signerFromCryptoKey(await unexportable(), PUBLIC_KEY);
    expect(signer.publicKey).toBe(PUBLIC_KEY);
    expect((await signer.sign(new Uint8Array([1, 2, 3]))).length).toBe(64);
  });

  it('reads the public half from a generated pair, so callers need no hex', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    // WebCrypto leaves the PUBLIC half exportable even when the private half is
    // not, which is what makes this convenience possible at all.
    const signer = await signerFromCryptoKey(pair.privateKey, pair.publicKey);
    expect(signer.publicKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses the public half of a pair, which cannot sign', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    await expect(
      signerFromCryptoKey(pair.publicKey, PUBLIC_KEY),
    ).rejects.toThrow(/needs the private half/);
  });

  it('refuses a public key that is not 32 bytes', async () => {
    await expect(
      signerFromCryptoKey(await unexportable(), 'abcd'),
    ).rejects.toThrow(/publicKey must be 64 hex/);
  });
});

describe('a CryptoKey signs exactly what the same secret signs', () => {
  it('for a warrant — including the bytes core pinned', async () => {
    const fromSecret = await signWarrant({
      ...WARRANT_TERMS,
      deviceSecret: SECRET,
    });
    const fromKey = await signWarrant({
      ...WARRANT_TERMS,
      signer: await signerFromCryptoKey(await unexportable(), PUBLIC_KEY),
    });

    expect(fromKey).toBe(fromSecret);
    // Ed25519 is deterministic, so identical output means identical preimage —
    // and this is the signature `warrant_wire_fixture.rs` asserts.
    expect(fromKey).toContain(
      '4007d4164a6a15f4b6b251b45e9afad623c274451127afc1453e35667d4ec6fe',
    );
  });

  it('for a login statement', async () => {
    const fromSecret = await signLoginStatement({
      ...LOGIN_TERMS,
      deviceSecret: SECRET,
    });
    const fromKey = await signLoginStatement({
      ...LOGIN_TERMS,
      signer: await signerFromCryptoKey(await unexportable(), PUBLIC_KEY),
    });

    expect(fromKey).toBe(fromSecret);
  });
});

describe('resolveSigner', () => {
  it('refuses both at once, since they could name different keys', async () => {
    const signer = await signerFromSecret(SECRET);
    await expect(resolveSigner(SECRET, signer, 'deviceSecret')).rejects.toThrow(
      /either deviceSecret or signer, not both/,
    );
  });

  it('refuses neither', async () => {
    await expect(
      resolveSigner(undefined, undefined, 'deviceSecret'),
    ).rejects.toThrow(/deviceSecret or signer is required/);
  });

  it('is what the signing entry points enforce', async () => {
    await expect(
      signWarrant({ ...WARRANT_TERMS } as never),
    ).rejects.toThrow(/deviceSecret or signer is required/);
  });
});
