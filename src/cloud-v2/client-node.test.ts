/**
 * CalimeroClient against a stand-in cloud node on a real local HTTP server,
 * through the real global `fetch`: mock attestation, the sealed handshake and
 * sealed, streamed answers, as core's cloud node speaks them. Synthetic data only.
 *
 * Covers the mapping of every refusal the node sends to the client's typed
 * errors (D64, D70). The abort test is in `events-abort.test.ts`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { StandInCloudNode, type Reply } from '../../tests/cloud-v2/stand-in-node.js';
import {
  AppError,
  ArgsTooLarge,
  CalimeroClient,
  CalimeroError,
  ConfirmCancelled,
  ConfirmRequired,
  IdempotencyMismatch,
  LoginRequired,
  NotFound,
  TrapError,
  UnavailableError,
  type Committed,
} from './index.js';
import type { PasskeyProvider } from './passkey.js';

const node = new StandInCloudNode();
beforeAll(() => node.start());
afterAll(() => node.stop());
beforeEach(() => {
  node.requests.length = 0;
  node.answer = () => ({ status: 200, json: {} });
});

const client = () =>
  new CalimeroClient({ baseUrl: node.url, policy: { allowMock: true }, retry: { baseDelayMs: 1 } });
const refused = (status: number, error: string, details?: Record<string, unknown>): Reply => ({
  status,
  json: { error, message: `${error.toLowerCase()} (stand-in)`, ...(details ? { details } : {}) },
});
const failure = (p: Promise<unknown>) => p.then(() => undefined, (e: unknown) => e);
const intents = () => node.requests.filter((r) => r.head.path === '/apps/app-1/intents');


describe('refusals map to typed errors in one place (D64)', () => {
  it('401 UNAUTHENTICATED is LoginRequired', async () => {
    node.answer = () => refused(401, 'UNAUTHENTICATED');
    const error = await failure(client().view('app-1', 'availability', {}));
    expect(error).toBeInstanceOf(LoginRequired);
    expect(error).toBeInstanceOf(CalimeroError);
    expect(error).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  });

  it('404 NOT_FOUND is NotFound', async () => {
    node.answer = () => refused(404, 'NOT_FOUND');
    const error = await failure(client().call('app-1', 'book', {}));
    expect(error).toBeInstanceOf(NotFound);
    expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('412 CONFIRM_REQUIRED is answered with the passkey and the call retried', async () => {
    const challenge = { challengeId: 'c-1', challenge: 'AAEC', rpId: 'localhost' };
    node.answer = (_, body) =>
      body.confirm ? { status: 200, json: { index: 7, result: 'ok', events: [] } } : refused(412, 'CONFIRM_REQUIRED', challenge);
    const passkey: PasskeyProvider = {
      create: async () => ({ attestationObject: '', clientDataJson: '' }),
      get: async () => ({ credentialId: 'cred', authenticatorData: 'ad', clientDataJson: 'cd', signature: 'sig' }),
    };
    const answer = await client().callConfirmed('app-1', 'adminRelease', { id: 'b1' }, passkey);
    expect(answer.result).toBe('ok');
    const [first, second] = intents();
    expect(second.body.confirm).toEqual({ challengeId: 'c-1', assertion: expect.objectContaining({ signature: 'sig' }) });
    expect(second.body.idempotencyKey).toBe(first.body.idempotencyKey);
  });

  it('412 CONFIRM_REQUIRED without a passkey is ConfirmRequired, carrying the challenge', async () => {
    node.answer = () => refused(412, 'CONFIRM_REQUIRED', { challengeId: 'c-1', challenge: 'AAEC', rpId: 'localhost' });
    const error = await failure(client().call('app-1', 'adminRelease', {}));
    expect(error).toBeInstanceOf(ConfirmRequired);
    expect(error).toMatchObject({ code: 'CONFIRM_REQUIRED', details: { challengeId: 'c-1' } });
  });

  it('412 CONFIRM_REQUIRED the user declines is ConfirmCancelled, and nothing more is sent', async () => {
    node.answer = () => refused(412, 'CONFIRM_REQUIRED', { challengeId: 'c-1', challenge: 'AAEC', rpId: 'localhost' });
    const declined = Object.assign(new Error('The operation either timed out or was not allowed.'), { name: 'NotAllowedError' });
    const passkey: PasskeyProvider = {
      create: async () => ({ attestationObject: '', clientDataJson: '' }),
      get: async () => {
        throw declined;
      },
    };
    const error = await failure(client().callConfirmed('app-1', 'adminRelease', {}, passkey));
    expect(error).toBeInstanceOf(ConfirmCancelled);
    expect((error as ConfirmCancelled).cause).toBe(declined);
    expect(intents()).toHaveLength(1);
  });

  it('413 ARGS_TOO_LARGE is ArgsTooLarge', async () => {
    node.answer = () => refused(413, 'ARGS_TOO_LARGE');
    const error = await failure(client().call('app-1', 'book', {}));
    expect(error).toBeInstanceOf(ArgsTooLarge);
    expect(error).toMatchObject({ status: 413, code: 'ARGS_TOO_LARGE' });
  });

  it('409 IDEMPOTENCY_MISMATCH is IdempotencyMismatch, and other 409s are not', async () => {
    node.answer = () => refused(409, 'IDEMPOTENCY_MISMATCH');
    expect(await failure(client().call('app-1', 'book', {}, 'k-1'))).toBeInstanceOf(IdempotencyMismatch);
    for (const code of ['CONFLICT', 'NOT_INSTALLED']) {
      node.answer = () => refused(409, code);
      const error = await failure(client().call('app-1', 'book', {}, 'k-1'));
      expect(error).not.toBeInstanceOf(IdempotencyMismatch);
      expect(error).toMatchObject({ name: 'CalimeroError', status: 409, code });
    }
  });

  it('422 APP_ERROR is AppError with the app code and its named fields', async () => {
    node.answer = () => refused(422, 'APP_ERROR', { index: 4, code: 'Taken', fields: { start: '1800000000000' } });
    const error = await failure(client().call('app-1', 'book', {}));
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ status: 422, code: 'APP_ERROR', appCode: 'Taken', fields: { start: '1800000000000' } });
  });

  it('422 TRAP is TrapError with its kind', async () => {
    node.answer = () => refused(422, 'TRAP', { index: 4, kind: 'OutOfFuel', detail: 'fuel' });
    const error = await failure(client().call('app-1', 'book', {}));
    expect(error).toBeInstanceOf(TrapError);
    expect(error).toMatchObject({ status: 422, code: 'TRAP', kind: 'OutOfFuel' });
  });

  it('any other status and code is a plain CalimeroError carrying both', async () => {
    node.answer = () => refused(403, 'FORBIDDEN');
    const error = await failure(client().call('app-1', 'book', {}));
    expect(error).toMatchObject({ name: 'CalimeroError', status: 403, code: 'FORBIDDEN' });
    expect(Object.getPrototypeOf(error)).toBe(CalimeroError.prototype);
  });

  it('an event stream refusal is mapped the same way', async () => {
    node.answer = () => refused(401, 'UNAUTHENTICATED');
    const error = await failure(client().events('app-1').next());
    expect(error).toBeInstanceOf(LoginRequired);
  });
});

describe('503s are retried with the same key, then UnavailableError (D70)', () => {
  const cases: Array<[string, Record<string, unknown> | undefined, string, Committed, number | undefined]> = [
    ['TIMEOUT', { retryAfter: 0.001 }, 'timeout', false, 0.001],
    ['MIGRATING', { retryAfter: 0.002 }, 'migrating', false, 0.002],
    ['UNAVAILABLE', undefined, 'unavailable', 'unknown', undefined],
  ];

  it.each(cases)('503 %s: 1 + 3 attempts with one key, then reason and committed', async (code, details, reason, committed, retryAfter) => {
    node.answer = () => refused(503, code, details);
    const error = await failure(client().call('app-1', 'book', { roomId: 'r1' }, 'caller-key'));
    expect(error).toBeInstanceOf(UnavailableError);
    expect(error).toMatchObject({ status: 503, code, reason, committed, retryAfter });
    expect(intents().map((r) => r.body.idempotencyKey)).toEqual(Array(4).fill('caller-key'));
  });

  it('a call without a key gets one before the first attempt; a 503 then success sends it both times', async () => {
    let attempts = 0;
    node.answer = () =>
      ++attempts === 1 ? refused(503, 'UNAVAILABLE') : { status: 200, json: { index: 3, result: 'b1', events: [] } };
    const answer = await client().call('app-1', 'book', { roomId: 'r1' });
    expect(answer.result).toBe('b1');
    const keys = intents().map((r) => r.body.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(typeof keys[0]).toBe('string');
    expect((keys[0] as string).length).toBeGreaterThan(0);
    expect(keys[1]).toBe(keys[0]);
  });

  it('a non-503 refusal is final: sent once', async () => {
    node.answer = () => refused(422, 'APP_ERROR', { code: 'Taken', fields: {} });
    await failure(client().call('app-1', 'book', {}, 'k-1'));
    expect(intents()).toHaveLength(1);
  });

  it('a view retries a 503 too', async () => {
    let attempts = 0;
    node.answer = () => (++attempts < 3 ? refused(503, 'UNAVAILABLE') : { status: 200, json: { index: 1, result: [] } });
    expect((await client().view('app-1', 'availability', {})).result).toEqual([]);
    expect(attempts).toBe(3);
  });
});
