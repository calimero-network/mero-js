/**
 * The runtime's `Transport` interface on its own, as a generated route layer
 * would use it: against a stand-in cloud node on a real local HTTP server
 * (mock attestation, the sealed handshake, sealed and streamed answers).
 * Synthetic data only.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { StandInNode, type Reply } from '../../tests/support/stand-in-node.js';
import { CalimeroClient } from '../client/calimero-client.js';
import {
  CalimeroError,
  ConfirmRequired,
  NodeTransport,
  NotFound,
  UnavailableError,
  queryString,
  routePath,
  type PasskeyProvider,
  type Transport,
} from './index.js';

const node = new StandInNode();
beforeAll(() => node.start());
afterAll(() => node.stop());
beforeEach(() => {
  node.requests.length = 0;
  node.answer = () => ({ status: 200, json: {} });
});

const transport = () => new NodeTransport({ baseUrl: node.url, policy: { allowMock: true }, retry: { baseDelayMs: 1 } });
const refused = (status: number, error: string, details?: Record<string, unknown>): Reply => ({
  status,
  json: { error, message: `${error.toLowerCase()} (stand-in)`, ...(details ? { details } : {}) },
});
const failure = (p: Promise<unknown>) => p.then(() => undefined, (e: unknown) => e);
const header = (i: number, name: string) => node.requests[i].head.headers.find(([n]) => n.toLowerCase() === name)?.[1];
const passkey: PasskeyProvider = {
  create: async () => ({ attestationObject: '', clientDataJson: '' }),
  get: async () => ({ credentialId: 'cred', authenticatorData: 'ad', clientDataJson: 'cd', signature: 'sig' }),
};

describe('routePath and queryString', () => {
  it('fills a template with encoded segments, so an id cannot reach another route', () => {
    expect(routePath('apps/{app}/blobs/{id}', { app: 'a/../b', id: 7 })).toBe('apps/a%2F..%2Fb/blobs/7');
    expect(() => routePath('orgs/{org}', {})).toThrow(/org/);
  });

  it('encodes a query, repeating arrays and leaving out undefined and null', () => {
    expect(queryString({ from: 0, tag: ['a b', 'c&d'], none: undefined, nil: null, ok: true })).toBe(
      '?from=0&tag=a+b&tag=c%26d&ok=true',
    );
    expect(queryString({ none: undefined })).toBe('');
    expect(queryString(undefined)).toBe('');
  });
});

describe('Transport.request / json', () => {
  it('sends method, path and query over the sealed channel with the credential held now', async () => {
    node.answer = () => ({ status: 200, json: { appId: 'app-1' } });
    const t = transport();
    t.useApiKey('key-1');
    const answer = await t.json<{ appId: string }>('GET', '/apps/app-1', { query: { verbose: true } });
    expect(answer).toEqual({ appId: 'app-1' });
    expect(node.requests[0].head.method).toBe('GET');
    expect(node.requests[0].head.path).toBe('/apps/app-1?verbose=true');
    expect(header(0, 'authorization')).toBe('Bearer key-1');
  });

  it('sends a JSON body, and answers {} for an empty one', async () => {
    node.answer = () => ({ status: 200, bytes: new Uint8Array(), contentType: 'application/json' });
    const answer = await transport().json('POST', 'orgs', { body: { name: 'acme' } });
    expect(answer).toEqual({});
    expect(node.requests[0].body).toEqual({ name: 'acme' });
    expect(header(0, 'content-type')).toBe('application/json');
  });

  it('sends a raw body as its content type, and answers the response unread', async () => {
    node.answer = () => ({ status: 200, bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' });
    const response = await transport().request('POST', 'apps/app-1/blobs', {
      bytes: new Uint8Array([9]),
      contentType: 'image/png',
    });
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(header(0, 'content-type')).toBe('image/png');
  });

  it('throws a refusal as the typed error its code names', async () => {
    node.answer = () => refused(404, 'NOT_FOUND');
    const error = await failure(transport().request('GET', 'apps/nope'));
    expect(error).toBeInstanceOf(NotFound);
    expect(error).toBeInstanceOf(CalimeroError);
    expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});

describe('the 412 step-up', () => {
  const challenge = { challengeId: 'c-1', challenge: 'AAEC', rpId: 'localhost' };

  it('answers CONFIRM_REQUIRED with the passkey and sends the same body again with confirm', async () => {
    node.answer = (_, body) => (body.confirm ? { status: 200, json: { ok: true } } : refused(412, 'CONFIRM_REQUIRED', challenge));
    const answer = await transport().json('DELETE', 'orgs/o-1', { body: { reason: 'x' }, passkey });
    expect(answer).toEqual({ ok: true });
    expect(node.requests.map((r) => r.head.method)).toEqual(['DELETE', 'DELETE']);
    expect(node.requests[1].body).toMatchObject({ reason: 'x', confirm: { challengeId: 'c-1', assertion: { credentialId: 'cred' } } });
  });

  it('without a passkey, is ConfirmRequired carrying the challenge', async () => {
    node.answer = () => refused(412, 'CONFIRM_REQUIRED', challenge);
    const error = await failure(transport().json('DELETE', 'orgs/o-1', { body: {} }));
    expect(error).toBeInstanceOf(ConfirmRequired);
    expect((error as ConfirmRequired).details).toMatchObject(challenge);
  });
});

describe('D70 retries', () => {
  it('retry: true sends a 503 again until it is answered', async () => {
    let n = 0;
    node.answer = () => (++n < 3 ? refused(503, 'UNAVAILABLE') : { status: 200, json: { index: 1 } });
    const answer = await transport().json('POST', 'apps/app-1/intents', { body: { idempotencyKey: 'k' }, retry: true });
    expect(answer).toEqual({ index: 1 });
    expect(node.requests).toHaveLength(3);
    expect(new Set(node.requests.map((r) => r.body.idempotencyKey))).toEqual(new Set(['k']));
  });

  it('without retry, a 503 is sent once', async () => {
    node.answer = () => refused(503, 'UNAVAILABLE');
    const error = await failure(transport().json('POST', 'apps/app-1/intents', { body: {} }));
    expect(error).toBeInstanceOf(UnavailableError);
    expect(node.requests).toHaveLength(1);
  });
});

describe('Transport.events', () => {
  it('decodes server-sent events from a sealed stream', async () => {
    node.answer = () => ({
      status: 200,
      events: ['id: 1\nevent: committed\ndata: {"index":1}\n\n', 'event: note\ndata: plain\n\n'],
    });
    const abort = new AbortController();
    const seen: unknown[] = [];
    for await (const event of transport().events('apps/app-1/events', { query: { from: 0 }, signal: abort.signal })) {
      seen.push(event);
      if (seen.length === 2) break;
    }
    abort.abort();
    expect(seen).toEqual([
      { id: '1', kind: 'committed', data: { index: 1 } },
      { id: '', kind: 'note', data: 'plain' },
    ]);
    expect(node.requests[0].head.path).toBe('/apps/app-1/events?from=0');
  });
});

describe('a route layer of its own shares the client', () => {
  it("sends through client.transport with the client's session, refreshed on a 401", async () => {
    const client = new CalimeroClient({ baseUrl: node.url, policy: { allowMock: true } });
    client.useSession({ accountId: 'acc', sessionToken: 'old', expiresAt: 0, refreshToken: 'r-1' });
    node.answer = (head, body) => {
      if (head.path === '/auth/refresh') {
        return { status: 200, json: { accountId: 'acc', sessionToken: 'new', expiresAt: 1, refreshToken: body.refreshToken === 'r-1' ? 'r-2' : 'x' } };
      }
      const auth = head.headers.find(([n]) => n.toLowerCase() === 'authorization')?.[1];
      return auth === 'Bearer new' ? { status: 200, json: { me: 'acc' } } : refused(401, 'UNAUTHENTICATED');
    };
    const routes: Transport = client.transport;
    expect(await routes.json('GET', 'auth/me')).toEqual({ me: 'acc' });
    expect(client.session?.sessionToken).toBe('new');
    expect(node.requests.map((r) => r.head.path)).toEqual(['/auth/me', '/auth/refresh', '/auth/me']);
  });

  it('a client made from a transport uses it', async () => {
    const t = transport();
    const client = new CalimeroClient(t);
    expect(client.transport).toBe(t);
    client.useApiKey('key-2');
    await client.auth.me();
    expect(header(0, 'authorization')).toBe('Bearer key-2');
  });
});
