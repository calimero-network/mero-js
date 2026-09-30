/**
 * E2E for what an account holder does with a device it has paired: name it,
 * replace its scope, relink it, and revoke it.
 *
 * All four need a device this node CERTIFIED, and a single node certifies none
 * (not even its own), so `account-pairing.test.ts` can only reach their
 * refusals. This suite pairs a second, fresh node onto the main node's account
 * and drives them for real.
 *
 * Needs `MERO_PAIR_NODE_URL`: a freshly initialised merod that has joined
 * nothing, since a node enrolled in a namespace under its own account cannot be
 * paired onto another. It is used once per run: the pairing below is terminal
 * for it (the last test revokes it). The two nodes need no network link between
 * them. Every call here is answered by the holder from its own registry and
 * bindings; what the paired device later hears over gossip is covered by core's
 * `account-*` merobox scenarios.
 *
 * Run manually:
 *   NODE_URL=http://localhost:4001 MERO_PAIR_NODE_URL=http://localhost:4011 \
 *     pnpm vitest run --config vitest.e2e.config.ts tests/e2e/account-pairing-two-node.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MeroJs } from '../../src/mero-js.js';
import type {
  AccountDeviceEntry,
  AccountPairInitResponseData,
  NodeIdentity,
} from '../../src/admin-api/admin-types.js';
import { ensureApplication, resolveBaseUrl, resolveCreds, runId } from './harness.js';

const HOLDER_URL = resolveBaseUrl();
const PAIR_NODE_URL = process.env.MERO_PAIR_NODE_URL;
const CREDS = resolveCreds();

describe.skipIf(!PAIR_NODE_URL)('Account device management E2E (two nodes)', () => {
  let holder: MeroJs;
  let fresh: MeroJs;
  let applicationId: string;
  let namespaceId: string;
  let identity: NodeIdentity;
  let offer: AccountPairInitResponseData;

  /** The holder's row for the paired device, as its listing reports it. */
  async function pairedRow(): Promise<AccountDeviceEntry> {
    const row = (await holder.admin.listAccountDevices()).find(
      (d) => d.deviceId === offer.deviceId,
    );
    expect(row, `holder does not list paired device ${offer.deviceId}`).toBeTruthy();
    return row!;
  }

  beforeAll(async () => {
    // Revoke publishes into every namespace binding the device and rotates its
    // keys, and each publish can wait out the governance ack timeout on CI's
    // debug node, so one call can outlast the 10s default.
    holder = new MeroJs({ baseUrl: HOLDER_URL, timeoutMs: 60_000 });
    await holder.authenticate(CREDS);
    fresh = new MeroJs({ baseUrl: PAIR_NODE_URL as string });
    await fresh.authenticate(CREDS);

    applicationId = await ensureApplication(holder);
    namespaceId = (
      await holder.admin.createNamespace({ applicationId, name: `pair2-${runId()}` })
    ).namespaceId;
    identity = await holder.admin.getNodeIdentity();
    expect(identity.accountRootPublicKey, 'the holder must hold its account root').toBeTruthy();
  }, 60000);

  afterAll(async () => {
    if (namespaceId) await holder?.admin.deleteNamespace(namespaceId).catch(() => {});
    holder?.close();
    fresh?.close();
  }, 60000);

  it('pairs the fresh node onto the holder account', async () => {
    // The new device's half first: it cannot mint its id until it knows the
    // account, and the holder cannot certify it until it knows the id and keys.
    offer = await fresh.admin.initAccountPairing({
      accountRootPublicKey: identity.accountRootPublicKey!,
      namespaces: [namespaceId],
      accountNamespace: identity.accountNamespaceId ?? undefined,
    });
    expect(offer.accountId).toBe(identity.accountId);
    expect(offer.deviceId).not.toBe(identity.deviceId);

    const completed = await holder.admin.completeAccountPairing({
      deviceId: offer.deviceId,
      kemPublicKey: offer.kemPublicKey,
      signPublicKey: offer.signPublicKey,
      statement: offer.statement,
      confirmationCode: offer.confirmationCode,
    });
    // The check a person makes: both sides derive the code over exactly what is
    // certified, so a mismatch means the payload changed in transit.
    expect(completed.confirmationCode).toBe(offer.confirmationCode);
    expect(completed.deviceId).toBe(offer.deviceId);
    expect(completed.accountId).toBe(identity.accountId);

    const row = await pairedRow();
    expect(row.isSelf).toBe(false);
    expect(row.revoked).toBe(false);
    expect(row.namespaces).toContain(namespaceId);
  }, 60000);

  it('names the paired device, and the listing reads the name back', async () => {
    const label = `e2e paired ${runId()}`;
    const named = await holder.admin.labelAccountDevice(offer.deviceId, { label });
    expect(named).toMatchObject({ deviceId: offer.deviceId, accountId: identity.accountId, label });
    expect((await pairedRow()).label).toBe(label);
  }, 60000);

  it('narrows the paired device to one application, then widens it back to all', async () => {
    const narrowed = await holder.admin.rescopeAccountDevice(offer.deviceId, {
      scope: { only: [applicationId] },
    });
    expect(narrowed.deviceId).toBe(offer.deviceId);
    expect(narrowed.applications).toEqual([applicationId]);
    expect((await pairedRow()).applications).toEqual([applicationId]);

    // `all` is an empty list on the wire: the device speaks for every application.
    const widened = await holder.admin.rescopeAccountDevice(offer.deviceId, { scope: 'all' });
    expect(widened.applications).toEqual([]);
    expect((await pairedRow()).applications).toEqual([]);
  }, 60000);

  it('relinks the paired device against the scope it already holds', async () => {
    // No applications: a repair, which re-publishes the device's links wherever
    // they are missing and reports the rest - the request an operator makes to
    // heal drift. Before the revoke below, since a revoked device is refused.
    const relinked = await holder.admin.relinkAccountDevice(offer.deviceId);
    expect(relinked).toMatchObject({ deviceId: offer.deviceId, accountId: identity.accountId });
    // Widened back to every application above, and the empty list says so.
    expect(relinked.applications).toEqual([]);
    // The namespace it was paired into is reported one way or the other.
    const reported = [
      ...relinked.linkedIn.map((l) => l.namespaceId),
      ...relinked.skipped.map((s) => s.namespaceId),
    ];
    expect(reported).toContain(namespaceId);
  }, 60000);

  it('revokes the paired device, everywhere it was bound', async () => {
    const revoked = await holder.admin.revokeAccountDevice(namespaceId, {
      deviceId: offer.deviceId,
    });
    expect(revoked).toMatchObject({ deviceId: offer.deviceId, accountId: identity.accountId });
    // A device belongs to the account, so it is withdrawn from every namespace
    // holding a binding for it, not only the one named in the path.
    expect(revoked.revokedIn.map((r) => r.namespaceId)).toContain(namespaceId);
    expect((await pairedRow()).revoked).toBe(true);
  }, 60000);
});
