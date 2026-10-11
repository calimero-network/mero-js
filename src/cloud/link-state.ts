/**
 * The link this tab began, remembered so a callback can be matched to it.
 *
 * The cloud seals a grant for whoever consented, and the redirect URL can be
 * forwarded. Only a callback carrying the state minted here, for the account
 * named here, answers a link this tab asked for.
 */

const KEY = 'calimero.cloud.link.pending';
const STATE_PARAM = 'link_state';

const memory = new Map<string, string>();

interface PendingLink {
  state: string;
  account: string;
}

function store(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  if (typeof sessionStorage === 'undefined') {
    return {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => void memory.set(k, v),
      removeItem: (k) => void memory.delete(k),
    };
  }
  return sessionStorage;
}

function readPending(): PendingLink | null {
  try {
    const raw = store().getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingLink) : null;
  } catch {
    return null;
  }
}

/** Remember a link for `account` and return `returnTo` carrying its state. */
export function beginLinkState(account: string, returnTo: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const state = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  store().setItem(KEY, JSON.stringify({ state, account } satisfies PendingLink));
  const url = new URL(returnTo);
  url.searchParams.set(STATE_PARAM, state);
  return url.toString();
}

/** True, and forgets the link, when the callback answers the one begun here. */
export function consumeLinkState(search: string, account: string): boolean {
  const pending = readPending();
  const state = new URLSearchParams(search).get(STATE_PARAM);
  if (!pending || state !== pending.state || account !== pending.account) return false;
  store().removeItem(KEY);
  return true;
}
