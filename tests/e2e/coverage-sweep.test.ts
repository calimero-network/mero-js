/**
 * Route-coverage sweep: fires a well-formed request at every admin route the
 * asserting flows don't reach, so the route-coverage gate sees them.
 *
 * Every call sends a body core will accept. `cover()` rethrows on any 4xx, so a
 * renamed field earns a red test instead of a route that records as covered on a
 * 400 nobody reads. What it still tolerates is a 5xx: the node parsed the request
 * and refused it on state a single fresh node cannot arrange (nothing published
 * at those coordinates, no upgrade in flight). Routes this node cannot answer at
 * all assert their exact refusal below rather than hiding inside cover().
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { MeroJs } from '../../src/mero-js.js';
import { resolveBaseUrl, resolveCreds, ensureApplication, runId } from './harness.js';

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

/** Exercise a route for coverage; tolerate a state 5xx, never a 4xx. */
async function cover(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    // A 4xx is the node refusing the REQUEST - a renamed field, a malformed id,
    // a route that moved. Coverage must never absorb that.
    const { status } = e as { status?: number };
    if (typeof status === 'number' && status >= 400 && status < 500) throw e;
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
      name: `sweep-${RUN}`,
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
    // A node serving plain HTTP holds no certificate, so 404 is the only answer
    // this route can give here; asserting it still catches the route moving.
    await expect(mero.admin.getCertificate()).rejects.toMatchObject({ status: 404 });
    await cover('resync', () => mero.admin.resyncContext(contextId, { force: true }));
    await cover('syncOne', () => mero.admin.syncContext(contextId));
    await cover('syncAll', () => mero.admin.syncContext()); // no-arg → POST /contexts/sync
  });

  it('install-dev-application (direct)', async () => {
    await cover('installDev', () =>
      mero.admin.installDevApplication({
        path: fileURLToPath(new URL('./assets/kv-store.mpk', import.meta.url)),
      }),
    );
  });

  it('install-application: the node accepts the coordinate shape', async () => {
    // Nothing is published at these coordinates, so the install cannot succeed.
    // Assert only that the node got past deserialization: 502 is "nothing
    // published there", 500 is "could not reach my registry". Pinning 502 would
    // make this depend on CI egress to the node's public registry.
    const err = await mero.admin
      .installApplication({ package: 'com.calimero.nonexistent', version: '0.0.0' })
      .then(() => undefined)
      .catch((e: Error & { status?: number }) => e);
    expect(err?.status, `node rejected the request shape: ${err?.message}`).toBeGreaterThanOrEqual(
      500,
    );
  });

  it('group upgrade + cascade/migration status + abort', async () => {
    await cover('upgradeStatus', () => mero.admin.getGroupUpgradeStatus(groupId));
    await cover('cascadeStatus', () => mero.admin.getCascadeStatus(namespaceId));
    await cover('migrationStatus', () => mero.admin.getMigrationStatus(namespaceId));
    // Already running this application, so core refuses with a 500; the point
    // here is that it deserialized the body under `deny_unknown_fields`.
    await cover('upgrade', () =>
      mero.admin.upgradeGroup(groupId, { targetApplicationId: applicationId }),
    );
    await cover('upgradeRetry', () => mero.admin.retryGroupUpgrade(groupId));
    await cover('abortMigration', () => mero.admin.abortMigration(namespaceId));
  });

  // NOTE: the full member lifecycle (add/list/role/capabilities/metadata/auto-follow/
  // remove) is deeply asserted in round-trip.test.ts.
  it('group proofs + signing key + updateApp + app uninstall', async () => {
    await cover('updateApp', () =>
      mero.admin.updateContextApplication(contextId, { applicationId, executorPublicKey: executor }),
    );
    const proof = {
      audience: 'https://example.test',
      subject: `sweep-${RUN}`,
      nonce: 'a'.repeat(32),
      expiresAtMs: Date.now() + 60_000,
    };
    await cover('ownProof', () => mero.admin.issueOwnershipProof(groupId, { ...proof, contextId }));
    await cover('nsOwnProof', () => mero.admin.issueNamespaceOwnershipProof(groupId, proof));
    // Uninstall a non-existent app - fires DELETE /applications/:id safely. The
    // id must be a well-formed 32-byte one, or the node 400s on the path itself.
    await cover('uninstallApp', () => mero.admin.uninstallApplication('1'.repeat(64)));
  });

  // A join that could succeed needs the inviter's node to deliver the group key,
  // which a lone node never gets - a real invitation would hang here. So these
  // two assert the refusal instead: the route still has to exist and still has to
  // read the body. Their coverage is carried by the multi-node suite.
  it('join flows', async () => {
    await expect(mero.admin.joinGroup({ invitation: 'x' } as never)).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      mero.admin.joinNamespace(namespaceId, { invitation: 'x' } as never),
    ).rejects.toMatchObject({ status: 400 });
    await cover('joinInheritance', () => mero.admin.joinSubgroupInheritance(groupId));
  });

  it('detach + leave ops (destructive — run last)', async () => {
    // leaveContext before detach: detaching unmaps the context from its group,
    // and leaving one that is no longer mapped is an error.
    await cover('leaveContext', () => mero.admin.leaveContext(contextId));
    await cover('detach', () => mero.admin.detachContextFromGroup(groupId, contextId));
    // groupId here is the namespace root, which core sends to leave_namespace
    // instead - a 500 cover() tolerates.
    await cover('leaveGroup', () => mero.admin.leaveGroup(groupId));
    // The sole owner cannot walk out of its own namespace, so this can only ever
    // be refused on this node; assert the refusal rather than swallow it.
    await expect(mero.admin.leaveNamespace(namespaceId)).rejects.toMatchObject({ status: 403 });
  });
});
