/**
 * True end-to-end round-trips against a live node: perform an action, then read
 * it back and ASSERT the result is correct (not just that the request fired).
 * These graduate routes out of the tolerant coverage-sweep into real assertions.
 *
 * Single-node tier. Multi-node flows (join/invite) live in multinode.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

beforeAll(async () => {
  mero = new MeroJs({ baseUrl: NODE_URL });
  await mero.authenticate(CREDS);
  applicationId = await ensureApplication(mero);
  const ns = await mero.admin.createNamespace({
    applicationId,
    upgradePolicy: 'Automatic',
    alias: `rt-${RUN}`,
  });
  namespaceId = ns.namespaceId;
  groupId = namespaceId;
  const ctx = await mero.admin.createContext({ applicationId, groupId });
  contextId = ctx.contextId;
}, 60000);

afterAll(async () => {
  if (namespaceId) await mero.admin.deleteNamespace(namespaceId).catch(() => {});
  mero.close();
}, 60000);

describe('Round-trip E2E — Blobs', () => {
  it('upload → getBlobInfo → getBlob (bytes match) → list (present) → delete → gone', async () => {
    const bytes = new Uint8Array([7, 14, 21, 28, 35, 42, 49, 56]);

    const uploaded = await mero.admin.uploadBlob({ data: bytes });
    expect(uploaded.blobId).toBeTruthy();
    expect(uploaded.size).toBe(bytes.length);
    const blobId = uploaded.blobId;

    const info = await mero.admin.getBlobInfo(blobId);
    expect(info.blobId).toBe(blobId);
    expect(info.size).toBe(bytes.length);

    const downloaded = new Uint8Array(await mero.admin.getBlob(blobId));
    expect(Array.from(downloaded)).toEqual(Array.from(bytes));

    const { blobs } = await mero.admin.listBlobs();
    expect(blobs.some((b) => b.blobId === blobId)).toBe(true);

    const del = await mero.admin.deleteBlob(blobId);
    expect(del.deleted).toBe(true);

    // After delete the blob is gone — getBlobInfo (HEAD) should 404 (throw).
    await expect(mero.admin.getBlobInfo(blobId)).rejects.toThrow();
  });
});

describe('Round-trip E2E — Node reads', () => {
  it('getNetworkStatus returns a parsed object', async () => {
    const s = await mero.admin.getNetworkStatus();
    expect(s).toBeTypeOf('object');
    expect(s).not.toBeNull();
  });

  it('getUsage returns a parsed object', async () => {
    const u = await mero.admin.getUsage();
    expect(u).toBeTypeOf('object');
    expect(u).not.toBeNull();
  });
});

describe('Round-trip E2E — Metadata set→get', () => {
  // core's metadata `data` is a Map<String, String> — values must be strings.
  it('group metadata: set then get returns the same value', async () => {
    const value = { team: `rt-${RUN}`, role: 'lead' };
    await mero.admin.setGroupMetadata(groupId, { data: value } as never);
    const got = await mero.admin.getGroupMetadata(groupId);
    expect(got).toMatchObject(value);
  });

  it('context metadata: set then get returns the same value', async () => {
    const value = { ctx: `rt-${RUN}` };
    await mero.admin.setContextMetadata(groupId, contextId, { data: value } as never);
    const got = await mero.admin.getContextMetadata(groupId, contextId);
    expect(got).toMatchObject(value);
  });
});

describe('Round-trip E2E — Groups', () => {
  it('TEE admission policy: set then get returns it', async () => {
    const policy = {
      allowedMrtd: [],
      allowedRtmr0: [],
      allowedRtmr1: [],
      allowedRtmr2: [],
      allowedRtmr3: [],
      allowedTcbStatuses: [],
      acceptMock: true,
    };
    await mero.admin.setTeeAdmissionPolicy(groupId, policy as never);
    const got = await mero.admin.getTeeAdmissionPolicy(groupId);
    expect(got.acceptMock).toBe(true);
  });

  // POST /admin-api/groups requires applicationId + upgradePolicy (not just a name).
  it('createGroup then getGroupInfo returns it', async () => {
    const created = await mero.admin.createGroup({
      applicationId,
      upgradePolicy: 'Automatic',
      name: `rt-grp-${RUN}`,
    });
    expect(created.groupId).toBeTruthy();
    const info = (await mero.admin.getGroupInfo(created.groupId)) as Record<string, unknown>;
    expect(info).toBeTruthy();
  });
});
