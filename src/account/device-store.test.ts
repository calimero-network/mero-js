// @vitest-environment jsdom
/**
 * The browser's device key: generated unexportable, bound to the one account
 * that certified it, and gone when that account signs out.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  beginDeviceEnrolment,
  completeDeviceEnrolment,
} from '../cloud/enrol-redirect.js';
import {
  accountForRootPublicKey,
  mintDeviceId,
  signDeviceCert,
} from '../device-cert/index.js';
import { signerFromSecret } from '../signer/signer.js';
import { readDevice } from './device-store.js';
import { forgetAccount } from './forget.js';
import { namespaceOfGroup, rememberGroupNamespace } from './govern.js';
import {
  readDelegatedCredential,
  readDelegatedSession,
  rememberRelay,
  saveDelegatedSession,
} from './session.js';

const ROOT_A = '11'.repeat(32);
const ROOT_B = '22'.repeat(32);

/** The wallet's half: certify whatever keys the app asked about. */
async function walletCertifies(
  rootSecret: string,
  keys: { devicePublicKey: string; kemPublicKey: string; state: string },
) {
  const root = await signerFromSecret(rootSecret, 'rootSecret');
  const account = await accountForRootPublicKey(root.publicKey);
  const device = await mintDeviceId(account, crypto.getRandomValues(new Uint8Array(16)));
  const credential = await signDeviceCert({
    signer: root,
    device,
    signPublicKey: keys.devicePublicKey,
    kemPublicKey: keys.kemPublicKey,
    deviceEpoch: 1,
  });
  return { credential, account, device, state: keys.state };
}

async function enrol(rootSecret: string) {
  const begun = await beginDeviceEnrolment();
  return completeDeviceEnrolment(await walletCertifies(rootSecret, begun));
}

/** Every record in the device store, raw, as script on the origin would see it. */
async function deviceRecords(): Promise<unknown[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('calimero');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    if (!db.objectStoreNames.contains('device')) return [];
    return await new Promise((resolve, reject) => {
      const req = db.transaction('device', 'readonly').objectStore('device').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('device keystore', () => {
  it('keeps both device keys unexportable', async () => {
    const enrolled = await enrol(ROOT_A);
    const records = await deviceRecords();
    const keys = records.flatMap((r) => (r instanceof CryptoKey ? [r] : Object.values(r as object)))
      .filter((v): v is CryptoKey => v instanceof CryptoKey);

    expect(keys.map((k) => k.algorithm.name).sort()).toEqual(['Ed25519', 'X25519']);
    for (const key of keys) {
      expect(key.extractable).toBe(false);
      await expect(crypto.subtle.exportKey('pkcs8', key)).rejects.toThrow();
    }
    expect(enrolled.signer.publicKey).toBe(enrolled.certificate.signPublicKey);
  });

  it('never reuses a key across enrolments', async () => {
    const first = await beginDeviceEnrolment();
    const second = await beginDeviceEnrolment();

    expect(second.devicePublicKey).not.toBe(first.devicePublicKey);
    expect(second.kemPublicKey).not.toBe(first.kemPublicKey);
    expect(second.state).not.toBe(first.state);
  });

  it('refuses a completion this browser did not begin', async () => {
    // Keys the wallet certified, but no pending record here for that state.
    const foreign = await walletCertifies(ROOT_A, {
      devicePublicKey: 'aa'.repeat(32),
      kemPublicKey: 'bb'.repeat(32),
      state: 'cc'.repeat(16),
    });

    await expect(completeDeviceEnrolment(foreign)).rejects.toThrow(/not started here/);
    expect(await deviceRecords()).toEqual([]);
  });

  it('refuses a completion carrying no state', async () => {
    const begun = await beginDeviceEnrolment();
    const { state: _state, ...stateless } = await walletCertifies(ROOT_A, begun);

    await expect(completeDeviceEnrolment(stateless)).rejects.toThrow(/no state/);
  });

  it('consumes the pending record, so a callback cannot be replayed', async () => {
    const begun = await beginDeviceEnrolment();
    const back = await walletCertifies(ROOT_A, begun);
    await completeDeviceEnrolment(back);

    await expect(completeDeviceEnrolment(back)).rejects.toThrow(/not started here/);
  });

  it('refuses a certificate over a key other than the pending one, and burns the attempt', async () => {
    const begun = await beginDeviceEnrolment();
    const wrong = await walletCertifies(ROOT_A, { ...begun, devicePublicKey: 'aa'.repeat(32) });

    await expect(completeDeviceEnrolment(wrong)).rejects.toThrow(/certifies device key/);
    await expect(
      completeDeviceEnrolment(await walletCertifies(ROOT_A, begun)),
    ).rejects.toThrow(/not started here/);
    expect(await deviceRecords()).toEqual([]);
  });

  it('hands the device only to the account that certified it', async () => {
    const a = await enrol(ROOT_A);
    const accountB = await accountForRootPublicKey((await signerFromSecret(ROOT_B)).publicKey);

    expect(await readDevice(accountB)).toBeNull();
    // A mismatch is not a miss to retry: the record is gone for both accounts.
    expect(await readDevice(a.account)).toBeNull();
    expect(await deviceRecords()).toEqual([]);
  });

  it('signs as the enrolled device on a reload', async () => {
    const a = await enrol(ROOT_A);
    const device = await readDevice(a.account);

    expect(device?.credential).toBe(a.credential);
    expect(device?.signer.publicKey).toBe(a.certificate.signPublicKey);
    expect(await readDelegatedCredential()).toMatchObject({ account: a.account });
  });

  it('keeps no secret in session storage for a connected session', async () => {
    const a = await enrol(ROOT_A);
    await saveDelegatedSession({ account: a.account, credential: a.credential, signer: a.signer, relayUrl: 'https://relay.example' });

    expect(sessionStorage.length).toBe(0);
    const s = await readDelegatedSession();
    expect(s).toMatchObject({ account: a.account, relayUrl: 'https://relay.example', credential: a.credential });
    expect(s?.signer.publicKey).toBe(a.certificate.signPublicKey);
  });
});

describe('an engine that cannot store an X25519 key', () => {
  // WebKitGTK commits a record holding an X25519 CryptoKey and reads it back as null.
  const isX25519 = (v: unknown) => v instanceof CryptoKey && v.algorithm.name === 'X25519';
  beforeEach(() => {
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const holdsX25519 = isX25519(value) || Object.values((value ?? {}) as object).some(isX25519);
      return put.call(this, holdsX25519 ? null : value, key);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('still enrols, restores and signs with the device', async () => {
    const a = await enrol(ROOT_A);
    const device = await readDevice(a.account);

    expect(device?.signer.publicKey).toBe(a.certificate.signPublicKey);
    await expect(device!.signer.sign(new Uint8Array(32))).resolves.toHaveLength(64);
  });
});

describe('device keystore across a logout', () => {
  it('does not activate a device whose enrolment completes after a logout began', async () => {
    const begun = await beginDeviceEnrolment();
    const back = await walletCertifies(ROOT_A, begun);

    const completing = completeDeviceEnrolment(back);
    await forgetAccount(back.account);

    await expect(completing).rejects.toThrow(/not started here/);
    expect(await deviceRecords()).toEqual([]);
  });

  it('stops signing with a device already handed out once it is forgotten', async () => {
    const a = await enrol(ROOT_A);
    await forgetAccount(a.account);

    await expect(a.signer.sign(new Uint8Array(32))).rejects.toThrow(/signed out/);
  });

  it('refuses an enrolment answered after the pending key pair expired', async () => {
    const begun = await beginDeviceEnrolment();
    const back = await walletCertifies(ROOT_A, begun);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 31 * 60 * 1000 });

    await expect(completeDeviceEnrolment(back)).rejects.toThrow(/not started here/);
    expect(await deviceRecords()).toEqual([]);
  });
  it('does not stretch the expiry of a pair stamped by a clock running fast', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 24 * 60 * 60 * 1000 });
    const begun = await beginDeviceEnrolment();
    vi.setSystemTime(Date.now() - 23 * 60 * 60 * 1000);

    await expect(completeDeviceEnrolment(await walletCertifies(ROOT_A, begun))).rejects.toThrow(/not started here/);
  });

  it('leaves no pending pair from an enrolment begun while a logout ran', async () => {
    const begun = beginDeviceEnrolment();
    await forgetAccount('aa'.repeat(32));

    await expect(begun).rejects.toThrow(/signed out/);
    expect(await deviceRecords()).toEqual([]);
  });

  it('prunes abandoned enrolments once they expire', async () => {
    await beginDeviceEnrolment();
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 31 * 60 * 1000 });
    await beginDeviceEnrolment();

    // One pending pair: its record and its delivery key.
    expect(await deviceRecords()).toHaveLength(2);
  });
});

describe('forgetAccount', () => {
  it('resolves where there is no IndexedDB, having cleared web storage', async () => {
    const idb = globalThis.indexedDB;
    // @ts-expect-error: a runtime without IndexedDB
    delete globalThis.indexedDB;
    localStorage.setItem('calimero.nonce.https://relay.example', '4');
    try {
      await expect(forgetAccount('aa'.repeat(32))).resolves.toBeUndefined();
    } finally {
      globalThis.indexedDB = idb;
    }
    expect(localStorage.length).toBe(0);
  });

  it('leaves no device, session or account-scoped storage behind', async () => {
    const a = await enrol(ROOT_A);
    await beginDeviceEnrolment(); // an abandoned second enrolment
    await saveDelegatedSession({ account: a.account, credential: a.credential, signer: a.signer, relayUrl: 'https://relay.example' });
    rememberRelay(a.account, 'https://relay.example', { namespaceId: 'ns' });
    localStorage.setItem('calimero.nonce.https://relay.example', '4');
    localStorage.setItem('calimero.governance-nonce.https://relay.example.ns', '2');
    localStorage.setItem(`calimero.delegated.group-namespace.${a.account}`, '{}');
    localStorage.setItem(`calimero.delegated.joinnonce.${a.account}`, '1');
    localStorage.setItem('calimero.cloud.link.pending', '{}');
    localStorage.setItem(`mero-js:warrant-nonce:${a.signer.publicKey}`, '3');
    localStorage.setItem('calimero.delegated.relay-node-key.https://relay.example', 'ab'.repeat(32));
    // What an earlier release left: a hex device secret in session storage.
    sessionStorage.setItem('calimero.delegated.connection', '{"deviceSecret":"00"}');
    sessionStorage.setItem('calimero.delegated.credential', '{"deviceSecret":"00"}');

    rememberGroupNamespace(a.account, 'sub', 'ns');

    await forgetAccount(a.account);

    expect(sessionStorage.length).toBe(0);
    expect(await deviceRecords()).toEqual([]);
    expect(await readDelegatedSession()).toBeNull();
    expect(namespaceOfGroup({ account: a.account } as never, 'sub')).toBeUndefined();
    // Only the relay's pinned node key stays: it is the relay's, not the account's.
    expect(Object.keys(localStorage)).toEqual([
      'calimero.delegated.relay-node-key.https://relay.example',
    ]);
  });
});
