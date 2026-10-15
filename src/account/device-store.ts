/**
 * This browser's device key: non-extractable `CryptoKey`s in IndexedDB, origin-wide.
 * Records: `pending:<state>`, `active`, `session`, and the X25519 keys under `kem:`.
 */
import { hex } from '../crypto/internal.js';
import { signerFromCryptoKey, type Signer } from '../signer/signer.js';

const DB_NAME = 'calimero';
const STORE = 'device';
const ACTIVE = 'active';
const SESSION = 'session';
const PENDING_PREFIX = 'pending:';
const KEM_PREFIX = 'kem:'; // X25519 keys apart: WebKitGTK reads a record holding one back as null
const PENDING_TTL_MS = 30 * 60 * 1000; // time to consent at the wallet; bounds a pending pair's life

/** A key pair generated for an enrolment, before any account certified it. */
export interface PendingDevice {
  signKey: CryptoKey;
  signPk: string;
  kemPk: string;
  createdAt: number;
}

interface ActiveDevice extends Omit<PendingDevice, 'createdAt'> {
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
const isLive = (p: PendingDevice | undefined): p is PendingDevice =>
  p !== undefined && p.createdAt <= Date.now() && Date.now() - p.createdAt < PENDING_TTL_MS;

let signOuts = 0; // bumped by every clear, so work begun before one can tell
export const signOutCount = () => signOuts;
const remove = (key: string) => inStore('readwrite', (s) => void s.delete(key));

async function rawPublicKey(key: CryptoKey): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
}

function pruneExpiredPending(store: IDBObjectStore): void {
  const cursor = store.openCursor();
  cursor.onsuccess = () => {
    const c = cursor.result;
    if (!c) return;
    if (String(c.key).startsWith(PENDING_PREFIX) && !isLive(c.value as PendingDevice)) {
      c.delete();
      store.delete(KEM_PREFIX + String(c.key));
    }
    c.continue();
  };
}

/** Generate a fresh, unexportable device key pair and park it under `state`. */
export async function createPendingDevice(state: string): Promise<PendingDevice> {
  const startedAt = signOuts;
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
    kemPk: await rawPublicKey(kem.publicKey),
    createdAt: Date.now(),
  };
  if (signOuts !== startedAt) throw new Error('signed out while this enrolment began - start it again');
  await inStore('readwrite', (s) => {
    s.put(pending, PENDING_PREFIX + state);
    s.put(kem.privateKey, KEM_PREFIX + PENDING_PREFIX + state);
    pruneExpiredPending(s);
  });
  return pending;
}

/** The live pair parked under `state`, left in place: activation takes it. */
export async function readPendingDevice(state: string): Promise<PendingDevice | undefined> {
  const pending = await read<PendingDevice>(PENDING_PREFIX + state);
  if (isLive(pending)) return pending;
  if (pending) await discardPendingDevice(state);
  return undefined;
}

export const discardPendingDevice = (state: string) =>
  inStore('readwrite', (s) => {
    s.delete(PENDING_PREFIX + state);
    s.delete(KEM_PREFIX + PENDING_PREFIX + state);
  });

/**
 * Make the pair under `state` this browser's device, in one transaction that
 * fails if the pair is gone, so a logout that ran meanwhile wins.
 */
export async function activatePendingDevice(
  state: string,
  certified: { account: string; credential: string },
): Promise<boolean> {
  let activated = false;
  await inStore('readwrite', (s) => {
    const req = s.get(PENDING_PREFIX + state) as IDBRequest<PendingDevice | undefined>;
    const kemReq = s.get(KEM_PREFIX + PENDING_PREFIX + state) as IDBRequest<CryptoKey | null | undefined>;
    kemReq.onsuccess = () => {
      const pending = req.result;
      if (!isLive(pending)) return;
      const { createdAt: _createdAt, ...keys } = pending;
      s.clear();
      s.put({ ...keys, ...certified } satisfies ActiveDevice, ACTIVE);
      if (kemReq.result) s.put(kemReq.result, KEM_PREFIX + ACTIVE);
      activated = true;
    };
  });
  return activated;
}

/** A signer that refuses once its device is no longer the active one, in this tab or any other. */
export async function deviceSigner(signKey: CryptoKey, signPk: string): Promise<Signer> {
  const inner = await signerFromCryptoKey(signKey, signPk);
  return {
    publicKey: inner.publicKey,
    async sign(payload) {
      if ((await read<ActiveDevice>(ACTIVE))?.signPk !== signPk) {
        throw new Error('this device was signed out, so it no longer signs');
      }
      return inner.sign(payload);
    },
  };
}

/** The enrolled device, only for the account that certified it; any other account clears it. */
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
    signer: await deviceSigner(active.signKey, active.signPk),
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
export const markSignedOut = () => void (signOuts += 1);

export function clearDeviceStore(): Promise<unknown> {
  markSignedOut();
  return inStore('readwrite', (s) => void s.clear());
}
