import { describe, it, expect } from 'vitest';
import { classifyError } from './classify.js';
import { HTTPError } from '../http-client/index.js';

function httpError(status: number, error?: string): HTTPError {
  const body = error === undefined ? undefined : JSON.stringify({ error });
  return new HTTPError(status, 'Status', 'http://node/admin-api/x', new Headers(), body);
}

describe('classifyError', () => {
  it.each([
    [400, 'invalid', false],
    [401, 'unauthorized', true],
    [403, 'forbidden', false],
    [404, 'not-found', true],
    [409, 'conflict', false],
    [410, 'gone', false],
    [413, 'too-large', false],
    [422, 'invalid', false],
    [429, 'rate-limited', true],
    [500, 'server', true],
    [502, 'server', true],
    [503, 'unavailable', true],
    [504, 'unavailable', true],
    [0, 'unreachable', true],
  ] as const)('reads a %i as %s (retryable: %s)', (status, kind, retryable) => {
    expect(classifyError(httpError(status, 'no'))).toMatchObject({ kind, status, retryable });
  });

  // `message` on an HTTPError repeats the status line; a UI showing detail
  // wants what the node actually said.
  it("gives the node's explanation without the status prefix", () => {
    const err = httpError(409, 'invitation for group ab12 expired at 1759000000 (unix seconds)');
    expect(err.message).toBe(
      'HTTP 409 Status: invitation for group ab12 expired at 1759000000 (unix seconds)',
    );
    expect(classifyError(err).message).toBe(
      'invitation for group ab12 expired at 1759000000 (unix seconds)',
    );
  });

  it('falls back to the status line when the body said nothing', () => {
    expect(classifyError(httpError(500)).message).toBe('HTTP 500 Status');
  });

  it("reads a status-0 error's thrown text as its explanation", () => {
    const err = new HTTPError(0, 'Network Error', 'http://node/x', new Headers(), 'Failed to fetch');
    expect(classifyError(err)).toMatchObject({ kind: 'unreachable', message: 'Failed to fetch' });
  });

  it('reads an axios-style error by its response', () => {
    const err = { response: { status: 403, data: { error: 'not a member' } } };
    expect(classifyError(err)).toMatchObject({
      kind: 'forbidden',
      status: 403,
      retryable: false,
      message: 'not a member',
    });
  });

  it('reads a bare statusCode', () => {
    expect(classifyError({ statusCode: 413, message: 'too big' })).toMatchObject({
      kind: 'too-large',
      status: 413,
    });
  });

  it('treats a fetch that never connected as unreachable', () => {
    expect(classifyError(new TypeError('Failed to fetch'))).toMatchObject({
      kind: 'unreachable',
      status: undefined,
      retryable: true,
    });
  });

  it('keeps anything else retryable, with its message', () => {
    expect(classifyError(new Error('boom'))).toEqual({
      kind: 'unknown',
      status: undefined,
      retryable: true,
      message: 'boom',
    });
    expect(classifyError('plain text')).toMatchObject({ kind: 'unknown', message: 'plain text' });
    expect(classifyError(null)).toMatchObject({ kind: 'unknown', message: 'Request failed' });
  });
});
