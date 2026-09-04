/**
 * Route-coverage sweep: fires a well-formed request at every admin route the
 * asserting flows don't reach, so the route-coverage gate sees them.
 *
 * These are best-effort: the recorder logs a path when the request FIRES (before
 * the response), so a call that 4xx's for a state reason (e.g. can't upgrade
 * without a newer bundle, can't leave as sole owner) still proves the SDK sent a
 * request to the right URL and method. Deep success assertions live in the main
 * flows.
 *
 * What cover() does NOT prove is that the node accepted the request BODY — a 400
 * from a stale field shape is indistinguishable from a state 4xx here, and the
 * route still records as covered. On a route where core rejects unknown fields,
 * assert the shape explicitly instead of cover()ing it.
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

/** Exercise a route for coverage; tolerate state-dependent failures. */
async function cover(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    // The request still fired (recorded) — log why it didn't fully succeed.
    console.log(`(cover) ${label}: ${(e as Error).message?.slice(0, 90)}`);
  }
}

/**
 * Like {@link cover}, but for a route whose body core declares
 * `deny_unknown_fields`: a state 4xx still passes, a 400 (stale SDK shape) does
 * not.
 */
async function coverShape(label: string, fn: () => Promise<unknown>): Promise<void> {
  const err = await fn()
    .then(() => undefined)
    .catch((e: Error & { status?: number; bodyText?: string }) => e);
  if (!err) return;
  // Require a status, so a transport fault cannot pass this vacuously.
  expect(err.status, `${label}: no HTTP response from the node: ${err.message}`).toBeTypeOf(
    'number',
  );
  expect(err.status, `${label}: node rejected the request shape: ${err.bodyText ?? ''}`).not.toBe(
    400,
  );
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
    await cover('certificate', () => mero.admin.getCertificate());
    await cover('resync', () => mero.admin.resyncContext(contextId, { force: true }));
    await cover('syncOne', () => mero.admin.syncContext(contextId));
    await cover('syncAll', () => mero.admin.syncContext()); // no-arg → POST /contexts/sync
    expect(true).toBe(true);
  });

  it('install-dev-application (direct)', async () => {
    await cover('installDev', () =>
      mero.admin.installDevApplication({
        path: fileURLToPath(new URL('./assets/kv-store.mpk', import.meta.url)),
      }),
    );
    expect(true).toBe(true);
  });

  /**
   * The one asserted route in this file. Core sets `deny_unknown_fields` on the
   * install body, so a stale SDK shape earns a 400 that cover() would swallow.
   * These coordinates have nothing published at them, so the install cannot
   * succeed — assert only that the node got past deserialization: 502 is
   * "nothing published there", 500 is "could not reach my registry". Pinning
   * 502 would make this depend on CI egress to the node's public registry.
   */
  it('install-application: the node accepts the coordinate shape', async () => {
    await coverShape('installApp', () =>
      mero.admin.installApplication({ package: 'com.calimero.nonexistent', version: '0.0.0' }),
    );
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
  // remove) is deeply asserted in round-trip.test.ts.
  it('group proofs + signing key + updateApp + app uninstall', async () => {
    await cover('updateApp', () =>
      mero.admin.updateContextApplication(contextId, { applicationId, executorPublicKey: executor }),
    );
    // Both proof bodies are `deny_unknown_fields` and validated, so assert the
    // shape rather than cover()ing it. Issuing may still 4xx on ownership state.
    const proof = {
      audience: 'https://example.test',
      subject: `sweep-${RUN}`,
      nonce: 'a'.repeat(32),
      expiresAtMs: Date.now() + 60_000,
    };
    await coverShape('ownProof', () =>
      mero.admin.issueOwnershipProof(groupId, { ...proof, contextId }),
    );
    await coverShape('nsOwnProof', () => mero.admin.issueNamespaceOwnershipProof(groupId, proof));
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
    await cover('detach', () => mero.admin.detachContextFromGroup(groupId, contextId));
    await cover('leaveContext', () => mero.admin.leaveContext(contextId));
    await cover('leaveGroup', () => mero.admin.leaveGroup(groupId));
    await cover('leaveNamespace', () => mero.admin.leaveNamespace(namespaceId));
    expect(true).toBe(true);
  });
});
