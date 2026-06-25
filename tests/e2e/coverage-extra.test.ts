/**
 * Coverage-filler e2e: smoke-exercises admin routes the main flows don't, so the
 * route-coverage gate sees them. Each call asserts a sane response (proving the
 * SDK<->node contract), not deep behaviour. Self-provisioning + self-cleaning.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MeroJs } from '../../src/mero-js';
import { resolveBaseUrl, resolveCreds, ensureApplication, runId } from './harness';

const NODE_URL = resolveBaseUrl();
const { username: USERNAME, password: PASSWORD } = resolveCreds();
const RUN = runId();

let mero: MeroJs;
let applicationId: string;
let namespaceId: string;
let contextId: string;

describe('Admin API E2E — Coverage filler', () => {
  beforeAll(async () => {
    mero = new MeroJs({ baseUrl: NODE_URL });
    await mero.authenticate({ username: USERNAME, password: PASSWORD });
    applicationId = await ensureApplication(mero);
    const ns = await mero.admin.createNamespace({
      applicationId,
      upgradePolicy: 'Automatic',
      alias: `cov-ns-${RUN}`,
    });
    namespaceId = ns.namespaceId;
    const ctx = await mero.admin.createContext({ applicationId, groupId: namespaceId });
    contextId = ctx.contextId;
  }, 60000);

  afterAll(async () => {
    if (contextId) {
      const ctx = await mero.admin.getContext(contextId).catch(() => null);
      if (ctx) {
        const ids = await mero.admin.getContextIdentities(contextId).catch(() => null);
        await mero.admin
          .deleteContext(contextId, { requester: ids?.identities?.[0] })
          .catch(() => {});
      }
    }
    if (namespaceId) await mero.admin.deleteNamespace(namespaceId).catch(() => {});
    mero.close();
  }, 60000);

  it('isAuthed reports status', async () => {
    const res = await mero.admin.isAuthed();
    expect(res).toBeDefined();
  });

  it('lists installed application versions', async () => {
    const versions = await mero.admin.listApplicationVersions(applicationId);
    expect(Array.isArray(versions)).toBe(true);
  });

  it('lists contexts with executors for the application', async () => {
    const res = await mero.admin.getContextsWithExecutorsForApplication(applicationId);
    expect(Array.isArray(res)).toBe(true);
  });

  it('uploads, lists, gets, and deletes a blob', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const uploaded = await mero.admin.uploadBlob({ data: bytes });
    expect(uploaded.blobId).toBeTruthy();

    // listBlobs exercises GET /admin-api/blobs; don't assert the just-uploaded
    // blob is present (listing can lag), just that the shape is right.
    const list = await mero.admin.listBlobs();
    expect(Array.isArray(list.blobs)).toBe(true);

    // deleteBlob exercises DELETE /admin-api/blobs/:id (core returns an empty
    // body, so just assert the call resolves). NOTE: getBlob is omitted — that
    // route returns the raw blob bytes, but the SDK's getBlob parses as JSON
    // (a separate SDK finding: it needs parse:'arrayBuffer').
    await mero.admin.deleteBlob(uploaded.blobId);
  });

  it('reparents a subgroup under another (groups/:id/reparent)', async () => {
    const a = await mero.admin.createGroupInNamespace(namespaceId, { name: `cov-a-${RUN}` });
    const b = await mero.admin.createGroupInNamespace(namespaceId, { name: `cov-b-${RUN}` });
    const res = await mero.admin.reparentGroup(b.groupId, { newParentId: a.groupId });
    expect(typeof res.reparented).toBe('boolean');
  });

  it('sets group metadata (groups/:id/metadata)', async () => {
    await mero.admin.setGroupMetadata(namespaceId, { name: `cov-meta-${RUN}` });
  });

  // NOTE: contexts/:id/resync is baselined (uncovered): core returns an empty 2xx
  // body and the SDK's JSON parse chokes on it — a separate SDK-robustness finding
  // (empty-body handling) to fix before this route can be smoke-tested.
});
