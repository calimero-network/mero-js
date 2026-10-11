/**
 * The links this browser began, remembered so a callback can be matched to one.
 *
 * The cloud seals a grant for whoever consented, and the redirect URL can be
 * forwarded. Only a callback carrying a state minted here, for the account it
 * was minted for, answers a link this browser asked for.
 *
 * `localStorage`, not `sessionStorage`: consent opens in a `noopener` tab, which
 * starts with empty session storage. What matters is that the browser began the
 * link; a forwarded URL arrives in a browser with no entry for its state.
 */

const KEY = 'calimero.cloud.link.pending';
const STATE_PARAM = 'link_state';
const LIFETIME_MS = 10 * 60 * 1000; // a grant lives 5 minutes, plus time to consent

const memory = new Map<string, string>();

type Pending = Record<string, { account: string; expiresAt: number }>;

function store(): Pick<Storage, 'getItem' | 'setItem'> {
  if (typeof localStorage === 'undefined') {
    return { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v) };
  }
  return localStorage;
}

function readPending(now: number): Pending {
  let pending: Pending = {};
  try {
    const raw = store().getItem(KEY);
    if (raw) pending = JSON.parse(raw) as Pending;
  } catch {
    return {};
  }
  return Object.fromEntries(Object.entries(pending).filter(([, p]) => p.expiresAt > now));
}

function writePending(pending: Pending): void {
  try {
    store().setItem(KEY, JSON.stringify(pending));
  } catch {
    // Storage blocked: the link cannot be matched later and fails closed.
  }
}

/** Remember a link for `account` and return `returnTo` carrying its state. */
export function beginLinkState(account: string, returnTo: string): string {
  const url = new URL(returnTo);
  const now = Date.now();
  const pending = readPending(now);
  // Re-rendering must not invalidate a consent URL already handed out.
  let state = Object.keys(pending).find((s) => pending[s].account === account);
  if (!state) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    state = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  pending[state] = { account, expiresAt: now + LIFETIME_MS };
  writePending(pending);
  url.searchParams.set(STATE_PARAM, state);
  return url.toString();
}

/** True, and forgets the link, when the callback answers one begun here. */
export function consumeLinkState(search: string, account: string): boolean {
  const state = new URLSearchParams(search).get(STATE_PARAM);
  const pending = readPending(Date.now());
  if (!state || pending[state]?.account !== account) return false;
  delete pending[state];
  writePending(pending);
  return true;
}
