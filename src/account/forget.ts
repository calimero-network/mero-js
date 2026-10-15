/**
 * Signing out of a delegated account: everything this browser holds for it, gone.
 */
import { clearDeviceStore } from './device-store.js';
import { forgetGroupNamespaces } from './govern.js';
import { dropLegacySecrets, forgetMethodKinds, forgetRelaySealing } from './session.js';

/** Device-scoped `localStorage` prefixes: a new device starts its own ledgers. */
const DEVICE_SCOPED_PREFIXES = ['calimero.nonce.', 'calimero.governance-nonce.', 'mero-js:warrant-nonce:'];
const LINK_PENDING_KEY = 'calimero.cloud.link.pending';

/** Delete the device key, pending enrolments, the session and every record kept for `account`. */
export async function forgetAccount(account: string): Promise<void> {
  const id = account.trim().toLowerCase();
  dropLegacySecrets();
  forgetGroupNamespaces(id);
  forgetMethodKinds();
  forgetRelaySealing();
  try {
    const doomed = [
      `calimero.delegated.relays.${id}`,
      `calimero.delegated.joinnonce.${id}`,
      LINK_PENDING_KEY,
    ];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && DEVICE_SCOPED_PREFIXES.some((p) => key.startsWith(p))) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    /* no storage, nothing stored */
  }
  // A runtime with no IndexedDB never held a device here.
  if (typeof indexedDB !== 'undefined') await clearDeviceStore();
}
