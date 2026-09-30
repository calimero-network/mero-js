/**
 * E2E for retrying a group upgrade that left a context behind.
 *
 * A retry only has work when an upgrade is in progress with failed contexts,
 * and only the cascade path counts failures: it swaps each context itself and,
 * once its automatic rounds are spent, leaves the record in progress with the
 * failures on it. The plain path swaps lazily and never records one.
 *
 * The failure is made on purpose with core's `scenario-migration-check-fail`
 * pair (`migration-check-fail-v{1,2}.mpk`, one application id): v2's migrate
 * drops an item and its `#[app::migration_check]` rejects the result, so the
 * swap errors every time a context holds an item to drop.
 *
 * Run manually:
 *   NODE_URL=http://localhost:4001 pnpm vitest run --config vitest.e2e.config.ts \
 *     tests/e2e/group-upgrade-retry.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';

import { MeroJs } from '../../src/mero-js.js';
import { resolveBaseUrl, resolveCreds, runId } from './harness.js';

const asset = (name: string): string => fileURLToPath(new URL(`./assets/${name}`, import.meta.url));

describe('Admin API E2E — Group upgrade retry', () => {
  let mero: MeroJs;
  let applicationId: string;
  let namespaceId: string;

  beforeAll(async () => {
    mero = new MeroJs({ baseUrl: resolveBaseUrl(), timeoutMs: 60_000 });
    await mero.authenticate(resolveCreds());
    applicationId = (
      await mero.admin.installDevApplication({ path: asset('migration-check-fail-v1.mpk') })
    ).applicationId;
    namespaceId = (await mero.admin.createNamespace({ applicationId, name: `retry-${runId()}` }))
      .namespaceId;
    const ctx = await mero.admin.createContext({ applicationId, groupId: namespaceId });
    // The check only fails when the migrate has an item to drop.
    await mero.rpc.execute({
      contextId: ctx.contextId,
      method: 'set_item',
      argsJson: { key: 'a', value: '1' },
      executorPublicKey: ctx.memberPublicKey,
    });
  }, 120000);

  afterAll(async () => {
    if (namespaceId) await mero.admin.deleteNamespace(namespaceId).catch(() => {});
    mero?.close();
  }, 60000);

  it('retries an upgrade whose context failed to migrate', async () => {
    const next = await mero.admin.installDevApplication({ path: asset('migration-check-fail-v2.mpk') });
    expect(next.applicationId).toBe(applicationId);

    await mero.admin.upgradeGroup(namespaceId, { targetApplicationId: applicationId, cascade: true });

    // The propagator's automatic rounds back off 5s, 10s, 20s before it stops.
    const stuck = await waitFor(async () => {
      const status = await mero.admin.getGroupUpgradeStatus(namespaceId);
      return (status?.localContextsFailed ?? 0) > 0 ? status : undefined;
    }, 120000);
    expect(stuck.status).toBe('in_progress');

    // The failure is recorded on the first round, but the propagator keeps the
    // group until its rounds are spent and answers a retry 409 meanwhile.
    const retried = await retryOnceIdle(namespaceId, 120000);
    expect(retried).toBeDefined();
  }, 300000);

  /** Retry until the running propagator lets go of the group (409 until then). */
  async function retryOnceIdle(groupId: string, budgetMs: number) {
    const deadline = Date.now() + budgetMs;
    for (;;) {
      try {
        return await mero.admin.retryGroupUpgrade(groupId);
      } catch (err) {
        const busy = (err as { status?: number }).status === 409;
        if (!busy || Date.now() > deadline) throw err;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
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
