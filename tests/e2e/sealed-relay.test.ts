/**
 * E2E for delegated execution to a TEE relay, sealed end to end.
 *
 * The node here is shaped like a hosted fleet relay: its auth is left to a
 * proxy (`auth_mode = "proxy"`), delegated execution is public
 * (`--delegated-access`), and it attests with a mock quote (`--mock-tee`). A
 * browser with nothing but a device key reaches it through
 * `createAttestedSealedFetch`: attest the transport key, open a sealed session,
 * then read the relay descriptor and submit the intent through it — so the
 * warrant and the method's arguments are readable only inside the TD, not at
 * whatever terminates TLS in front of it.
 *
 * It also pins the rule that makes an ungated `/sealed/v2` safe on such a
 * node: the proxy cannot see inside an envelope, so a sealed request may reach
 * only what the node serves without a credential. A guarded route is refused
 * inside the envelope (`403 sealed_route_unguarded`), never served.
 *
 * Needs a node at `NODE_TEE_RELAY_URL` and `MEROD_BINARY` (to mint the author's
 * device certificate offline). Setup (namespace, context, membership, grant)
 * goes straight to the node's admin API, which a proxy-mode node with no proxy
 * in front of it serves unguarded, standing in for the operator's own access.
 *
 *   NODE_TEE_RELAY_URL=http://localhost:2468 MEROD_BINARY=... pnpm test:e2e -- sealed-relay
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MeroJs } from '../../src/mero-js.js';
import { RelayClient } from '../../src/relay/relay-client.js';
import { createMemoryNonceSource } from '../../src/relay/nonce-source.js';
import {
  createAttestedSealedFetch,
  type VerifyTransportQuote,
} from '../../src/sealed/sealed.js';
import {
  MEROD_BINARY,
  ensureApplication,
  mintDevice,
  runId,
  type MintedDevice,
} from './harness.js';

const RELAY_URL = process.env.NODE_TEE_RELAY_URL;
const RUN = runId();
const MOCK_QUOTE_HEADER = 'MOCK_TDX_QUOTE_V1';
/** The capability bit that lets a node author on a member's behalf. */
const CAN_AUTHOR_ON_BEHALF = 512;

/**
 * Accept a mock quote whose report data is `nonce || reportDataSuffix`. A mock
 * quote is not genuine, so this checks only the binding — the part of the
 * chain this suite is about. Against real hardware use `createQuoteVerifier`.
 */
const verifyMockQuote: VerifyTransportQuote = async ({ quoteB64, nonce, reportDataSuffix }) => {
  const quote = Buffer.from(quoteB64, 'base64');
  if (quote.subarray(0, MOCK_QUOTE_HEADER.length).toString('latin1') !== MOCK_QUOTE_HEADER) return false;
  const reportData = quote.subarray(MOCK_QUOTE_HEADER.length, MOCK_QUOTE_HEADER.length + 64);
  return reportData.toString('hex') === nonce + reportDataSuffix;
};

describe.skipIf(!RELAY_URL || !MEROD_BINARY)('Sealed delegated execution E2E (TEE relay)', () => {
  const relayUrl = RELAY_URL as string;
  /** Every body that left this client, so the suite can prove what did not. */
  const wire: string[] = [];
  let operator: MeroJs;
  let device: MintedDevice;
  let contextId: string;
  let relayAccount: string;
  let sealedFetch: typeof fetch;
  let relay: RelayClient;
  const secret = `sealed-intent-${RUN}`;

  beforeAll(async () => {
    operator = new MeroJs({ baseUrl: relayUrl, timeoutMs: 60_000 });
    const applicationId = await ensureApplication(operator);
    const { namespaceId } = await operator.admin.createNamespace({ applicationId, name: `sealed-relay-${RUN}` });
    contextId = (await operator.admin.createContext({ applicationId, groupId: namespaceId })).contextId;
    relayAccount = (await operator.admin.getNodeIdentity()).accountId;

    device = mintDevice();
    await operator.admin.addGroupMembers(namespaceId, {
      members: [{ identity: device.account, role: 'Member' }],
    });
    await operator.admin.setMemberCapabilities(namespaceId, relayAccount, {
      capabilities: CAN_AUTHOR_ON_BEHALF,
    });

    const recordingFetch: typeof fetch = async (input, init) => {
      const body = init?.body;
      wire.push(
        body instanceof Uint8Array ? Buffer.from(body).toString('latin1') : typeof body === 'string' ? body : '',
      );
      return fetch(input, init);
    };
    sealedFetch = createAttestedSealedFetch({ baseUrl: relayUrl, verify: verifyMockQuote, fetch: recordingFetch });
    relay = new RelayClient({
      relayUrl,
      authorAccount: device.account,
      authorProof: device.credential,
      deviceSecret: device.secret,
      nonces: createMemoryNonceSource(1),
      fetch: sealedFetch,
      timeoutMs: 60_000,
    });
  }, 180_000);

  afterAll(() => operator?.close());

  it('reads the relay descriptor through the sealed session', async () => {
    const described = await relay.describe(contextId);
    expect(described.executorAccount).toBe(relayAccount);
    expect(described.canAuthorOnBehalf).toBe(true);
  }, 60_000);

  it('submits a warrant-carrying intent sealed, and the relay performs it', async () => {
    const result = await relay.execute(contextId, 'set', { key: 'sealed', value: secret });
    expect(result.rootHash).toBeTruthy();

    // Nothing the intent says crossed in the clear: not the method's argument,
    // not the author's proof. Only the attestation request went unsealed.
    const clear = wire.join('\n');
    expect(clear).not.toContain(secret);
    expect(clear).not.toContain(device.credential.slice(0, 64));
  }, 120_000);

  it('refuses, inside the envelope, a sealed request for a route the proxy would guard', async () => {
    const response = await sealedFetch(`${relayUrl}/admin-api/contexts`);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('sealed_route_unguarded');
  }, 60_000);
});
