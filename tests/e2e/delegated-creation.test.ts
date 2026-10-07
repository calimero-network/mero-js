/**
 * E2E for delegated context creation: a member with no node creates a context
 * through a relay, then writes into it.
 *
 * `GET`/`POST /admin-api/groups/{group_id}/context-intents` had no SDK call that
 * answered under 400, which is what core's coverage gate counts. A test that
 * reached the route with a fabricated warrant would register the route and
 * prove nothing, so this one does the real thing: the creation warrant is
 * signed by this SDK (`signCreationWarrant`, through `RelayClient`), the node
 * creates the context as the **author**, and the author's first delegated write
 * into it lands. Unit tests pin the bytes against core's vectors; only a node
 * can say it accepts them.
 *
 * The relay is a node serving delegated execution publicly
 * (`--delegated-access`), so `RelayClient` reaches it the way a browser would:
 * with a warrant and nothing else. The setup (namespace, membership, grants)
 * goes to the same node's admin API, which a proxy-auth node with no proxy in
 * front serves unguarded, standing in for the operator. In core's SDK E2E job
 * that is the node at `NODE_TEE_RELAY_URL`.
 *
 * `merod` mints the author's device certificate offline, with a key that never
 * reaches the node.
 *
 * Requires `NODE_TEE_RELAY_URL` and `MEROD_BINARY`; skipped without either.
 *
 *   NODE_TEE_RELAY_URL=http://localhost:2468 MEROD_BINARY=... pnpm test:e2e -- delegated-creation
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MeroJs } from '../../src/mero-js.js';
import { IntentRefusedError, RelayClient } from '../../src/relay/relay-client.js';
import { createMemoryNonceSource } from '../../src/relay/nonce-source.js';
import { signerFromSecret } from '../../src/signer/index.js';
import {
  MEROD_BINARY,
  ensureApplication,
  mintDevice,
  runId,
  type MintedDevice,
} from './harness.js';

const RELAY_URL = process.env.NODE_TEE_RELAY_URL;
const RUN = runId();
/** `MemberCapabilities::CAN_CREATE_CONTEXT`: bit 0. */
const CAN_CREATE_CONTEXT = 1;
/** `MemberCapabilities::CAN_AUTHOR_ON_BEHALF`: bit 9. */
const CAN_AUTHOR_ON_BEHALF = 512;

describe.skipIf(!RELAY_URL || !MEROD_BINARY)('createContext E2E: delegated creation', () => {
  const relayUrl = RELAY_URL as string;
  let operator: MeroJs;
  let applicationId: string;
  let namespaceId: string;
  let relayAccount: string;
  let relayKey: string;
  let device: MintedDevice;
  let relay: RelayClient;
  let created: { contextId: string; memberPublicKey: string };

  beforeAll(async () => {
    operator = new MeroJs({ baseUrl: relayUrl, timeoutMs: 60_000 });
    applicationId = await ensureApplication(operator);
    namespaceId = (
      await operator.admin.createNamespace({ applicationId, name: `deleg-create-${RUN}` })
    ).namespaceId;
    const identity = await operator.admin.getNodeIdentity();
    relayAccount = identity.accountId;
    relayKey = identity.publicKey;

    // By ACCOUNT: the minted device is in no binding row, which is the case a
    // certificate exists for.
    device = mintDevice();
    await operator.admin.addGroupMembers(namespaceId, {
      members: [{ identity: device.account, role: 'Member' }],
    });

    relay = new RelayClient({
      relayUrl,
      authorAccount: device.account,
      authorProof: device.credential,
      // Through a Signer, the path a non-extractable key takes.
      signer: await signerFromSecret(device.secret, 'deviceSecret'),
      nonces: createMemoryNonceSource(1),
      timeoutMs: 60_000,
    });
  }, 180_000);

  afterAll(() => operator?.close());

  it('describes the relay as lacking standing before the grant', async () => {
    // Read before anything is signed: whose account goes in `executor`, and
    // whether this node may act for members here. The standing is implied by
    // neither membership nor admin, so a fresh namespace says no.
    const described = await relay.describeCreation(namespaceId, { author: device.account });
    expect(described.executorAccount).toBe(relayAccount);
    expect(described.executorKey).toBe(relayKey);
    expect(described.groupId).toBe(namespaceId);
    expect(described.canCreateOnBehalf).toBe(false);

    // And the client refuses on that answer, before a nonce is spent on a
    // warrant nobody would execute.
    await expect(relay.createContext({ groupId: namespaceId, applicationId })).rejects.toBeInstanceOf(
      IntentRefusedError,
    );
  }, 60_000);

  it('reports both standings once the relay and the author are granted', async () => {
    await operator.admin.setMemberCapabilities(namespaceId, relayAccount, {
      capabilities: CAN_AUTHOR_ON_BEHALF,
    });
    // The right to create is the AUTHOR's; the relay needs none of its own.
    await operator.admin.setMemberCapabilities(namespaceId, device.account, {
      capabilities: CAN_CREATE_CONTEXT,
    });

    await expect(
      relay.describeCreation(namespaceId, { author: device.account }),
    ).resolves.toEqual({
      executorAccount: relayAccount,
      executorKey: relayKey,
      groupId: namespaceId,
      canCreateOnBehalf: true,
      authorMayCreate: true,
    });
  }, 60_000);

  it('creates a context as the author, through the relay', async () => {
    const result = await relay.createContext({
      groupId: namespaceId,
      applicationId,
      initArgs: {},
      name: `deleg-created-${RUN}`,
    });
    expect(result.contextId).toMatch(/^[0-9a-f]{64}$/);
    expect(result.groupId).toBe(namespaceId);
    expect(result.memberPublicKey).toBeTruthy();
    created = result;

    // The node itself now knows the context, in the group it was signed for.
    const contexts = await operator.admin.listGroupContexts(namespaceId);
    expect(contexts.map((c) => c.contextId)).toContain(created.contextId);
    await expect(operator.admin.getContext(created.contextId)).resolves.toBeTruthy();
  }, 120_000);

  it('writes into the new context through the same relay, and the value is there', async () => {
    // The point of creating a context through a relay: the author can then
    // use it. The creation warrant's nonce was spent in this context's
    // per-device ledger, so this draws the next one from the same source.
    const value = `created-and-written-${RUN}`;
    const result = await relay.execute(created.contextId, 'set', { key: 'deleg', value });
    expect(result.rootHash).toBeTruthy();

    const read = await operator.rpc.execute<string | null>({
      contextId: created.contextId,
      method: 'get',
      argsJson: { key: 'deleg' },
      executorPublicKey: created.memberPublicKey,
    });
    expect(read).toBe(value);
  }, 120_000);
});
