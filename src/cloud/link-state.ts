/**
 * Redirects this browser began, so a callback can be matched to one. `localStorage`,
 * not `sessionStorage`: consent opens in a `noopener` tab with empty session storage.
 */

const KEY = "calimero.cloud.link.pending";
const STATE_PARAM = "link_state";
const LIFETIME_MS = 10 * 60 * 1000; // a grant lives 5 minutes, plus time to consent
export const ACCOUNT_HEX = /^[0-9a-f]{64}$/;
const MAX_PENDING = 20; // bounds storage when a page builds a consent URL on every render

type Pending<T> = Record<string, T & { expiresAt: number }>;

function readPending<T>(key: string, now: number): Pending<T> {
  try {
    const raw = localStorage.getItem(key);
    const pending = raw ? (JSON.parse(raw) as Pending<T>) : {};
    return Object.fromEntries(
      Object.entries(pending).filter(
        ([, p]) => p && typeof p.expiresAt === "number" && p.expiresAt > now,
      ),
    );
  } catch {
    return {};
  }
}

function writePending<T>(key: string, pending: Pending<T>): void {
  try {
    localStorage.setItem(key, JSON.stringify(pending));
  } catch {
    // Storage blocked: the redirect cannot be matched later and fails closed.
  }
}

/** Remember `payload` in the `key` store under a fresh random state, and return the state. */
export function beginState<T extends object>(key: string, payload: T): string {
  const now = Date.now();
  const pending = readPending<T>(key, now);
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const state = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  pending[state] = { ...payload, expiresAt: now + LIFETIME_MS };
  writePending(key, Object.fromEntries(Object.entries(pending).slice(-MAX_PENDING)));
  return state;
}

/** Removes and returns what `state` was begun with, or null when this browser did not begin it. */
export function takeState<T extends object>(
  key: string,
  state: string | null | undefined,
): T | null {
  const pending = readPending<T>(key, Date.now());
  if (!state || !Object.prototype.hasOwnProperty.call(pending, state))
    return null;
  const entry = pending[state];
  delete pending[state];
  writePending(key, pending);
  return entry;
}

/** Remember a link for `account` and return `returnTo` carrying its state. */
export function beginLinkState(account: string, returnTo: string): string {
  if (!ACCOUNT_HEX.test(account)) {
    throw new Error("accountId must be 64 lowercase hex characters");
  }
  const url = new URL(returnTo);
  url.searchParams.set(STATE_PARAM, beginState(KEY, { account }));
  return url.toString();
}

/** Removes and returns the link a callback answers, or null when this browser did not begin it. */
export function takeLinkState(search: string): { account: string } | null {
  return takeState(KEY, new URLSearchParams(search).get(STATE_PARAM));
}

/** The query with the link state removed, for rewriting the address bar. */
export function withoutLinkState(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(STATE_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}
