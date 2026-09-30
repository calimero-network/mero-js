import { describe, it, expect, vi } from 'vitest';

import { WebHttpClient } from './web-client.js';
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
   * The signature covers the path alone. Signing the query too would fail every
   * request that has one, and the node would report it as a bad signature —
   * which points at the key, not at the string that was signed.
   */
  it('signs the path without the query string', async () => {
    const getProof = vi.fn().mockResolvedValue('aa');
    const { client } = clientWith(getProof);

    await client.request('/admin-api/blobs/blob-1?context_id=ctx-1');

    expect(getProof.mock.calls[0][0].path).toBe('/admin-api/blobs/blob-1');
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
