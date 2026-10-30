/**
 * What the cloud node's refusals mean to a caller (spec D64, D70).
 *
 * The node answers an error as `{ error: CODE, message, details }` with an HTTP
 * status. {@link errorFrom} is the one place the client turns that into an
 * error a caller can switch on; every call, view and event stream goes through
 * it. It matches the status and the code together, never the status alone: the
 * node sends other 409s (`CONFLICT`, `NOT_INSTALLED`) that are not an
 * idempotency mismatch, and other 413s (`TOO_LARGE` from the sealed transport)
 * that are not oversized call arguments. Anything it does not recognise stays a
 * plain {@link CalimeroError} carrying both.
 *
 * Every typed error extends {@link CalimeroError}, so `instanceof CalimeroError`
 * and its `status` and `code` (the node's code) keep working for all of them.
 */

export class CalimeroError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(`${status} ${code}: ${message}`);
    this.name = 'CalimeroError';
  }
}

/**
 * `401 UNAUTHENTICATED` that refreshing could not answer: sign in (again) and
 * repeat the request.
 *
 * A session token is signed by the node that issued it, and other nodes take
 * it only while they can vouch for that node's signing key: a `401` often
 * means only that the issuer was replaced or cannot be reached, not that the
 * user signed out. The client answers that itself when it holds a refresh
 * token: it refreshes once (any node takes the refresh) and repeats the
 * request. This error reaches a caller when there is no refresh token (an API
 * key, say), or the refresh was refused.
 */
export class LoginRequired extends CalimeroError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(401, 'UNAUTHENTICATED', message, details);
    this.name = 'LoginRequired';
  }
}

/**
 * `421 WRONG_NODE`: this node runs a mero-tee release the account's owners have
 * not approved, so it neither issues nor takes the account's sessions. Use
 * another node of the cluster; refreshing here would not help.
 *
 * The client moves to the next node it was given (`nodes`) and repeats the
 * request once by itself. This error reaches a caller when it knows no other
 * node, when the next one refused too, or after a sign-in (which needs the
 * passkey again: repeat it, and it goes to the next node).
 */
export class WrongNode extends CalimeroError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(421, 'WRONG_NODE', message, details);
    this.name = 'WrongNode';
  }
}

/**
 * `404 NOT_FOUND`: what the request names does not exist for this caller. For
 * an app this does not say whether it exists: an account the app does not
 * admit gets the same answer as a missing app.
 */
export class NotFound extends CalimeroError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(404, 'NOT_FOUND', message, details);
    this.name = 'NotFound';
  }
}

/**
 * `412 CONFIRM_REQUIRED`: the call needs the account holder's passkey over a
 * challenge in `details`. The `*Confirmed` methods answer it themselves; it
 * reaches a caller only from a method that was given no passkey.
 */
export class ConfirmRequired extends CalimeroError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(412, 'CONFIRM_REQUIRED', message, details);
    this.name = 'ConfirmRequired';
  }
}

/** The user declined the passkey prompt a confirmation asked for. Nothing was sent. */
export class ConfirmCancelled extends Error {
  constructor(readonly cause?: unknown) {
    super('the passkey confirmation was cancelled');
    this.name = 'ConfirmCancelled';
  }
}

/** `413 ARGS_TOO_LARGE`: the call's arguments are over the node's limit; it did not run. */
export class ArgsTooLarge extends CalimeroError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(413, 'ARGS_TOO_LARGE', message, details);
    this.name = 'ArgsTooLarge';
  }
}

/** `409 IDEMPOTENCY_MISMATCH`: the idempotency key was used before with different arguments. */
export class IdempotencyMismatch extends CalimeroError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(409, 'IDEMPOTENCY_MISMATCH', message, details);
    this.name = 'IdempotencyMismatch';
  }
}

/**
 * `409 RELEASE_DEADLINE`: a mero-tee release's deadline has passed and the
 * set that governs this work (the app's publisher's, or its owner's) has not
 * approved it or a newer one, so new work (creating an app, installing a
 * release, upgrading an app) is refused. Apps already running keep running.
 * Approving `release` lifts it at once.
 */
export class ReleaseDeadlineError extends CalimeroError {
  /** The release to approve. */
  readonly release: string;
  /** Its deadline, RFC 3339 (`''` when the node did not say). */
  readonly after: string;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(409, 'RELEASE_DEADLINE', message, details);
    this.name = 'ReleaseDeadlineError';
    this.release = typeof details.release === 'string' ? details.release : '';
    this.after = typeof details.after === 'string' ? details.after : '';
  }
}

/**
 * `409 CONSENT_STALE`: what a consent page showed (the app's bundle, the
 * target release, the release's measurements) changed before the person
 * approved. Nothing was approved; ask for a new consent request so they see
 * the new facts.
 */
export class ConsentStale extends CalimeroError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(409, 'CONSENT_STALE', message, details);
    this.name = 'ConsentStale';
  }
}

/**
 * `422 APP_ERROR`: the app refused the call. `appCode` is the app's declared
 * error (`Taken`, `Forbidden`, ...) and `fields` its named fields. The call was
 * logged, so its idempotency key is spent.
 */
export class AppError extends CalimeroError {
  readonly appCode: string;
  readonly fields: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(422, 'APP_ERROR', message, details);
    this.name = 'AppError';
    const { appCode, fields } = appErrorOf(details);
    this.appCode = appCode;
    this.fields = fields;
  }
}

/** `422 TRAP`: the run trapped (`OutOfFuel`, `OutOfMemory`, ...). The call was logged. */
export class TrapError extends CalimeroError {
  readonly kind: string;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(422, 'TRAP', message, details);
    this.name = 'TrapError';
    this.kind = typeof details.kind === 'string' ? details.kind : '';
  }
}

/**
 * Whether a call the node answered 503 may have committed: `false` when the
 * node says it did not (`TIMEOUT`, `MIGRATING`), `"unknown"` otherwise (a call
 * that raced a leader change). Never a plain boolean: `"unknown"` must not read
 * as "no".
 */
export type Committed = false | 'unknown';

/**
 * Any `503`, or a connection that failed, after the client's retries with the
 * same idempotency key ran out. `reason` is the node's code in lower case
 * (`timeout`, `migrating`, `unavailable`, ...), or `network` when the node gave
 * no answer at all (code `NETWORK`, `cause` the `fetch` failure); such a call
 * may have committed, so its `committed` is `'unknown'`.
 */
export class UnavailableError extends CalimeroError {
  readonly reason: string;
  readonly committed: Committed;
  /** Seconds the node asked to wait, when it said. */
  readonly retryAfter: number | undefined;
  /** What failed, when the node gave no answer. */
  readonly cause: unknown;

  constructor(code: string, message: string, details: Record<string, unknown> = {}, retryAfter?: number, cause?: unknown) {
    super(503, code, message, details);
    this.name = 'UnavailableError';
    this.reason = code.toLowerCase();
    this.committed = code === 'TIMEOUT' || code === 'MIGRATING' ? false : 'unknown';
    this.retryAfter = retryAfter;
    this.cause = cause;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * The app's code and named fields. The node puts them in `details` as
 * `{ code, fields }`; an older node nests the app's error under `details.error`.
 * Positional payloads (`"0"`, `"1"`) are never read as fields (D63).
 */
function appErrorOf(details: Record<string, unknown>): { appCode: string; fields: Record<string, unknown> } {
  const source = typeof details.code === 'string' ? details : record(details.error);
  const appCode = typeof source.code === 'string' ? source.code : '';
  return { appCode, fields: { ...record(source.fields) } };
}

function retryAfterOf(details: Record<string, unknown>, header?: string | null): number | undefined {
  for (const candidate of [details.retryAfter, header == null ? undefined : Number(header)]) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) return candidate;
  }
  return undefined;
}

/**
 * The error for a refusal the node answered with `status` and `body` (its JSON
 * `{ error, message, details }`, or whatever it sent). The one place statuses
 * become typed errors.
 */
export function errorFrom(status: number, body: unknown, retryAfterHeader?: string | null): CalimeroError {
  const value = record(body);
  const code = typeof value.error === 'string' ? value.error : 'ERROR';
  const message = typeof value.message === 'string' ? value.message : '';
  const details = record(value.details);
  if (status === 503) return new UnavailableError(code, message, details, retryAfterOf(details, retryAfterHeader));
  switch (`${status} ${code}`) {
    case '401 UNAUTHENTICATED':
      return new LoginRequired(message, details);
    case '421 WRONG_NODE':
      return new WrongNode(message, details);
    case '404 NOT_FOUND':
      return new NotFound(message, details);
    case '409 IDEMPOTENCY_MISMATCH':
      return new IdempotencyMismatch(message, details);
    case '409 RELEASE_DEADLINE':
      return new ReleaseDeadlineError(message, details);
    case '409 CONSENT_STALE':
      return new ConsentStale(message, details);
    case '412 CONFIRM_REQUIRED':
      return new ConfirmRequired(message, details);
    case '413 ARGS_TOO_LARGE':
      return new ArgsTooLarge(message, details);
    case '422 APP_ERROR':
      return new AppError(message, details);
    case '422 TRAP':
      return new TrapError(message, details);
    default:
      return new CalimeroError(status, code, message, details);
  }
}
