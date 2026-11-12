/**
 * The consent page flow as one helper (`client.consent.request`, `begin`,
 * `resume`, `wait`), so an app does not hand-roll it: ask the node for a
 * request, send the person to the node's own page, and read the decision
 * from the node when they come back (or while a popup is open).
 *
 * The request bodies and outcomes are typed here, by hand, for every kind
 * core's node takes, including `createOrg`, `createInvite` and
 * `acceptInvite`, which the vendored OpenAPI document does not name yet. The
 * next openapi-sync from core brings them to `client.consent.pageCreate` /
 * `pageResult` too; these helpers send through those same generated routes.
 *
 * Nothing here logs. An invite's `token` (the `acceptInvite` subject, the
 * `createInvite` outcome) goes only into the sealed request body or the
 * answer handed back to the caller: never into storage, the URL or an
 * error's details.
 */

import { CalimeroError } from '../runtime/errors.js';
import type { Routes } from '../generated/methods.js';
import { confirmationCode, type ConsentScope } from './approvals.js';

// ---------------------------------------------------------------- requests

/** A release approval (or, with `withdraw`, its withdrawal) for `scope`. */
export interface ReleaseConsentRequest {
  kind: 'release';
  scope: ConsentScope;
  subject: { version: string; withdraw?: boolean };
  returnTo: string;
}

/** An upgrade of the app instance `app` to `toVersion`. */
export interface UpgradeConsentRequest {
  kind: 'upgrade';
  subject: { app: string; toVersion: string };
  returnTo: string;
}

/** Outbound prefixes: a package-bound session's own package when `package` is left out. */
export interface OutboundConsentRequest {
  kind: 'outbound';
  scope: ConsentScope;
  subject: { package?: string; prefixes?: string[] };
  returnTo: string;
}

/** A new organization named `name`, owned by the person who approves. Outcome: `{ orgId }`. */
export interface CreateOrgConsentRequest {
  kind: 'createOrg';
  subject: { name: string };
  returnTo: string;
}

/** A role an invite gives (core's `Role`). */
export type InviteRole = 'guest' | 'member' | 'admin';

/** A new invite to `org`. Outcome: `{ token }`. */
export interface CreateInviteConsentRequest {
  kind: 'createInvite';
  subject: {
    org: string;
    role: InviteRole;
    /** Teams the invite joins its user to. */
    teams?: string[];
    /** How long the invite lasts, in seconds. */
    ttlSecs?: number;
    /** How many times it may be used. */
    uses?: number;
    /** Whether it gives every app of the organization. */
    allApps?: boolean;
  };
  returnTo: string;
}

/** Joining an organization with an invite's `token`. Outcome: `{ org }`. */
export interface AcceptInviteConsentRequest {
  kind: 'acceptInvite';
  subject: { token: string };
  returnTo: string;
}

/** Every request `POST /consent/requests` takes, by `kind`. Unknown fields are refused. */
export type ConsentPageRequest =
  | ReleaseConsentRequest
  | UpgradeConsentRequest
  | OutboundConsentRequest
  | CreateOrgConsentRequest
  | CreateInviteConsentRequest
  | AcceptInviteConsentRequest;

/** A consent request's kind. */
export type ConsentKind = ConsentPageRequest['kind'];

/** A request as {@link ConsentHelpers.begin} takes it: `returnTo` defaults to the current page. */
export type ConsentDraft = ConsentPageRequest extends infer R
  ? R extends { returnTo: string }
    ? Omit<R, 'returnTo'> & { returnTo?: string }
    : never
  : never;

// ---------------------------------------------------------------- answers

/** What an approval made, by kind: absent for the kinds that make nothing. */
export interface ConsentOutcomes {
  release: never;
  upgrade: never;
  outbound: never;
  createOrg: { orgId: string };
  createInvite: { token: string };
  acceptInvite: { org: string };
}

/** The node's answer to a request: show `code`, send the person to `url`. */
export interface ConsentTicket<K extends ConsentKind = ConsentKind> {
  requestId: string;
  /** The node's consent page for the request. */
  url: string;
  /** The confirmation code the page shows (`XXX-XXX`), checked against `requestId`. */
  code: string;
  /** When the request lapses, Unix seconds. */
  expiresAt: number;
  /** The request's kind, as sent. */
  kind: K;
}

/** Where a consent request stands. */
export type ConsentStatus = 'pending' | 'approved' | 'declined';

/** `GET /consent/{id}/result` for a request of kind `K`. */
export interface ConsentDecisionOf<K extends ConsentKind> {
  requestId: string;
  kind: K;
  status: ConsentStatus;
  /** Unix seconds; `null` while pending. */
  decidedAt: number | null;
  /** What the approval made, once approved, for the kinds that make something. */
  outcome?: ConsentOutcomes[K];
}

/** A decision of any kind of `K`, narrowed by `kind`: `if (d.kind === 'createOrg') d.outcome?.orgId`. */
export type ConsentDecision<K extends ConsentKind = ConsentKind> = { [P in K]: ConsentDecisionOf<P> }[K];

/** How {@link ConsentHelpers.begin} sends the person to the page. */
export interface BeginConsentOptions {
  /** Where the page sends the person back; by default this page, without `request_id` and `result`. */
  returnTo?: string;
  /**
   * Runs after the node answers and before navigating: show the person
   * `ticket.code` here. Answer `false` and the page is not opened (the
   * request stays on the node until it expires, and nothing is stored).
   */
  confirm?: (ticket: ConsentTicket) => boolean | Promise<boolean>;
  /** Sends the browser to the page; by default `location.assign`. */
  navigate?: (url: string) => void;
}

/** How {@link ConsentHelpers.wait} polls. */
export interface WaitConsentOptions {
  /** Stops waiting: `wait` rejects with the signal's reason. */
  signal?: AbortSignal;
  /** Time between polls, ms (2000). */
  pollMs?: number;
  /**
   * Gives up after this long, ms, rejecting with a `TimeoutError`
   * `DOMException`. By default, with a ticket, when the request expires;
   * with a bare id, never.
   */
  timeoutMs?: number;
}

/** The consent flow's helpers, on `client.consent` beside its routes. */
export interface ConsentHelpers {
  /**
   * `POST /consent/requests`: the node's ticket for `body`. Throws
   * `CalimeroError` (`CONSENT_CODE_MISMATCH`) when the node's `code` is not
   * the confirmation code of its `requestId`.
   */
  request<R extends ConsentPageRequest>(body: R): Promise<ConsentTicket<R['kind']>>;
  /**
   * {@link request} with `returnTo` defaulting to this page (without
   * `request_id` and `result`), then store `{ requestId, kind }` in
   * `sessionStorage` and send the browser to the page. Call {@link resume}
   * when the page loads again. Answers the ticket once it navigated (or
   * `confirm` declined).
   */
  begin<D extends ConsentDraft>(body: D, options?: BeginConsentOptions): Promise<ConsentTicket<D['kind']>>;
  /**
   * On page load: when the URL carries the consent page's `request_id`,
   * read the decision from the node, remove `request_id` and `result` from
   * the URL (`history.replaceState`) and, once decided, the stored request;
   * answer the decision. `null` when the URL carries none, or names a
   * request other than the one {@link begin} stored in this tab (its
   * parameters are removed, nothing is fetched). The URL's `result` is never
   * trusted: the node's `status` is the answer, and may still be `pending`.
   */
  resume(href?: string): Promise<ConsentDecision | null>;
  /**
   * Poll `GET /consent/{id}/result` until the request is decided, for an
   * app that opened the page in a popup or a new tab. Rejects with the
   * signal's reason on abort and a `TimeoutError` `DOMException` on timeout.
   */
  wait<K extends ConsentKind = ConsentKind>(
    request: string | ConsentTicket<K>,
    options?: WaitConsentOptions,
  ): Promise<ConsentDecision<K>>;
}

/** The `sessionStorage` key {@link ConsentHelpers.begin} keeps its request under. */
export const CONSENT_STORAGE_KEY = 'calimero.consent';

const PARAMS = ['request_id', 'result'] as const;

interface Browser {
  location?: { href: string; assign(url: string): void };
  history?: { state: unknown; replaceState(state: unknown, unused: string, url?: string): void };
  sessionStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

const browser = () => globalThis as unknown as Browser;

function storage(): Browser['sessionStorage'] {
  try {
    return browser().sessionStorage;
  } catch {
    return undefined; // a sandboxed frame, or storage turned off
  }
}

function stored(): { requestId: string; kind: ConsentKind } | null {
  try {
    const raw = storage()?.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { requestId?: unknown; kind?: unknown };
    return typeof v.requestId === 'string' && typeof v.kind === 'string' ? { requestId: v.requestId, kind: v.kind as ConsentKind } : null;
  } catch {
    return null;
  }
}

function forget(): void {
  try {
    storage()?.removeItem(CONSENT_STORAGE_KEY);
  } catch {
    // nothing to clear
  }
}

/** `href` without the consent page's `request_id` and `result`. */
export function withoutConsentParams(href: string | URL): string {
  const url = new URL(String(href));
  for (const p of PARAMS) url.searchParams.delete(p);
  return url.toString();
}

function currentHref(): string {
  const href = browser().location?.href;
  if (!href) throw new Error('no page to return to; pass `returnTo`');
  return href;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal as AbortSignal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** The helpers over a client's generated `consent` routes. */
export function consentHelpers(routes: Routes['consent']): ConsentHelpers {
  type CreateBody = Parameters<Routes['consent']['pageCreate']>[0]['body'];

  const result = async (requestId: string, signal?: AbortSignal): Promise<ConsentDecision> =>
    // The generated answer names the kinds of the vendored document only.
    (await routes.pageResult({ request: requestId }, signal ? { signal } : undefined)) as unknown as ConsentDecision;

  const request = async <R extends ConsentPageRequest>(body: R): Promise<ConsentTicket<R['kind']>> => {
    const started = await routes.pageCreate({ body: body as unknown as CreateBody });
    const expected = await confirmationCode(started.requestId);
    if (started.code !== expected) {
      throw new CalimeroError(200, 'CONSENT_CODE_MISMATCH', 'the consent page code does not match the request', {
        requestId: started.requestId,
        code: started.code,
        expected,
      });
    }
    return { requestId: started.requestId, url: started.url, code: started.code, expiresAt: started.expiresAt, kind: body.kind };
  };

  async function begin<D extends ConsentDraft>(body: D, options: BeginConsentOptions = {}): Promise<ConsentTicket<D['kind']>> {
    const returnTo = options.returnTo ?? body.returnTo ?? withoutConsentParams(currentHref());
    const navigate =
      options.navigate ??
      ((url: string) => {
        const location = browser().location;
        if (!location) throw new Error('no window to open the consent page in; pass `navigate`');
        location.assign(url);
      });
    const ticket = (await request({ ...body, returnTo } as ConsentPageRequest)) as ConsentTicket<D['kind']>;
    if (options.confirm && !(await options.confirm(ticket))) return ticket;
    try {
      storage()?.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ requestId: ticket.requestId, kind: ticket.kind }));
    } catch {
      // Without storage, `resume` still reads the decision by the URL's id.
    }
    navigate(ticket.url);
    return ticket;
  }

  async function resume(href?: string): Promise<ConsentDecision | null> {
    const url = new URL(href ?? currentHref());
    const requestId = url.searchParams.get('request_id');
    if (!requestId) return null;

    const clean = withoutConsentParams(url);
    const tidy = () => {
      const history = browser().history;
      if (href === undefined && history && clean !== url.toString()) history.replaceState(history.state, '', clean);
    };

    const mine = stored();
    if (mine && mine.requestId !== requestId) {
      // Not the request this tab began: drop the parameters, keep ours.
      tidy();
      return null;
    }
    const decision = await result(requestId);
    tidy();
    if (mine && decision.kind !== mine.kind) {
      forget();
      throw new CalimeroError(200, 'CONSENT_KIND_MISMATCH', 'the consent result is not of the kind requested', {
        requestId,
        kind: decision.kind,
        expected: mine.kind,
      });
    }
    if (decision.status !== 'pending') forget();
    return decision;
  }

  async function wait<K extends ConsentKind = ConsentKind>(
    req: string | ConsentTicket<K>,
    options: WaitConsentOptions = {},
  ): Promise<ConsentDecision<K>> {
    const requestId = typeof req === 'string' ? req : req.requestId;
    const pollMs = options.pollMs ?? 2000;
    const timeoutMs = options.timeoutMs ?? (typeof req === 'string' ? undefined : Math.max(0, req.expiresAt * 1000 - Date.now()));
    const deadline = timeoutMs === undefined ? Infinity : Date.now() + timeoutMs;
    const { signal } = options;
    for (;;) {
      if (signal?.aborted) throw abortReason(signal);
      const decision = await result(requestId, signal);
      if (decision.status !== 'pending') return decision as ConsentDecision<K>;
      const left = deadline - Date.now();
      if (left <= 0) throw new DOMException(`consent request ${requestId} is still pending`, 'TimeoutError');
      await sleep(Math.min(pollMs, left), signal);
    }
  }

  return { request, begin, resume, wait };
}
