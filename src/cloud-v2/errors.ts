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

/** `401 UNAUTHENTICATED`: sign in (again) and repeat the request. */
export class LoginRequired extends CalimeroError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(401, 'UNAUTHENTICATED', message, details);
    this.name = 'LoginRequired';
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
 * Any `503`, after the client's retries with the same idempotency key ran out.
 * `reason` is the node's code in lower case (`timeout`, `migrating`,
 * `unavailable`, ...).
 */
export class UnavailableError extends CalimeroError {
  readonly reason: string;
  readonly committed: Committed;
  /** Seconds the node asked to wait, when it said. */
  readonly retryAfter: number | undefined;

  constructor(code: string, message: string, details: Record<string, unknown> = {}, retryAfter?: number) {
    super(503, code, message, details);
    this.name = 'UnavailableError';
    this.reason = code.toLowerCase();
    this.committed = code === 'TIMEOUT' || code === 'MIGRATING' ? false : 'unknown';
    this.retryAfter = retryAfter;
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
    case '404 NOT_FOUND':
      return new NotFound(message, details);
    case '409 IDEMPOTENCY_MISMATCH':
      return new IdempotencyMismatch(message, details);
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
