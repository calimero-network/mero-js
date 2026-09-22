import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminApiClient, WarrantNonceRouteUnavailableError } from './admin-client.js';
import { WebHttpClient, HTTPError } from '../http-client/index.js';
import type { Transport } from '../http-client/index.js';

/**
 * Warrant-nonce discovery read through a real `WebHttpClient` over a stubbed
 * `fetch`, for the reason stated in `account-devices-wire.test.ts`: the casing
 * and the numeric literals are the contract, and only the bytes can prove them.
 *
 * This route has a second reason on top of that one. Its nonces are `u64`, so a
 * test that hands the client an object literal would already have rounded the
 * interesting values before the client saw them — the exhaustion case lives at
 * `2^64 - 1`, which no JS `number` can represent. The body here is written as
 * text so the digits under test are the digits in this file.
 */
describe('warrant-nonce discovery over the wire', () => {
  const NODE = 'https://node.example.invalid';
  const CONTEXT = 'c'.repeat(64);
  const DEVICE = 'a'.repeat(64);
  const PATH = `${NODE}/admin-api/contexts/${CONTEXT}/warrant-nonce/${DEVICE}`;

  let fetchStub: ReturnType<typeof vi.fn>;
  let client: AdminApiClient;

  function jsonText(body: string): Response {
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  beforeEach(() => {
    fetchStub = vi.fn();
    const transport: Transport = { fetch: fetchStub, baseUrl: NODE };
    client = new AdminApiClient(new WebHttpClient(transport));
  });

  it('reads a fresh sequence as seen:false with nextNonce 0, not as an error', async () => {
    // What the node sends for a device with no row: `seen: false` present,
    // `highWaterNonce` omitted entirely (absent, not null), `nextNonce: 0`.
    fetchStub.mockResolvedValueOnce(
      jsonText(
        `{"data":{"contextId":"${CONTEXT}","authorDeviceKey":"${DEVICE}","seen":false,"nextNonce":0,"windowWidth":64}}`,
      ),
    );

    const state = await client.getWarrantNonce(CONTEXT, DEVICE);

    expect(fetchStub.mock.calls[0][0]).toBe(PATH);
    expect(state.kind).toBe('open');
    expect(state.seen).toBe(false);
    // A real answer, not a missing one: nonce 0 is the bottom of a sequence
    // nobody has written to, and a client mints there.
    if (state.kind === 'exhausted') throw new Error('a fresh sequence is not exhausted');
    expect(state.nextNonce).toBe(0n);
    expect(state.highWaterNonce).toBeUndefined();
    expect(state.windowWidth).toBe(64n);
  });

  it('parses the camelCase shape merod emits and ignores no snake_case spelling', async () => {
    fetchStub.mockResolvedValueOnce(
      jsonText(
        `{"data":{"contextId":"${CONTEXT}","authorDeviceKey":"${DEVICE}","seen":true,"highWaterNonce":7,"nextNonce":8,"windowWidth":64}}`,
      ),
    );

    const state = await client.getWarrantNonce(CONTEXT, DEVICE);

    // `next_nonce` would arrive as undefined and read as "exhausted", sending a
    // healthy client to re-key. This is the assertion that catches that.
    expect((state as unknown as Record<string, unknown>).next_nonce).toBeUndefined();
    if (state.kind === 'exhausted') throw new Error('nonce 8 is available');
    expect(state.nextNonce).toBe(8n);
    // Reported for auditability only — the `+1` is the node's arithmetic.
    expect(state.highWaterNonce).toBe(7n);
    expect(state.contextId).toBe(CONTEXT);
    expect(state.authorDeviceKey).toBe(DEVICE);
  });

  it('keeps every digit of a nonce past 2^53', async () => {
    // 9007199254740993 == 2^53 + 1, the first integer a double cannot hold. A
    // client that routed this through `JSON.parse` would mint at ...992 and be
    // refused as a replay, with nothing in the response to explain why.
    fetchStub.mockResolvedValueOnce(
      jsonText(
        `{"data":{"contextId":"${CONTEXT}","authorDeviceKey":"${DEVICE}","seen":true,"highWaterNonce":9007199254740992,"nextNonce":9007199254740993,"windowWidth":64}}`,
      ),
    );

    const state = await client.getWarrantNonce(CONTEXT, DEVICE);

    if (state.kind === 'exhausted') throw new Error('not exhausted');
    expect(state.nextNonce).toBe(9007199254740993n);
    expect(state.nextNonce).not.toBe(BigInt(Number('9007199254740993')));
  });

  it('represents an exhausted sequence as a distinct arm with no nextNonce', async () => {
    // `u64::MAX` spent. The node omits `nextNonce` rather than wrapping to 0,
    // because a wrapped 0 looks valid and is refused forever.
    fetchStub.mockResolvedValueOnce(
      jsonText(
        `{"data":{"contextId":"${CONTEXT}","authorDeviceKey":"${DEVICE}","seen":true,"highWaterNonce":18446744073709551615,"windowWidth":64}}`,
      ),
    );

    const state = await client.getWarrantNonce(CONTEXT, DEVICE);

    expect(state.kind).toBe('exhausted');
    if (state.kind !== 'exhausted') throw new Error('this sequence is saturated');
    expect(state.highWaterNonce).toBe(18446744073709551615n);
    // The narrowing above is the point of the union: `nextNonce` is not a
    // property of this arm at all, so a caller cannot read it without first
    // saying which case it is in.
    expect((state as unknown as Record<string, unknown>).nextNonce).toBeUndefined();
  });

  it('names the missing route when a node that predates it answers 404', async () => {
    // The handler itself never 404s — an unknown device is a 200 with
    // `seen: false` and a malformed id is a 400 — so a 404 can only mean the
    // route is not mounted. Retrying cannot help, and the caller has to be able
    // to tell that apart from a transient failure.
    fetchStub.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        statusText: 'Not Found',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const failure = await client.getWarrantNonce(CONTEXT, DEVICE).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(WarrantNonceRouteUnavailableError);
    expect((failure as Error).message).toContain('does not serve warrant-nonce discovery');
    expect((failure as WarrantNonceRouteUnavailableError).cause.status).toBe(404);
  });

  it('leaves every other refusal as a plain HTTPError', async () => {
    // 401 is the one a `--public-intents` deployment produces: this route is on
    // the protected router, so an anonymous caller is refused rather than
    // served. That must not be mistaken for a missing route.
    fetchStub.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const failure = await client.getWarrantNonce(CONTEXT, DEVICE).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(HTTPError);
    expect(failure).not.toBeInstanceOf(WarrantNonceRouteUnavailableError);
    expect((failure as HTTPError).status).toBe(401);
  });

  it('percent-encodes both path segments', async () => {
    fetchStub.mockResolvedValueOnce(
      jsonText(`{"data":{"contextId":"x","authorDeviceKey":"y","seen":false,"nextNonce":0,"windowWidth":64}}`),
    );

    // A base58 key never needs escaping, but the value reaching here is caller
    // input and a path segment is not a safe place for unescaped input.
    await client.getWarrantNonce('ctx/../../etc', 'dev ice');

    expect(fetchStub.mock.calls[0][0]).toBe(
      `${NODE}/admin-api/contexts/ctx%2F..%2F..%2Fetc/warrant-nonce/dev%20ice`,
    );
  });
});
