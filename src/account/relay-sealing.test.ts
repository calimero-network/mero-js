// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const RELAY = 'https://node-x.relay.cloud.calimero.network';

/**
 * The sealed half: what `createAttestedSealedFetch` would answer, from inside
 * the TD, for each request. A test sets it; every call is recorded.
 */
const sealed = vi.hoisted(() => ({
  calls: [] as Request[],
  answer: (_request: Request): Promise<Response> => Promise.reject(new Error('unset')),
  baseUrls: [] as string[],
}));
vi.mock('../sealed/index.js', async (importActual) => ({
  ...(await importActual<typeof import('../sealed/index.js')>()),
  createAttestedSealedFetch: (options: { baseUrl: string }) => {
    sealed.baseUrls.push(options.baseUrl);
    return async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      sealed.calls.push(request);
      return sealed.answer(request);
    };
  },
}));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** The TD's own answer that it cannot guard this route sealed. */
const unguarded = () =>
  json({ error: { code: 'sealed_route_unguarded', message: 'the proxy guards this node' } }, 403);

let plain: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  const { forgetRelaySealing } = await import('./session.js');
  forgetRelaySealing();
  sealed.calls = [];
  sealed.baseUrls = [];
  plain = vi.fn(async () => json({ data: 'plain' }));
  vi.stubGlobal('fetch', plain);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('relayTransportFetch', () => {
  it('seals to a hosted relay and returns what the TD answered', async () => {
    const { relayTransportFetch } = await import('./session.js');
    sealed.answer = async () => json({ data: 'sealed' });
    const fetch = relayTransportFetch(RELAY)!;

    const response = await fetch(`${RELAY}/admin-api/contexts`, { headers: { authorization: 'Bearer t' } });
    await expect(response.json()).resolves.toEqual({ data: 'sealed' });
    expect(sealed.baseUrls).toEqual([RELAY]);
    expect(plain).not.toHaveBeenCalled();
  });

  it('is one transport per relay, so its sealed session is shared', async () => {
    const { relayTransportFetch } = await import('./session.js');
    expect(relayTransportFetch(RELAY)).toBe(relayTransportFetch(`${RELAY}/`));
    expect(sealed.baseUrls).toHaveLength(1);
  });

  it('leaves a loopback relay, a dev rig answering mock quotes, on the global fetch', async () => {
    const { relayTransportFetch } = await import('./session.js');
    expect(relayTransportFetch('http://localhost:2428')).toBeUndefined();
    expect(relayTransportFetch('http://127.0.0.1:2428')).toBeUndefined();
  });

  // A relay without `forward_auth` cannot guard a logged-in route sealed and
  // says so from inside the TD. Only that answer sends the request plain, and
  // logged-in calls after it skip the refused round trip.
  it('sends a logged-in call plain only when the TD says it cannot guard it sealed', async () => {
    const { relayTransportFetch } = await import('./session.js');
    sealed.answer = async (request) =>
      request.headers.has('authorization') || new URL(request.url).pathname.startsWith('/auth/')
        ? unguarded()
        : json({ data: 'sealed' });
    const fetch = relayTransportFetch(RELAY)!;

    const read = await fetch(`${RELAY}/admin-api/contexts`, {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: '{"x":1}',
    });
    await expect(read.json()).resolves.toEqual({ data: 'plain' });
    expect(plain).toHaveBeenCalledTimes(1);
    const resent = plain.mock.calls[0]![0] as Request;
    expect(resent.method).toBe('POST');
    expect(resent.headers.get('authorization')).toBe('Bearer t');
    await expect(resent.text()).resolves.toBe('{"x":1}');

    // Learned: the next logged-in call and the next login go plain at once.
    await fetch(`${RELAY}/admin-api/namespaces`, { headers: { authorization: 'Bearer t' } });
    await fetch(`${RELAY}/auth/token`, { method: 'POST', body: '{}' });
    expect(sealed.calls).toHaveLength(1);
    expect(plain).toHaveBeenCalledTimes(3);

    // An intent carries its own credential and stays sealed.
    const intent = await fetch(`${RELAY}/admin-api/contexts/${'ab'.repeat(32)}/intents`, {
      method: 'POST',
      body: '{}',
    });
    await expect(intent.json()).resolves.toEqual({ data: 'sealed' });
    expect(sealed.calls).toHaveLength(2);
  });

  it('returns any other refusal as it is, never plain', async () => {
    const { relayTransportFetch } = await import('./session.js');
    sealed.answer = async () => json({ error: { code: 'permission_denied' } }, 403);
    const fetch = relayTransportFetch(RELAY)!;

    const response = await fetch(`${RELAY}/admin-api/contexts`, { headers: { authorization: 'Bearer t' } });
    expect(response.status).toBe(403);
    expect(plain).not.toHaveBeenCalled();
  });

  // Whoever sits on the way can drop the envelope or fail the attestation; if
  // that sent the request plain, they could force every request into the clear.
  it('fails the request when sealing fails, and never sends it plain', async () => {
    const { relayTransportFetch } = await import('./session.js');
    sealed.answer = async () => {
      throw new Error("the relay's quote did not verify");
    };
    const fetch = relayTransportFetch(RELAY)!;

    await expect(fetch(`${RELAY}/auth/token`, { method: 'POST', body: '{}' })).rejects.toThrow(/did not verify/);
    expect(plain).not.toHaveBeenCalled();
  });
});
