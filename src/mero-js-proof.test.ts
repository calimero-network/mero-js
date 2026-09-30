import { describe, expect, it, vi } from 'vitest';

import { MeroJs } from './mero-js.js';

/**
 * The reachability the capability was missing.
 *
 * `createProofSigner` and the transport's `getProof` hook both shipped, and
 * nothing connected them to the object people construct — an app would have had
 * to bypass `MeroJs` and build a transport by hand. These pin that the config
 * option reaches the wire.
 */
describe('MeroJs requestProof', () => {
  const keys = {
    // core's own fixture chain, so this is a real credential rather than a
    // shape that only has to satisfy a mock.
    credential: '028a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c0000000004cfa21629a77f8cd8ddd3f821ed514009a9f572b2ce8e0a11f5cbb5e25340b09aeef190d5865e90861a94ec2e0b28de56ff7412f13806ff78322eb2d7a7d71d17cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080ce09090909090909090909090909090909090909090909090909090909090909090000000000000000ffb06b89ad31e732ed1bbec65b9d9c0ba1aead6faa37850432387b56dd69278670f6bb57b945ebe1a83997761ede1faed02bd0e37c7a7f3fbbdf934c14bbbb0e',
    signerSecret: '65'.repeat(32),
  };

  it('sends no proof header when the option is absent', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const mero = new MeroJs({ baseUrl: 'https://relay.example' });
    await mero.admin.getContexts().catch(() => undefined);

    const headers = fetchMock.mock.calls[0]?.[1]?.headers ?? {};
    expect(headers['X-Calimero-Proof']).toBeUndefined();
    vi.unstubAllGlobals();
  });

  /**
   * A caller whose key lives somewhere the SDK cannot reach — a hardware token,
   * a worker — passes its own signer. This is the shape that keeps the key out
   * of the SDK entirely, so it matters that it is honoured.
   */
  it('uses a caller-supplied signer verbatim', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const signer = vi.fn().mockResolvedValue('deadbeef');
    const mero = new MeroJs({
      baseUrl: 'https://relay.example',
      requestProof: signer,
    });
    await mero.admin.getContexts().catch(() => undefined);

    expect(signer).toHaveBeenCalledOnce();
    const req = signer.mock.calls[0][0];
    expect(req.method).toBe('GET');
    expect(req.path.startsWith('/admin-api/')).toBe(true);

    const headers = fetchMock.mock.calls[0]?.[1]?.headers ?? {};
    expect(headers['X-Calimero-Proof']).toBe('deadbeef');
    vi.unstubAllGlobals();
  });

  it('mints proofs itself when given keys', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const mero = new MeroJs({
      baseUrl: 'https://relay.example',
      requestProof: keys,
    });
    await mero.admin.getContexts().catch(() => undefined);

    const headers = fetchMock.mock.calls[0]?.[1]?.headers ?? {};
    // Not asserting the value — it carries a live timestamp. Asserting that a
    // proof was minted at all, which is what was unreachable.
    expect(headers['X-Calimero-Proof']).toMatch(/^[0-9a-f]+$/);
    vi.unstubAllGlobals();
  });
});
