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
 * Beginning and the callback must both run in the browser: the in-memory
 * fallback for hosts without storage never matches across a redirect.
 */

const KEY = "calimero.cloud.link.pending";
const STATE_PARAM = "link_state";
const LIFETIME_MS = 10 * 60 * 1000; // a grant lives 5 minutes, plus time to consent
const MAX_PENDING = 20; // bounds storage when a page builds a consent URL on every render

const memory = new Map<string, string>();

type Pending = Record<string, { account: string; expiresAt: number }>;

function store(): Pick<Storage, "getItem" | "setItem"> {
  if (typeof localStorage === "undefined") {
    return {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => void memory.set(k, v),
    };
  }
  return localStorage;
}

function readPending(now: number): Pending {
  try {
    const raw = store().getItem(KEY);
    const pending = raw ? (JSON.parse(raw) as Pending) : {};
    return Object.fromEntries(
      Object.entries(pending).filter(
        ([, p]) => p && typeof p.expiresAt === "number" && p.expiresAt > now,
      ),
    );
  } catch {
    return {};
  }
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
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const state = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  pending[state] = { account, expiresAt: now + LIFETIME_MS };
  const newest = Object.entries(pending).sort(
    ([, a], [, b]) => b.expiresAt - a.expiresAt,
  );
  writePending(Object.fromEntries(newest.slice(0, MAX_PENDING)));
  url.searchParams.set(STATE_PARAM, state);
  return url.toString();
}

/** True, and forgets the link, when the callback answers one begun here. */
export function consumeLinkState(search: string, account: string): boolean {
  const state = new URLSearchParams(search).get(STATE_PARAM);
  const pending = readPending(Date.now());
  if (!state || !Object.prototype.hasOwnProperty.call(pending, state))
    return false;
  if (pending[state].account !== account) return false;
  delete pending[state];
  writePending(pending);
  return true;
}

/** Forget the link a callback answered without spending it, e.g. a declined consent. */
export function forgetLinkState(search: string): void {
  const state = new URLSearchParams(search).get(STATE_PARAM);
  const pending = readPending(Date.now());
  if (!state || !Object.prototype.hasOwnProperty.call(pending, state)) return;
  delete pending[state];
  writePending(pending);
}

/** The query with the link state removed, for rewriting the address bar. */
export function withoutLinkState(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(STATE_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}
