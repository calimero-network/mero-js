import { describe, expect, it } from 'vitest';
import { attestKeyBinding, attestRelayNodeKey, reportDataOf } from './attest-node-key';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => Number.parseInt(x, 16)));
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

const KEY = fromHex('3d46b7386e1cfa0a61c94eb3087ca7bb316ab1dd2b71974d9d524ad268088d8a');
const MOCK_HEADER = new TextEncoder().encode('MOCK_TDX_QUOTE_V1');

/** A relay answering /tee/attest, binding `boundKey` but naming `namedKey`. */
function relay(opts: {
  namedKey?: Uint8Array;
  boundKey?: Uint8Array;
  mock?: boolean;
  wrongNonce?: boolean;
} = {}) {
  const named = opts.namedKey ?? KEY;
  const bound = opts.boundKey ?? named;
  return (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const { nonce } = JSON.parse(String(init?.body)) as { nonce: string };
    const n = fromHex(nonce);
    if (opts.wrongNonce) n[0] ^= 0xff;
    const reportData = new Uint8Array([...n, ...(await attestKeyBinding(bound))]);
    let quote: Uint8Array;
    if (opts.mock ?? true) {
      quote = new Uint8Array(256);
      quote.set(MOCK_HEADER, 0);
      quote.set(reportData, MOCK_HEADER.length);
    } else {
      quote = new Uint8Array(1024);
      quote.set(reportData, 48 + 520);
    }
    return new Response(
      JSON.stringify({ data: { quoteB64: b64(quote), boundPublicKey: hex(named) } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
}

describe('attestRelayNodeKey', () => {
  it('returns the key a mock quote binds, when mock is allowed', async () => {
    const got = await attestRelayNodeKey({ relayUrl: 'http://r', fetch: relay(), allowMock: true });
    expect(got).toEqual({ nodeKey: hex(KEY), mock: true });
  });

  it('refuses a mock quote unless told otherwise', async () => {
    await expect(attestRelayNodeKey({ relayUrl: 'http://r', fetch: relay() })).rejects.toThrow(/MOCK/);
  });

  it('refuses a key the quote does not bind', async () => {
    const other = new Uint8Array(32).fill(7);
    await expect(
      attestRelayNodeKey({ relayUrl: 'http://r', fetch: relay({ namedKey: other, boundKey: KEY }), allowMock: true }),
    ).rejects.toThrow(/does not bind the key/);
  });

  it('refuses a quote made for another nonce', async () => {
    await expect(
      attestRelayNodeKey({ relayUrl: 'http://r', fetch: relay({ wrongNonce: true }), allowMock: true }),
    ).rejects.toThrow(/nonce/);
  });

  it('refuses a real quote with no verifier, and runs the verifier when given one', async () => {
    await expect(
      attestRelayNodeKey({ relayUrl: 'http://r', fetch: relay({ mock: false }) }),
    ).rejects.toThrow(/verifyQuote/);
    let verified = false;
    const got = await attestRelayNodeKey({
      relayUrl: 'http://r',
      fetch: relay({ mock: false }),
      verifyQuote: async () => {
        verified = true;
      },
    });
    expect(verified).toBe(true);
    expect(got).toEqual({ nodeKey: hex(KEY), mock: false });
  });
});

// Captured from a mock-TEE merod (core rc.60, `merod run --mock-tee`) answering
// POST /admin-api/tee/attest { nonce, bindNodeKey: true }: pins this module's
// byte layout to what core actually produces, not to a model of it.
describe('against a real core response', () => {
  const nonce = '912466d433e9fb59fa3efc199c570f7afa7a0517cc4d868bcceeb324b9f896e6';
  const quoteB64 =
    'TU9DS19URFhfUVVPVEVfVjGRJGbUM+n7Wfo+/BmcVw96+noFF8xNhovM7rMkufiW5oay/bvn9kdYWwIO5cDHwshQazm9T8Mrg7LUZwLXS/TMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

  it('reads the nonce and the key binding out of the quote bytes', async () => {
    const quote = Uint8Array.from(atob(quoteB64), (c) => c.charCodeAt(0));
    const { reportData, mock } = reportDataOf(quote);
    expect(mock).toBe(true);
    expect(hex(reportData.subarray(0, 32))).toBe(nonce);
    expect(hex(reportData.subarray(32))).toBe(hex(await attestKeyBinding(KEY)));
  });
});
