/**
 * Links this browser began, so a callback can be matched to one. `localStorage`,
 * not `sessionStorage`: consent opens in a `noopener` tab with empty session storage.
 */

const KEY = "calimero.cloud.link.pending";
const STATE_PARAM = "link_state";
const LIFETIME_MS = 10 * 60 * 1000; // a grant lives 5 minutes, plus time to consent
export const ACCOUNT_HEX = /^[0-9a-f]{64}$/;
const MAX_PENDING = 20; // bounds storage when a page builds a consent URL on every render

type Pending = Record<string, { account: string; expiresAt: number }>;

function readPending(now: number): Pending {
  try {
    const raw = localStorage.getItem(KEY);
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
    localStorage.setItem(KEY, JSON.stringify(pending));
  } catch {
    // Storage blocked: the link cannot be matched later and fails closed.
  }
}

/** Remember a link for `account` and return `returnTo` carrying its state. */
export function beginLinkState(account: string, returnTo: string): string {
  if (!ACCOUNT_HEX.test(account)) {
    throw new Error("accountId must be 64 lowercase hex characters");
  }
  const url = new URL(returnTo);
  const now = Date.now();
  const pending = readPending(now);
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const state = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  pending[state] = { account, expiresAt: now + LIFETIME_MS };
  writePending(Object.fromEntries(Object.entries(pending).slice(-MAX_PENDING)));
  url.searchParams.set(STATE_PARAM, state);
  return url.toString();
}

/** Removes and returns the link a callback answers, or null when this browser did not begin it. */
export function takeLinkState(search: string): { account: string } | null {
  const state = new URLSearchParams(search).get(STATE_PARAM);
  const pending = readPending(Date.now());
  if (!state || !Object.prototype.hasOwnProperty.call(pending, state))
    return null;
  const entry = pending[state];
  delete pending[state];
  writePending(pending);
  return entry;
}

/** The query with the link state removed, for rewriting the address bar. */
export function withoutLinkState(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(STATE_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}
