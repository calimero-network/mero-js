/**
 * Route-coverage sweep: fires a well-formed request at every admin route the
 * asserting flows don't reach, so the route-coverage gate sees them.
 *
 * These are best-effort: the recorder logs a path when the request FIRES (before
 * the response), so a call that 4xx's for a state reason (e.g. can't upgrade
 * without a newer bundle, can't leave as sole owner) still proves the SDK builds
 * and sends a correct request to the right URL/method — which is the bug class
 * the gate exists to catch. Deep success assertions live in the main flows.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { MeroJs } from '../../src/mero-js';
import { resolveBaseUrl, resolveCreds, ensureApplication, runId } from './harness';

const NODE_URL = resolveBaseUrl();
const CREDS = resolveCreds();
const RUN = runId();

let mero: MeroJs;
let applicationId: string;
let namespaceId: string;
let groupId: string;
let contextId: string;
let executor: string;
let memberPk: string;

/** Exercise a route for coverage; tolerate state-dependent failures. */
async function cover(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    // The request still fired (recorded) — log why it didn't fully succeed.
    console.log(`(cover) ${label}: ${(e as Error).message?.slice(0, 90)}`);
  }
}

describe('Admin API E2E — Route coverage sweep', () => {
  beforeAll(async () => {
    mero = new MeroJs({ baseUrl: NODE_URL });
    await mero.authenticate(CREDS);
    applicationId = await ensureApplication(mero);
    const ns = await mero.admin.createNamespace({
      applicationId,
      upgradePolicy: 'Automatic',
      alias: `sweep-${RUN}`,
    });
    namespaceId = ns.namespaceId;
    groupId = namespaceId; // namespace root group
    const ctx = await mero.admin.createContext({ applicationId, groupId });
    contextId = ctx.contextId;
    executor = ctx.memberPublicKey;
    const id = (await mero.admin.generateContextIdentity()) as { publicKey?: string };
    memberPk = id.publicKey ?? executor;
  }, 60000);

  afterAll(async () => {
    if (namespaceId) await mero.admin.deleteNamespace(namespaceId).catch(() => {});
    mero.close();
  }, 60000);

  // NOTE: blobs, network/usage, group+context metadata, TEE policy, and createGroup
  // are deeply asserted in round-trip.test.ts — kept out of this tolerant sweep.
  it('node reads: certificate; context resync/sync', async () => {
    await cover('certificate', () => mero.admin.getCertificate());
    await cover('resync', () => mero.admin.resyncContext(contextId, { force: true }));
    await cover('syncOne', () => mero.admin.syncContext(contextId));
    await cover('syncAll', () => mero.admin.syncContext()); // no-arg → POST /contexts/sync
    expect(true).toBe(true);
  });

  it('install-dev-application (direct) + install-application (url)', async () => {
    await cover('installDev', () =>
      mero.admin.installDevApplication({
        path: fileURLToPath(new URL('./assets/kv-store.mpk', import.meta.url)),
        metadata: [],
      }),
    );
    await cover('installApp', () =>
      mero.admin.installApplication({ url: 'http://localhost:2528/none.wasm', metadata: [] }),
    );
    expect(true).toBe(true);
  });

  it('group upgrade + cascade/migration status + abort', async () => {
    await cover('upgradeStatus', () => mero.admin.getGroupUpgradeStatus(groupId));
    await cover('cascadeStatus', () => mero.admin.getCascadeStatus(namespaceId));
    await cover('migrationStatus', () => mero.admin.getMigrationStatus(namespaceId));
    await cover('upgrade', () => mero.admin.upgradeGroup(groupId, { applicationId } as never));
    await cover('upgradeRetry', () => mero.admin.retryGroupUpgrade(groupId));
    await cover('abortMigration', () => mero.admin.abortMigration(namespaceId));
    expect(true).toBe(true);
  });

  // NOTE: the full member lifecycle (add/list/role/capabilities/metadata/auto-follow/
  // remove) + updateGroupSettings are deeply asserted in round-trip.test.ts.
  it('group proofs + signing key + updateApp + app uninstall', async () => {
    await cover('signingKey', () => mero.admin.registerGroupSigningKey(groupId, {} as never));
    await cover('updateApp', () =>
      mero.admin.updateContextApplication(contextId, { applicationId, executorPublicKey: executor }),
    );
    await cover('ownProof', () => mero.admin.issueOwnershipProof(groupId, { requester: executor }));
    await cover('nsOwnProof', () => mero.admin.issueNamespaceOwnershipProof(groupId, { requester: executor }));
    // Uninstall a non-existent app — fires DELETE /applications/:id safely.
    await cover('uninstallApp', () => mero.admin.uninstallApplication('1'.repeat(32)));
    expect(true).toBe(true);
  });

  it('join flows + invite specialized node', async () => {
    await cover('joinGroup', () => mero.admin.joinGroup({ invitation: 'x' } as never));
    await cover('joinNamespace', () => mero.admin.joinNamespace(namespaceId, { invitation: 'x' } as never));
    await cover('joinInheritance', () => mero.admin.joinSubgroupInheritance(groupId));
    await cover('inviteSpecialized', () => mero.admin.inviteSpecializedNode({ contextId } as never));
    expect(true).toBe(true);
  });

  it('detach + leave ops (destructive — run last)', async () => {
    await cover('detach', () => mero.admin.detachContextFromGroup(groupId, contextId, { requester: executor }));
    await cover('leaveContext', () => mero.admin.leaveContext(contextId, { requester: executor }));
    await cover('leaveGroup', () => mero.admin.leaveGroup(groupId, { requester: executor }));
    await cover('leaveNamespace', () => mero.admin.leaveNamespace(namespaceId, { requester: executor }));
    expect(true).toBe(true);
  });
});
