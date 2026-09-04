/**
 * True end-to-end round-trips against a live node: perform an action, then read
 * it back and ASSERT the result is correct (not just that the request fired).
 * These graduate routes out of the tolerant coverage-sweep into real assertions.
 *
 * Single-node tier. Multi-node flows (join/invite) live in multinode.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

beforeAll(async () => {
  mero = new MeroJs({ baseUrl: NODE_URL });
  await mero.authenticate(CREDS);
  applicationId = await ensureApplication(mero);
  const ns = await mero.admin.createNamespace({
    applicationId,
    name: `rt-${RUN}`,
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
    // Returns the full MetadataRecord: the map lives under `.data`.
    expect(got?.data).toMatchObject(value);
    expect(got).toHaveProperty('updatedBy');
  });

  it('context metadata: set then get returns the same value', async () => {
    const value = { ctx: `rt-${RUN}` };
    await mero.admin.setContextMetadata(groupId, contextId, { data: value } as never);
    const got = await mero.admin.getContextMetadata(groupId, contextId);
    expect(got?.data).toMatchObject(value);
  });
});

describe('Round-trip E2E — Member lifecycle [Tier 2]', () => {
  // Skipped against a single node while members are named by account.
  //
  // A direct add still takes the KEY an operator holds, but the apply resolves
  // that key to the account membership is keyed by — which exists only for
  // someone who joined the namespace already. This harness has one node, so the
  // only key it can produce is a freshly generated identity that has joined
  // nothing, and the add fails. It surfaces as a 500 rather than a 4xx naming
  // the unresolvable member, which is worth fixing on the node side
  // independently of this test.
  //
  // The body below is already converted to address the member by account, so
  // un-skipping is a matter of giving it a real joiner — multinode.test.ts is
  // where that belongs.
  it.skip('add → list (present) → role → capabilities → metadata set/get → remove → gone', async () => {
    const id = (await mero.admin.generateContextIdentity()) as { publicKey?: string };
    const memberPk = id.publicKey!;
    expect(memberPk).toBeTruthy();

    const listMemberIds = async (): Promise<string[]> => {
      const res = (await mero.admin.listGroupMembers(groupId)) as {
        members?: Array<{ identity?: string }>;
      };
      const rows = res.members ?? (res as unknown as Array<{ identity?: string }>);
      return rows.map((m) => m.identity).filter((id): id is string => Boolean(id));
    };

    const before = await listMemberIds();

    // GroupMemberRole serializes PascalCase: Admin | Member | ReadOnly | ReadOnlyTee.
    await mero.admin.addGroupMembers(groupId, {
      members: [{ identity: memberPk, role: 'Member' }],
    } as never);

    // A member is ADDED by the key it signs with, and ADDRESSED by the account
    // that key writes as. Both are 32 bytes rendered as 64 hex, so nothing in
    // either string says which it is - passing one where the other belongs
    // addresses a different member silently rather than failing. The listing is
    // where the account becomes knowable: it is a hash of a root this caller has
    // never seen, so there is nothing to derive it from locally.
    const added = (await listMemberIds()).filter((id) => !before.includes(id));
    expect(added.length).toBe(1);
    const memberAccount = added[0]!;
    expect(memberAccount).not.toBe(memberPk);

    await mero.admin.updateMemberRole(groupId, memberAccount, { role: 'Admin' } as never);
    await mero.admin.setMemberCapabilities(groupId, memberAccount, { capabilities: 1 } as never);
    await mero.admin.setMemberAutoFollow(groupId, memberAccount, {
      autoFollowContexts: true,
      autoFollowSubgroups: true,
    } as never);

    await mero.admin.setMemberMetadata(groupId, memberAccount, {
      data: { tag: `rt-${RUN}` },
    } as never);
    const meta = await mero.admin.getMemberMetadata(groupId, memberAccount);
    expect(meta?.data).toMatchObject({ tag: `rt-${RUN}` });

    await mero.admin.removeGroupMembers(groupId, { members: [memberAccount] } as never);
    const post = (await mero.admin.listGroupMembers(groupId)) as {
      members?: Array<{ identity?: string }>;
    };
    const left = post.members ?? (post as unknown as Array<{ identity?: string }>);
    expect(left.some((m) => m.identity === memberAccount)).toBe(false);
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

  // POST /admin-api/groups requires applicationId (not just a name).
  it('createGroup then getGroupInfo returns it', async () => {
    const created = await mero.admin.createGroup({
      applicationId,
      name: `rt-grp-${RUN}`,
    });
    expect(created.groupId).toBeTruthy();
    const info = (await mero.admin.getGroupInfo(created.groupId)) as Record<string, unknown>;
    expect(info).toBeTruthy();
  });
});
