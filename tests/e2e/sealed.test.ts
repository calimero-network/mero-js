/**
 * E2E for the sealed transport against a real merod: attest, open a session,
 * then drive login, admin calls, JSON-RPC and a server-sent event stream
 * through it, and check that nothing crossed the wire in the clear.
 *
 * Needs a node started with `--mock-tee` (merod built with the
 * `mock-attestation` feature), whose URL is in `NODE_TEE_URL`; skipped
 * otherwise. A mock quote is not genuine, so the verifier here checks only
 * that its report data commits to the transport key — the part of the chain
 * this suite is about. Against real hardware, verify the quote itself too.
 *
 * With `NODE_TEE_SEALED_ONLY=1` the node is expected to run with
 * `[server.sealed] required = true`: the suite then also checks that an
 * unsealed request is refused, and everything above still works, since only
 * attestation goes unsealed.
 *
 * Run manually:
 *   NODE_TEE_URL=http://localhost:2438 pnpm test:e2e -- sealed
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MeroJs } from '../../src/mero-js.js';
import {
  createSealedFetch,
  fetchAttestedTransportKey,
  type VerifyTransportQuote,
} from '../../src/sealed/index.js';
import { ensureApplication, resolveCreds, runId } from './harness.js';

const NODE_TEE_URL = process.env.NODE_TEE_URL;
/** Set when that node runs with `[server.sealed] required = true`. */
const SEALED_ONLY = process.env.NODE_TEE_SEALED_ONLY === '1';
const CREDS = resolveCreds();
const MOCK_QUOTE_HEADER = 'MOCK_TDX_QUOTE_V1';

/** Accept a mock quote whose report data is `nonce || reportDataSuffix`. */
const verifyMockQuote: VerifyTransportQuote = async ({ quoteB64, nonce, reportDataSuffix }) => {
  const quote = Buffer.from(quoteB64, 'base64');
  if (quote.subarray(0, MOCK_QUOTE_HEADER.length).toString('latin1') !== MOCK_QUOTE_HEADER) return false;
  const reportData = quote.subarray(MOCK_QUOTE_HEADER.length, MOCK_QUOTE_HEADER.length + 64);
  return reportData.toString('hex') === nonce + reportDataSuffix;
};

describe.skipIf(!NODE_TEE_URL)('Sealed transport E2E (mock TEE)', () => {
  const baseUrl = NODE_TEE_URL as string;
  const wire: Array<{ url: string; body: Uint8Array }> = [];
  let plain: MeroJs;
  let sealed: MeroJs;
  let attestations = 0;

  beforeAll(async () => {
    // Attesting is the one step that is not sealed: it is how the key is learned.
    plain = new MeroJs({ baseUrl });
    const recordingFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const body = init?.body instanceof Uint8Array ? init.body : new Uint8Array();
      wire.push({ url, body });
      return fetch(input, init);
    };
    const sealedFetch = createSealedFetch({
      baseUrl,
      transportPublicKey: async () => {
        attestations += 1;
        return fetchAttestedTransportKey(plain.admin, verifyMockQuote);
      },
      fetch: recordingFetch,
    });
    sealed = new MeroJs({ baseUrl, fetch: sealedFetch });
    await sealed.authenticate(CREDS);
  }, 60000);

  afterAll(() => {
    sealed?.close();
    plain?.close();
  });

  it('logs in and reads the node through the sealed endpoints only', async () => {
    const health = await sealed.admin.healthCheck();
    expect(health.status).toBe('alive');
    expect(attestations).toBe(1);
    expect(wire.length).toBeGreaterThan(0);
    expect(wire.every(({ url }) => url.startsWith(`${baseUrl}/sealed/v2`))).toBe(true);
  });

  it.skipIf(!SEALED_ONLY)('refuses an unsealed request when the node requires sealing', async () => {
    const response = await fetch(`${baseUrl}/admin-api/contexts`);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('sealed_required');
  });

  it('runs JSON-RPC against a context, and streams its events back sealed', async () => {
    const applicationId = await ensureApplication(sealed);
    const { namespaceId } = await sealed.admin.createNamespace({ applicationId, name: `sealed-${runId()}` });
    try {
      const context = await sealed.admin.createContext({ applicationId, groupId: namespaceId });
      const executorPublicKey = context.memberPublicKey;

      const events = sealed.events;
      const connected = new Promise<string>((resolve) => events.on('connect', resolve));
      await events.connect();
      await connected;
      await events.subscribe([context.contextId]);
      const delivered = new Promise<unknown>((resolve) => events.on('event', resolve));

      const secret = `sealed-value-${runId()}`;
      await sealed.rpc.execute({
        contextId: context.contextId,
        method: 'set',
        argsJson: { key: 'sealed', value: secret },
        executorPublicKey,
      });
      const value = await sealed.rpc.execute<string | null>({
        contextId: context.contextId,
        method: 'get',
        argsJson: { key: 'sealed' },
        executorPublicKey,
      });
      expect(value).toBe(secret);

      const event = await Promise.race([
        delivered,
        new Promise((_, reject) => setTimeout(() => reject(new Error('no event within 30s')), 30000)),
      ]);
      expect(JSON.stringify(event)).toContain(context.contextId);
      events.close();

      const onTheWire = wire.map(({ body }) => Buffer.from(body).toString('latin1')).join('');
      expect(onTheWire).not.toContain(secret);
      expect(onTheWire).not.toContain(CREDS.password);
      expect(onTheWire).not.toContain('jsonrpc');
      expect(wire.every(({ url }) => url.startsWith(`${baseUrl}/sealed/v2`))).toBe(true);
    } finally {
      await sealed.admin.deleteNamespace(namespaceId).catch(() => {});
    }
  });
});
