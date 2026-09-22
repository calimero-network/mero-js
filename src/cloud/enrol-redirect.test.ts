/**
 * The app-to-wallet enrolment redirect.
 *
 * The happy path is one assertion. Everything else here is a way a fragment
 * written by somebody other than the wallet could be believed — a credential
 * for a key this app does not hold, a real credential re-labelled with another
 * account, a reply to a request this app never made — and each of those is a
 * credential the app would otherwise file and act on.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  completeDeviceEnrolment,
  deviceEnrolmentUrl,
  readEnrolmentCallback,
} from './enrol-redirect.js';
import {
  accountForRootPublicKey,
  mintDeviceId,
  signDeviceCert,
} from '../device-cert/index.js';
import { signerFromSecret } from '../signer/signer.js';

const DEVICE_KEY = 'aa'.repeat(32);
const KEM_KEY = 'bb'.repeat(32);

/** A real credential, signed by a real root — nothing here is hand-built bytes. */
async function enrol(
  rootSecret: string,
  signPublicKey: string,
  kemPublicKey = KEM_KEY,
) {
  const signer = await signerFromSecret(rootSecret, 'rootSecret');
  const account = await accountForRootPublicKey(signer.publicKey);
  const device = await mintDeviceId(account, new Uint8Array(16).fill(7));
  const credential = await signDeviceCert({
    signer,
    device,
    signPublicKey,
    kemPublicKey,
    deviceEpoch: 1,
  });
  return { credential, account, device };
}

describe('deviceEnrolmentUrl', () => {
  it('names the keys to certify and where to come back to', () => {
    const url = new URL(
      deviceEnrolmentUrl({
        walletUrl: 'https://wallet.example',
        devicePublicKey: DEVICE_KEY,
        kemPublicKey: KEM_KEY,
        returnTo: 'https://app.example/back',
        state: 's-1',
      }),
    );
    expect(url.origin).toBe('https://wallet.example');
    expect(url.searchParams.get('enrol-device')).toBe(DEVICE_KEY);
    expect(url.searchParams.get('enrol-kem')).toBe(KEM_KEY);
    expect(url.searchParams.get('callback-url')).toBe('https://app.example/back');
    expect(url.searchParams.get('state')).toBe('s-1');
  });

  it('refuses a key the wallet could not use', () => {
    expect(() =>
      deviceEnrolmentUrl({
        walletUrl: 'https://wallet.example',
        devicePublicKey: DEVICE_KEY.toUpperCase(),
        kemPublicKey: KEM_KEY,
        returnTo: 'https://app.example',
      }),
    ).toThrow(/64 lowercase hex/);
  });

  it('refuses a plain-HTTP return address off localhost', () => {
    // The credential rides in the fragment of that page: served over HTTP, any
    // network position between here and there can rewrite the page that reads it.
    expect(() =>
      deviceEnrolmentUrl({
        walletUrl: 'https://wallet.example',
        devicePublicKey: DEVICE_KEY,
        kemPublicKey: KEM_KEY,
        returnTo: 'http://app.example/back',
      }),
    ).toThrow(/https:, or http: on localhost/);
  });

  it('allows http on localhost, because otherwise nobody can develop', () => {
    expect(
      deviceEnrolmentUrl({
        walletUrl: 'https://wallet.example',
        devicePublicKey: DEVICE_KEY,
        kemPublicKey: KEM_KEY,
        returnTo: 'http://localhost:5173/',
      }),
    ).toContain('callback-url=http');
  });

  it('refuses a scheme that is script rather than a page', () => {
    expect(() =>
      deviceEnrolmentUrl({
        walletUrl: 'https://wallet.example',
        devicePublicKey: DEVICE_KEY,
        kemPublicKey: KEM_KEY,
        returnTo: 'javascript:alert(1)',
      }),
    ).toThrow(/must be https:/);
  });
});

describe('readEnrolmentCallback', () => {
  it('is null on an ordinary page load', () => {
    expect(readEnrolmentCallback({ hash: '' })).toBeNull();
  });

  it('is null on a partial fragment rather than returning half an enrolment', () => {
    expect(readEnrolmentCallback({ hash: '#account=aa' })).toBeNull();
  });

  it('reads what the wallet handed back', () => {
    const got = readEnrolmentCallback({
      hash: `#credential=02ab&account=${'11'.repeat(32)}&device=${'22'.repeat(32)}&state=s-1`,
    });
    expect(got).toEqual({
      credential: '02ab',
      account: '11'.repeat(32),
      device: '22'.repeat(32),
      state: 's-1',
    });
  });

  it('throws when the person declined, rather than waiting forever', () => {
    expect(() => readEnrolmentCallback({ hash: '#error=denied' })).toThrow(
      /not approved/,
    );
  });

  it('reports an error the wallet named, verbatim enough to act on', () => {
    expect(() => readEnrolmentCallback({ hash: '#error=unknown-device' })).toThrow(
      /unknown-device/,
    );
  });
});

describe('completeDeviceEnrolment', () => {
  it('accepts a credential over the key this app asked about', async () => {
    const { credential, account, device } = await enrol('07'.repeat(32), DEVICE_KEY);
    const enrolled = await completeDeviceEnrolment({
      credential,
      account,
      device,
      devicePublicKey: DEVICE_KEY,
      kemPublicKey: KEM_KEY,
    });
    expect(enrolled.account).toBe(account);
    expect(enrolled.device).toBe(device);
    expect(enrolled.certificate.signPublicKey).toBe(DEVICE_KEY);
  });

  it('refuses a credential certifying somebody else’s device key', async () => {
    // The attack this closes: a real, verifiable credential — for a key the
    // attacker holds. Stored, every warrant this app signs is refused at a
    // relay, and the failure surfaces nowhere near the enrolment that caused it.
    const { credential, account, device } = await enrol('07'.repeat(32), 'cc'.repeat(32));
    await expect(
      completeDeviceEnrolment({
        credential,
        account,
        device,
        devicePublicKey: DEVICE_KEY,
      }),
    ).rejects.toThrow(/this app holds/);
  });

  it('refuses a credential naming a delivery key this app did not ask about', async () => {
    const { credential, account, device } = await enrol(
      '07'.repeat(32),
      DEVICE_KEY,
      'dd'.repeat(32),
    );
    await expect(
      completeDeviceEnrolment({
        credential,
        account,
        device,
        devicePublicKey: DEVICE_KEY,
        kemPublicKey: KEM_KEY,
      }),
    ).rejects.toThrow(/sealed to somebody else/);
  });

  it('refuses an account label that is not the one the credential names', async () => {
    const { credential, device } = await enrol('07'.repeat(32), DEVICE_KEY);
    await expect(
      completeDeviceEnrolment({
        credential,
        account: 'ff'.repeat(32),
        device,
        devicePublicKey: DEVICE_KEY,
      }),
    ).rejects.toThrow(/but the credential names/);
  });

  it('refuses a device id that is not the one the credential names', async () => {
    const { credential, account } = await enrol('07'.repeat(32), DEVICE_KEY);
    await expect(
      completeDeviceEnrolment({
        credential,
        account,
        device: 'ff'.repeat(32),
        devicePublicKey: DEVICE_KEY,
      }),
    ).rejects.toThrow(/but the credential names/);
  });

  it('refuses a credential whose signature was not made by its root', async () => {
    const { credential, account, device } = await enrol('07'.repeat(32), DEVICE_KEY);
    // One byte of the signature flipped: the account still derives, the shape
    // still parses, and only the verification catches it.
    const tampered =
      credential.slice(0, credential.length - 2) +
      (credential.endsWith('00') ? '01' : '00');
    await expect(
      completeDeviceEnrolment({
        credential: tampered,
        account,
        device,
        devicePublicKey: DEVICE_KEY,
      }),
    ).rejects.toThrow(/did not sign this certificate/);
  });

  it('refuses an answer to a request this app never made', async () => {
    const { credential, account, device } = await enrol('07'.repeat(32), DEVICE_KEY);
    await expect(
      completeDeviceEnrolment({
        credential,
        account,
        device,
        state: 'from-somewhere-else',
        expectState: 's-1',
        devicePublicKey: DEVICE_KEY,
      }),
    ).rejects.toThrow(/did not make/);
  });

  it('checks the state before it checks anything expensive', async () => {
    // Cheap comparison first, so a fragment aimed at the wrong app costs a
    // string compare rather than a signature verification.
    const verify = vi.spyOn(crypto.subtle, 'verify');
    await expect(
      completeDeviceEnrolment({
        credential: 'not-even-hex',
        account: 'ff'.repeat(32),
        device: 'ff'.repeat(32),
        expectState: 's-1',
        devicePublicKey: DEVICE_KEY,
      }),
    ).rejects.toThrow(/did not make/);
    expect(verify).not.toHaveBeenCalled();
    verify.mockRestore();
  });
});
