/**
 * E2E for a group upgrade that succeeds: POST /groups/:id/upgrade moving a
 * group's contexts onto a newer build of the application they already run.
 *
 * `assets/kv-store.mpk` and `assets/kv-store-next.mpk` are the same app under
 * the same dev signer, so they share one application id, and their ABIs are
 * byte-identical; only the bytecode differs (core's rc.49 and rc.51
 * `kv-store-test-fixture.mpk`). Installing the second moves that id's row to
 * the new bytecode, and upgrading the group swaps its contexts onto it with no
 * migration. `next` must stay newer than the base bundle, or core refuses it
 * as a downgrade.
 *
 * The row is node-wide, so the base bundle is put back afterwards: other
 * suites create namespaces on whatever the row holds, and coverage-sweep pins
 * the "already targeting this application" refusal on it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';

import { MeroJs } from '../../src/mero-js.js';
import { ensureApplication, resolveBaseUrl, resolveCreds, runId } from './harness.js';

const asset = (name: string): string => fileURLToPath(new URL(`./assets/${name}`, import.meta.url));

describe('Admin API E2E — Group upgrade', () => {
  let mero: MeroJs;
  let applicationId: string;
  let namespaceId: string;

  beforeAll(async () => {
    // A debug merod can outlast the 10s default on a cold call.
    mero = new MeroJs({ baseUrl: resolveBaseUrl(), timeoutMs: 60_000 });
    await mero.authenticate(resolveCreds());
    applicationId = await ensureApplication(mero);
    // Pin the base build, whatever an earlier suite left the row on.
    await mero.admin.installDevApplication({ path: asset('kv-store.mpk') });
    namespaceId = (await mero.admin.createNamespace({ applicationId, name: `upg-${runId()}` }))
      .namespaceId;
    await mero.admin.createContext({ applicationId, groupId: namespaceId });
  }, 120000);

  afterAll(async () => {
    if (namespaceId) await mero.admin.deleteNamespace(namespaceId).catch(() => {});
    await mero?.admin.installDevApplication({ path: asset('kv-store.mpk') }).catch(() => {});
    mero?.close();
  }, 60000);

  it('upgrades the group onto a newer build of its application', async () => {
    const next = await mero.admin.installDevApplication({ path: asset('kv-store-next.mpk') });
    // Same package and signer, so the same id: the row moved, not a new app.
    expect(next.applicationId).toBe(applicationId);

    const started = await mero.admin.upgradeGroup(namespaceId, { targetApplicationId: applicationId });
    expect(started.groupId).toBe(namespaceId);
    expect(['in_progress', 'completed']).toContain(started.status);

    const done = await waitFor(async () => {
      const status = await mero.admin.getGroupUpgradeStatus(namespaceId);
      return status?.status === 'completed' ? status : undefined;
    }, 90000);
    // The install above already moved the application row to the new build, so
    // `fromVersion` is read from the bytecode the group ran before the upgrade.
    expect(done.fromVersion).toBe('0.11.0-rc.49');
    expect(done.toVersion).toBe('0.11.0-rc.51');
    expect(done.initiatedAt).toBeGreaterThan(0);

    // A completed upgrade left nothing failed behind, so there is nothing to
    // retry: 409, where a group never upgraded answers 404 (the sweep pins that).
    await expect(mero.admin.retryGroupUpgrade(namespaceId)).rejects.toMatchObject({ status: 409 });
  }, 120000);
});

/** Poll `fn` until it returns something defined, or the budget runs out. */
async function waitFor<T>(fn: () => Promise<T | undefined>, budgetMs: number): Promise<T> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const value = await fn().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for the condition to hold');
    await new Promise((r) => setTimeout(r, 1000));
  }
}
