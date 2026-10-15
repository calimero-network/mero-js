import { describe, it, expect, vi } from 'vitest';

import { WebHttpClient, HTTPError } from './web-client.js';
import { Transport } from './http-types.js';

const ok = () =>
  new Response(JSON.stringify({ data: 1 }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

function clientWith(getProof?: Transport['getProof'], baseUrl = 'https://relay.example') {
  const fetchMock = vi.fn().mockResolvedValue(ok());
  const transport: Transport = { fetch: fetchMock, baseUrl, getProof };
  return { client: new WebHttpClient(transport), fetchMock };
}

const headersOf = (fetchMock: ReturnType<typeof vi.fn>): Record<string, string> =>
  fetchMock.mock.calls[0][1].headers as Record<string, string>;

describe('request-carried proof on the transport', () => {
  it('sends no proof header when none is configured', async () => {
    const { client, fetchMock } = clientWith(undefined);
    await client.request('/admin-api/contexts');
    expect(headersOf(fetchMock)['X-Calimero-Proof']).toBeUndefined();
  });

  it('signs the method, the path and the body actually sent', async () => {
    const getProof = vi.fn().mockResolvedValue('deadbeef');
    const { client, fetchMock } = clientWith(getProof);

    await client.request('/admin-api/contexts/ctx-1/intents', {
      method: 'POST',
      body: '{"a":1}',
    });

    expect(getProof).toHaveBeenCalledWith({
      method: 'POST',
      path: '/admin-api/contexts/ctx-1/intents',
      body: '{"a":1}',
    });
    expect(headersOf(fetchMock)['X-Calimero-Proof']).toBe('deadbeef');
  });

  /**
   * The query can name the object a request acts on, so it is signed exactly as
   * `fetch` puts it on the request line: order and escapes kept.
   */
  it('signs the path and query as they are sent', async () => {
    const getProof = vi.fn().mockResolvedValue('aa');
    const { client } = clientWith(getProof);

    await client.request('/admin-api/blobs/blob-1?hash=h&context_id=a%2Fb c');

    expect(getProof.mock.calls[0][0].path).toBe(
      '/admin-api/blobs/blob-1?hash=h&context_id=a%2Fb%20c',
    );
  });

  /**
   * Browsers keep a bare trailing `?` on the request line and Node's fetch drops
   * it, so the client drops it once and signs and fetches the same string.
   */
  it('drops only a bare ? before signing and fetching', async () => {
    for (const [requested, fetched, signed] of [
      ['/x?', '/x', '/x'],
      ['/x?q=what?', '/x?q=what?', '/x?q=what?'],
      ['/x??', '/x??', '/x??'],
      ['/x?#frag', '/x#frag', '/x'],
    ]) {
      const getProof = vi.fn().mockResolvedValue('aa');
      const { client, fetchMock } = clientWith(getProof);

      await client.request(requested);

      expect(fetchMock.mock.calls[0][0], requested).toBe(`https://relay.example${fetched}`);
      expect(getProof.mock.calls[0][0].path, requested).toBe(signed);
    }
  });

  /**
   * A base URL may contribute a prefix, and the node verifies against the path
   * it received — so the signed path has to come from the URL being fetched,
   * not from the argument passed in.
   */
  it('signs the prefix a base URL contributes', async () => {
    const getProof = vi.fn().mockResolvedValue('aa');
    const { client } = clientWith(getProof, 'https://relay.example/node-7');

    await client.request('/admin-api/contexts');

    expect(getProof.mock.calls[0][0].path).toBe('/node-7/admin-api/contexts');
  });

  it('still sends the request when the signer declines', async () => {
    // A client that only sometimes holds a key stays usable: no proof, no
    // header, and whatever other credential it has still applies.
    const { client, fetchMock } = clientWith(vi.fn().mockResolvedValue(undefined));
    await client.request('/admin-api/contexts');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(headersOf(fetchMock)['X-Calimero-Proof']).toBeUndefined();
  });
});

describe('a request carrying a proof', () => {
  const redirectOf = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls[0][1].redirect;

  const redirected = () =>
    new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/x' } });

  // What a browser hands back for redirect: 'manual': nothing readable.
  const opaqueRedirect = () =>
    ({
      ok: false,
      status: 0,
      statusText: '',
      type: 'opaqueredirect',
      headers: new Headers(),
      text: async () => '',
    }) as unknown as Response;

  function authorizingClient(fetchMock: ReturnType<typeof vi.fn>) {
    return new WebHttpClient({
      fetch: fetchMock,
      baseUrl: 'https://relay.example',
      authorizeRequest: async () => ({ 'X-Calimero-Proof': 'aa' }),
    });
  }

  it('is issued without following redirects', async () => {
    const { client, fetchMock } = clientWith(vi.fn().mockResolvedValue('aa'));
    await client.request('/admin-api/contexts');
    expect(redirectOf(fetchMock)).toBe('manual');
  });

  it('is issued without following redirects when an authorizer supplied the proof', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    await authorizingClient(fetchMock).request('/admin-api/contexts');
    expect(redirectOf(fetchMock)).toBe('manual');
  });

  it('keeps an explicit redirect: error', async () => {
    const { client, fetchMock } = clientWith(vi.fn().mockResolvedValue('aa'));
    await client.request('/admin-api/contexts', { redirect: 'error' });
    expect(redirectOf(fetchMock)).toBe('error');
  });

  it('does not let redirect: follow carry the proof to another origin', async () => {
    const { client, fetchMock } = clientWith(vi.fn().mockResolvedValue('aa'));
    await client.request('/admin-api/contexts', { redirect: 'follow' });
    expect(redirectOf(fetchMock)).toBe('manual');
  });

  it.each([
    ['a 3xx response', redirected],
    ['an opaque redirect', opaqueRedirect],
  ])('surfaces %s as an error naming the proof and is not re-sent', async (_name, response) => {
    const { client, fetchMock } = clientWith(vi.fn().mockResolvedValue('aa'));
    fetchMock.mockResolvedValue(response());

    const err = await client.request('/admin-api/contexts').catch((e) => e);

    expect(err).toBeInstanceOf(HTTPError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/redirect/i);
    expect(err.message).toMatch(/X-Calimero-Proof/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('surfaces a redirect to an authorizer-signed request the same way', async () => {
    const fetchMock = vi.fn().mockResolvedValue(redirected());
    const err = await authorizingClient(fetchMock).request('/admin-api/contexts').catch((e) => e);
    expect(err).toBeInstanceOf(HTTPError);
    expect(err.message).toMatch(/X-Calimero-Proof/);
  });
});

describe('a request carrying no proof', () => {
  it('leaves redirect handling to the caller and the platform', async () => {
    const { client, fetchMock } = clientWith(vi.fn().mockResolvedValue(undefined));
    await client.request('/admin-api/contexts');
    expect(fetchMock.mock.calls[0][1].redirect).toBeUndefined();
  });

  it('keeps an explicit redirect: follow', async () => {
    const { client, fetchMock } = clientWith(undefined);
    await client.request('/admin-api/contexts', { redirect: 'follow' });
    expect(fetchMock.mock.calls[0][1].redirect).toBe('follow');
  });

  it('reports a redirect as a plain HTTP error', async () => {
    const { client, fetchMock } = clientWith(undefined);
    fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { location: '/x' } }));
    const err = await client.request('/admin-api/contexts').catch((e) => e);
    expect(err).toBeInstanceOf(HTTPError);
    expect(err.message).not.toMatch(/X-Calimero-Proof/);
  });
});
