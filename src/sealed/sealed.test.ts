import { describe, expect, it, vi } from 'vitest';

import { fromHex, fromHexUnsized, hex } from '../crypto/internal.js';
import {
  SEALED_CONTENT_TYPE,
  SealedTransportError,
  StaleTransportKeyError,
  createSealedFetch,
  fetchAttestedTransportKey,
  sealRequest,
  transportKeyBinding,
  type RequestHead,
} from './sealed.js';

// Core's published vectors (`crates/server/src/sealed/tests.rs` and
// `crates/tee-attestation/src/generate.rs`), repeated verbatim: the node and
// this client are separate implementations of one wire format.
const TRANSPORT_PUBLIC_VECTOR = '0faa684ed28867b97f4a6a2dee5df8ce974e76b7018e3f22a1c4cf2678570f20';
const SEALED_REQUEST_VECTOR =
  '010faa684ed28867b97f4a6a2dee5df8ce974e76b7018e3f22a1c4cf2678570f20' +
  '7b0d47d93427f8311160781c7c733fd89f88970aef490d8aa0ee19a4cb8a1b14444444444444444444444444' +
  '42085b2ea7f498345db1128aaf8d1d7ce8c97845c231098d87138a0f61ed2b2428005101caf5f07843bb12ea5a82' +
  '54ec07b049d4131bc1e4ad5a21f06efbb8862f297519d2601228d1301ce50306cfb30dd7f854c54f64b2848919c9' +
  'b493dcc57ba710df763b7f5978be9a255036cf2388a9776d1f36b57575';
const SEALED_RESPONSE_VECTOR =
  '01666666666666666666666666ca7eba7d5d7435fe4ae2e3dc7e69037a8ee4' +
  '1a3f2fdbb01cd701f9e6d3f54ad2d9ab8fd688219b29b1e405692da8af400a01fa636a8c9da9db7323ac28df6bad' +
  '29dff31e0743f635f0030a7452d640307cf692c021b435c7c5fd5ffdb1';
const TRANSPORT_BINDING_VECTOR = '30274595433e8afc5d4035e30a2b599d93caf0d470867527f13dc6af92fa12a8';

const transportKey = fromHex(TRANSPORT_PUBLIC_VECTOR, 'transport', 32);
const fixed = { clientSecret: new Uint8Array(32).fill(0x33), nonce: new Uint8Array(12).fill(0x44) };
const vectorHead: RequestHead = {
  method: 'POST',
  path: '/jsonrpc',
  headers: [['content-type', 'application/json']],
  ts: 1_700_000_000,
};

describe('sealed transport wire format', () => {
  it('seals a request exactly as the node expects', async () => {
    const exchange = await sealRequest(transportKey, vectorHead, new TextEncoder().encode('{}'), fixed);
    expect(hex(exchange.envelope)).toBe(SEALED_REQUEST_VECTOR);
  });

  it('opens a response the node sealed', async () => {
    const exchange = await sealRequest(transportKey, vectorHead, new TextEncoder().encode('{}'), fixed);
    const opened = await exchange.open(fromHexUnsized(SEALED_RESPONSE_VECTOR, 'response'));
    expect(opened.head).toEqual({ status: 200, headers: [['content-type', 'application/json']] });
    expect(new TextDecoder().decode(opened.body)).toBe('{"ok":true}');
  });

  it('refuses a response that anyone but the node sealed', async () => {
    const exchange = await sealRequest(transportKey, vectorHead, new Uint8Array(), fixed);
    const forged = fromHexUnsized(SEALED_RESPONSE_VECTOR, 'response');
    forged[forged.length - 1] ^= 1;
    await expect(exchange.open(forged)).rejects.toThrow(/did not open/);
  });

  it('computes the transport binding the node puts in its quote', async () => {
    const binding = await transportKeyBinding(new Uint8Array(32).fill(0x11), new Uint8Array(32).fill(0x22));
    expect(hex(binding)).toBe(TRANSPORT_BINDING_VECTOR);
  });
});

describe('createSealedFetch', () => {
  const baseUrl = 'https://tee-node.example/node';

  it('sends only an opaque envelope to the sealed endpoint', async () => {
    const carrier = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'x', message: 'refused' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const sealedFetch = createSealedFetch({ baseUrl, transportPublicKey: transportKey, fetch: carrier });

    await expect(
      sealedFetch(`${baseUrl}/jsonrpc?x=1`, {
        method: 'POST',
        headers: { authorization: 'Bearer secret-token' },
        body: '{"method":"secret-call"}',
      }),
    ).rejects.toBeInstanceOf(SealedTransportError);

    const [url, init] = carrier.mock.calls[0];
    expect(url).toBe('https://tee-node.example/node/sealed/v1');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': SEALED_CONTENT_TYPE });
    const wire = new TextDecoder('latin1').decode(init.body as Uint8Array);
    expect(wire).not.toContain('secret-token');
    expect(wire).not.toContain('secret-call');
    expect(wire).not.toContain('jsonrpc');
  });

  it('tells the caller to attest again when the node restarted', async () => {
    const carrier = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'stale_transport_key', message: 'stale' } }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const sealedFetch = createSealedFetch({ baseUrl, transportPublicKey: transportKey, fetch: carrier });
    await expect(sealedFetch(`${baseUrl}/admin-api/contexts`)).rejects.toBeInstanceOf(
      StaleTransportKeyError,
    );
  });

  it('never sends a request outside the node in the clear', async () => {
    const carrier = vi.fn();
    const sealedFetch = createSealedFetch({ baseUrl, transportPublicKey: transportKey, fetch: carrier });
    await expect(sealedFetch('https://elsewhere.example/node/jsonrpc')).rejects.toThrow(/Refusing/);
    await expect(sealedFetch('https://tee-node.example/other/jsonrpc')).rejects.toThrow(/Refusing/);
    expect(carrier).not.toHaveBeenCalled();
  });
});

/** A stand-in node: opens the envelope with the transport secret and answers. */
async function standInNode(
  envelope: Uint8Array,
  answer: (head: RequestHead, body: string) => { status: number; headers: Array<[string, string]>; body: string },
): Promise<Response> {
  const pkcs8 = new Uint8Array([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
    ...new Uint8Array(32).fill(0x22),
  ]);
  const secret = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, false, ['deriveBits']);
  const clientPublic = envelope.slice(33, 65);
  const client = await crypto.subtle.importKey('raw', clientPublic, { name: 'X25519' }, false, []);
  const shared = await crypto.subtle.deriveBits(
    { name: 'X25519', public: client } as EcdhKeyDeriveParams,
    secret,
    256,
  );
  const ikm = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const salt = envelope.slice(1, 65);
  const key = (domain: string) =>
    crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(domain) },
      ikm,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  const inner = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: envelope.slice(65, 77), additionalData: envelope.slice(0, 77) },
      await key('calimero/sealed-http/v1/request'),
      envelope.slice(77),
    ),
  );
  const len = new DataView(inner.buffer).getUint32(0, false);
  const head = JSON.parse(new TextDecoder().decode(inner.slice(4, 4 + len))) as RequestHead;
  const reply = answer(head, new TextDecoder().decode(inner.slice(4 + len)));
  const replyHead = new TextEncoder().encode(JSON.stringify({ status: reply.status, headers: reply.headers }));
  const replyInner = new Uint8Array([0, 0, 0, 0, ...replyHead, ...new TextEncoder().encode(reply.body)]);
  new DataView(replyInner.buffer).setUint32(0, replyHead.length, false);
  const nonce = new Uint8Array(12).fill(0x77);
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: new Uint8Array([1, ...salt]) },
    await key('calimero/sealed-http/v1/response'),
    replyInner,
  );
  return new Response(new Uint8Array([1, ...nonce, ...new Uint8Array(sealed)]), {
    headers: { 'content-type': SEALED_CONTENT_TYPE },
  });
}

describe('createSealedFetch round trip', () => {
  it('delivers the whole request to the node and returns its answer as a Response', async () => {
    const baseUrl = 'https://tee-node.example/node';
    let seen: { head: RequestHead; body: string } | undefined;
    const carrier = vi.fn(async (_url: string, init: RequestInit) =>
      standInNode(init.body as Uint8Array, (head, body) => {
        seen = { head, body };
        return { status: 201, headers: [['x-answer', 'yes']], body: '{"result":42}' };
      }),
    );
    const sealedFetch = createSealedFetch({ baseUrl, transportPublicKey: transportKey, fetch: carrier as never });

    const response = await sealedFetch(`${baseUrl}/jsonrpc?x=1`, {
      method: 'POST',
      headers: { authorization: 'Bearer secret-token', 'content-type': 'application/json' },
      body: '{"method":"call"}',
    });

    expect(seen?.head.method).toBe('POST');
    expect(seen?.head.path).toBe('/jsonrpc?x=1');
    expect(seen?.head.headers).toContainEqual(['authorization', 'Bearer secret-token']);
    expect(Math.abs((seen?.head.ts ?? 0) - Date.now() / 1000)).toBeLessThan(60);
    expect(seen?.body).toBe('{"method":"call"}');
    expect(response.status).toBe(201);
    expect(response.headers.get('x-answer')).toBe('yes');
    expect(await response.json()).toEqual({ result: 42 });
  });
});

describe('fetchAttestedTransportKey', () => {
  const attested = (transportPublicKey?: string) => ({
    teeAttest: vi.fn().mockResolvedValue({ quoteB64: 'quote', quote: {}, transportPublicKey }),
  });

  it('asks the verifier to check the binding of the reported key', async () => {
    const admin = attested(TRANSPORT_PUBLIC_VECTOR);
    const verify = vi.fn().mockResolvedValue(true);

    const key = await fetchAttestedTransportKey(admin, verify);

    expect(hex(key)).toBe(TRANSPORT_PUBLIC_VECTOR);
    const request = admin.teeAttest.mock.calls[0][0];
    expect(request.bindTransportKey).toBe(true);
    const expected = hex(await transportKeyBinding(new Uint8Array(32), key));
    expect(verify).toHaveBeenCalledWith({
      quoteB64: 'quote',
      nonce: request.nonce,
      reportDataSuffix: expected,
    });
  });

  it('refuses a key whose quote did not verify', async () => {
    await expect(
      fetchAttestedTransportKey(attested(TRANSPORT_PUBLIC_VECTOR), vi.fn().mockResolvedValue(false)),
    ).rejects.toThrow(/did not verify/);
  });

  it('refuses a node that reports no transport key', async () => {
    await expect(
      fetchAttestedTransportKey(attested(undefined), vi.fn().mockResolvedValue(true)),
    ).rejects.toThrow(/predates sealed transport/);
  });
});
