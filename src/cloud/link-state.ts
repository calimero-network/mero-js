/**
 * Redirects this browser began, so a callback can be matched to one. `localStorage`,
 * not `sessionStorage`: consent opens in a `noopener` tab with empty session storage.
 */

import { hex } from "../crypto/internal.js";

const KEY = "calimero.cloud.link.pending";
const STATE_PARAM = "link_state";
const LIFETIME_MS = 10 * 60 * 1000; // a grant lives 5 minutes, plus time to consent
export const ACCOUNT_HEX = /^[0-9a-f]{64}$/;
const MAX_PENDING = 20; // bounds storage when a page builds a consent URL on every render
const VERIFIER_BYTES = 32; // the cloud refuses any other length
export const VERIFIER_HEX = /^[0-9a-f]{64}$/;
const LINK_GRANT_USE = "account-link-grant";

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
  const state = hex(crypto.getRandomValues(new Uint8Array(16)));
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

/** What a link grant claims, read without its seal, which only the cloud can check. */
export interface LinkGrantClaims {
  /** The cloud login that consented. */
  login: string;
  account: string;
  challenge: string;
}

/** The challenge a verifier commits to: sha256 of its bytes, hex. */
export async function linkChallenge(verifier: string): Promise<string> {
  const bytes = Uint8Array.from(verifier.match(/../g) ?? [], (b) => parseInt(b, 16));
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

/**
 * Remember a link for `account` under a fresh verifier. Returns `returnTo`
 * carrying its state, and the challenge to send the cloud in place of the verifier.
 */
export async function beginLinkState(
  account: string,
  returnTo: string,
): Promise<{ callbackUrl: string; challenge: string }> {
  if (!ACCOUNT_HEX.test(account)) {
    throw new Error("accountId must be 64 lowercase hex characters");
  }
  const url = new URL(returnTo);
  const verifier = hex(crypto.getRandomValues(new Uint8Array(VERIFIER_BYTES)));
  const challenge = await linkChallenge(verifier);
  url.searchParams.set(STATE_PARAM, beginState(KEY, { account, verifier }));
  return { callbackUrl: url.toString(), challenge };
}

/**
 * Removes the link a callback answers and returns its verifier, or null when
 * this browser did not begin a link for `account` with this state.
 */
export function takeLinkVerifier(search: string, account: string | null): string | null {
  const pending = takeState<{ account?: unknown; verifier?: unknown }>(
    KEY,
    new URLSearchParams(search).get(STATE_PARAM),
  );
  if (!pending || pending.account !== account) return null;
  return typeof pending.verifier === "string" && VERIFIER_HEX.test(pending.verifier)
    ? pending.verifier
    : null;
}

/** The claims of a link grant, or null when `grant` is not one. */
export function linkGrantClaims(grant: string): LinkGrantClaims | null {
  try {
    const body = grant.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0))),
    ) as Record<string, unknown>;
    const { use, sub, acc, chal } = claims;
    if (use !== LINK_GRANT_USE) return null;
    if (typeof sub !== "string" || typeof acc !== "string" || typeof chal !== "string") return null;
    return { login: sub, account: acc, challenge: chal };
  } catch {
    return null;
  }
}

/** The query with the link state removed, for rewriting the address bar. */
export function withoutLinkState(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(STATE_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}
