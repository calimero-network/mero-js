/**
 * This browser's device key, held where script on the origin can use it but
 * never read it: a non-extractable `CryptoKey` in IndexedDB.
 *
 * One record per role in one object store. `pending:<state>` is a key pair
 * generated for an enrolment in flight; `active` is the certified device and
 * the account it belongs to; `session` is which relay that account writes
 * through. Origin-wide, like node-login tokens: every tab shares the device.
 */
import { hex } from '../crypto/internal.js';
import { signerFromCryptoKey, type Signer } from '../signer/signer.js';

const DB_NAME = 'calimero';
const STORE = 'device';
const ACTIVE = 'active';
const SESSION = 'session';
const PENDING_PREFIX = 'pending:';

/** A key pair generated for an enrolment, before any account certified it. */
export interface PendingDevice {
  signKey: CryptoKey;
  signPk: string;
  kemKey: CryptoKey;
  kemPk: string;
}

interface ActiveDevice extends PendingDevice {
  account: string;
  credential: string;
}

/** Which relay the account writes through: no key material, so it is stored as is. */
export interface SessionRecord {
  account: string;
  relayUrl: string | null;
  executorAccount: string | null;
}

/** An enrolled device as callers use it: the certificate and something that signs for it. */
export interface DeviceHandle {
  account: string;
  credential: string;
  signer: Signer;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Run `fn` in one transaction and resolve with its last request's result once it commits. */
async function inStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const read = <T>(key: string) => inStore<T>('readonly', (s) => s.get(key) as IDBRequest<T>);
const remove = (key: string) => inStore('readwrite', (s) => void s.delete(key));

async function rawPublicKey(key: CryptoKey): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
}

/** Generate a fresh, unexportable device key pair and park it under `state`. */
export async function createPendingDevice(state: string): Promise<PendingDevice> {
  const sign = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  let kem: CryptoKeyPair;
  try {
    kem = (await crypto.subtle.generateKey({ name: 'X25519' }, false, [
      'deriveBits',
    ])) as CryptoKeyPair;
  } catch {
    // Certifying a delivery key with no private half would look like success
    // and fail much later, as a scope key nothing here can unwrap.
    throw new Error(
      'this browser cannot generate an X25519 key, so it cannot receive wrapped scope keys. ' +
        'Chrome 133+, Firefox 130+ and Safari 17+ support it.',
    );
  }
  const pending: PendingDevice = {
    signKey: sign.privateKey,
    signPk: await rawPublicKey(sign.publicKey),
    kemKey: kem.privateKey,
    kemPk: await rawPublicKey(kem.publicKey),
  };
  await inStore('readwrite', (s) => void s.put(pending, PENDING_PREFIX + state));
  return pending;
}

/** The pair parked under `state`, removed in the same transaction so it is used at most once. */
export function takePendingDevice(state: string): Promise<PendingDevice | undefined> {
  return inStore<PendingDevice>('readwrite', (s) => {
    const req = s.get(PENDING_PREFIX + state) as IDBRequest<PendingDevice>;
    s.delete(PENDING_PREFIX + state);
    return req;
  });
}

/** Make `device` this browser's device, replacing any earlier one and its session. */
export function activateDevice(device: PendingDevice & { account: string; credential: string }): Promise<unknown> {
  const active: ActiveDevice = { ...device };
  return inStore('readwrite', (s) => {
    s.clear();
    s.put(active, ACTIVE);
  });
}

/**
 * The enrolled device, only for the account that certified it.
 *
 * Asking for any other account clears the record: a device left behind by one
 * account must never sign for the next.
 */
export async function readDevice(account: string): Promise<DeviceHandle | null> {
  const active = await read<ActiveDevice>(ACTIVE);
  if (!active) return null;
  if (active.account !== account.trim().toLowerCase()) {
    await clearDeviceStore();
    return null;
  }
  return {
    account: active.account,
    credential: active.credential,
    signer: await signerFromCryptoKey(active.signKey, active.signPk),
  };
}

/** The account the active device was certified for, if there is one. */
export async function activeAccount(): Promise<string | null> {
  return (await read<ActiveDevice>(ACTIVE))?.account ?? null;
}

export const readSessionRecord = () => read<SessionRecord>(SESSION);

export function writeSessionRecord(record: SessionRecord): Promise<unknown> {
  return inStore('readwrite', (s) => void s.put(record, SESSION));
}

export const clearSessionRecord = () => remove(SESSION);

/** Drop every device record: the active key, any pending ones, and the session. */
export const clearDeviceStore = () => inStore('readwrite', (s) => void s.clear());
