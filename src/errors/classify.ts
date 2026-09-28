// ── What a failed request means, in terms a caller can act on ────────────────
//
// Core rc.56 onwards (calimero-network/core#4151 to #4164) answers a refused
// admin request with the status that names the refusal: a malformed body is a
// 400, a caller the node will not serve a 403, a missing resource a 404, a
// state the request contradicts (an expired invitation, a removed member) a
// 409, an oversized upload a 413, and a request the node cannot serve *yet*
// (no member online to hand over a group key) a 503. Before that, every one of
// them was a bare 500 and the only way to tell them apart was to match text.
//
// Every caller asks the same two questions of such an error: what kind of
// failure is this, and would doing it again later help? This answers both once,
// so apps stop keeping their own copies of the status table.

/** The kind of failure, as far as it decides what the caller does next. */
export type ErrorKind =
  /** 400. The request is wrong; sending it again cannot help. */
  | 'invalid'
  /** 401. This client's session lapsed; signing in again can finish it. */
  | 'unauthorized'
  /** 403. The node will not do this for this caller. */
  | 'forbidden'
  /** 404. What the request names does not exist on this node (yet). */
  | 'not-found'
  /** 409. The request contradicts the current state: expired, spent, removed. */
  | 'conflict'
  /** 410. It existed and is gone for good. */
  | 'gone'
  /** 413. The body is over the node's limit. */
  | 'too-large'
  /** 429. The node asked the caller to slow down. */
  | 'rate-limited'
  /** 503 or 504. The node cannot serve this yet — no peer online, say. */
  | 'unavailable'
  /** Any other 5xx. The node failed; the request may well have been fine. */
  | 'server'
  /** Status 0. The request never reached the node: offline, CORS, a timeout. */
  | 'unreachable'
  /** Not an HTTP failure, or one with nothing more specific to go on. */
  | 'unknown';

export interface ClassifiedError {
  kind: ErrorKind;
  /** The HTTP status, when the error carries one. 0 means no response. */
  status: number | undefined;
  /**
   * Whether the same request could succeed later without anything changing on
   * the caller's side. False for a refusal the node chose — asking again gets
   * the same answer — and true for a failure about the moment.
   */
  retryable: boolean;
  /**
   * The node's own explanation, without an `HTTP <status>` prefix, falling back
   * to the error's message. For logs and for a UI that shows detail; a UI that
   * wants friendly copy should switch on `kind`.
   */
  message: string;
}

const RETRYABLE: Record<ErrorKind, boolean> = {
  invalid: false,
  // The session, not the request: signing in again and repeating it works.
  unauthorized: true,
  forbidden: false,
  // Too broad to give up on — the resource may simply not have synced yet.
  'not-found': true,
  conflict: false,
  gone: false,
  'too-large': false,
  'rate-limited': true,
  unavailable: true,
  server: true,
  unreachable: true,
  unknown: true,
};

function kindForStatus(status: number): ErrorKind {
  switch (status) {
    case 0:
      return 'unreachable';
    case 400:
      return 'invalid';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not-found';
    case 409:
      return 'conflict';
    case 410:
      return 'gone';
    case 413:
      return 'too-large';
    case 429:
      return 'rate-limited';
    case 503:
    case 504:
      return 'unavailable';
  }
  if (status >= 500 && status < 600) return 'server';
  if (status >= 400 && status < 500) return 'invalid';
  return 'unknown';
}

/**
 * The HTTP status an error carries, in any shape a client throws: mero-js's
 * `HTTPError.status`, an axios-style `response.status`, or a bare `statusCode`.
 * Undefined when there is none — a thrown string, or an error raised before the
 * request was sent.
 */
export function statusOf(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const shaped = err as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  };
  for (const candidate of [shaped.status, shaped.response?.status, shaped.statusCode]) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  }
  return undefined;
}

/**
 * The most specific human-readable explanation an error carries, or
 * `fallback`. Prefers the node's words (`HTTPError.explanation`, or an axios
 * body's `error`/`message`) over a message that repeats the status line.
 */
export function messageOf(err: unknown, fallback = 'Request failed'): string {
  if (typeof err === 'string') return err.trim() || fallback;
  if (!err || typeof err !== 'object') return fallback;
  const shaped = err as {
    explanation?: unknown;
    message?: unknown;
    error?: unknown;
    data?: { message?: unknown };
    response?: { data?: { error?: unknown; message?: unknown } };
  };
  for (const candidate of [
    shaped.explanation,
    shaped.response?.data?.error,
    shaped.response?.data?.message,
    shaped.data?.message,
    shaped.error,
    shaped.message,
  ]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return fallback;
}

/**
 * What a failed request means: its kind, whether a later attempt could work,
 * and the node's own words for it.
 *
 * Accepts anything a `catch` hands over. A browser `fetch` that could not
 * connect throws a `TypeError`, which is read as `unreachable` like mero-js's
 * own status-0 `HTTPError`.
 */
export function classifyError(err: unknown): ClassifiedError {
  const status = statusOf(err);
  let kind: ErrorKind;
  if (status !== undefined) {
    kind = kindForStatus(status);
  } else if (err instanceof TypeError) {
    kind = 'unreachable';
  } else {
    kind = 'unknown';
  }
  return { kind, status, retryable: RETRYABLE[kind], message: messageOf(err) };
}
