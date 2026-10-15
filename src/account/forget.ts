/**
 * Signing out of a delegated account: everything this browser holds for it, gone.
 */
import { activeAccount, clearDeviceStore, markSignedOut, readSessionRecord } from './device-store.js';
import { forgetGroupNamespaces } from './govern.js';
import { dropLegacySecrets, forgetMethodKinds, forgetRelaySealing } from './session.js';

/** Device-scoped `localStorage` prefixes: a new device starts its own ledgers. */
const DEVICE_SCOPED_PREFIXES = ['calimero.nonce.', 'calimero.governance-nonce.', 'mero-js:warrant-nonce:'];
const LINK_PENDING_KEY = 'calimero.cloud.link.pending';

/** Delete the device key, pending enrolments, the session and every record kept for `account`. */
export async function forgetAccount(account: string): Promise<void> {
  markSignedOut();
  dropLegacySecrets();
  forgetMethodKinds();
  forgetRelaySealing();
  forgetRecords([account]);
  // A runtime with no IndexedDB never held a device here.
  if (typeof indexedDB === 'undefined') return;
  forgetRecords([await activeAccount(), (await readSessionRecord())?.account]);
  await clearDeviceStore();
}

/** The account-scoped records of each of `accounts`, and every device-scoped one. */
function forgetRecords(accounts: Array<string | null | undefined>): void {
  const ids = accounts.filter((a): a is string => Boolean(a)).map((a) => a.trim().toLowerCase());
  for (const id of ids) forgetGroupNamespaces(id);
  try {
    const doomed = [LINK_PENDING_KEY, ...ids.flatMap((id) => [`calimero.delegated.relays.${id}`, `calimero.delegated.joinnonce.${id}`])];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && DEVICE_SCOPED_PREFIXES.some((p) => key.startsWith(p))) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    /* no storage, nothing stored */
  }
}
