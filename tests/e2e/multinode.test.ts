/**
 * Multi-node E2E: drives the SDK across TWO live nodes to assert a real cross-node
 * flow (node-1 invites → node-2 joins). Needs a 2-node cluster, so it's gated
 * behind MERO_MULTINODE; the single-node CI skips it. The dedicated multi-node CI
 * job boots two embedded-auth merod nodes and sets MERO_NODE1_URL/MERO_NODE2_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MeroJs } from '../../src/mero-js.js';
import type { CreateGroupInvitationResponseData } from '../../src/admin-api/admin-types.js';
import { resolveCreds, ensureApplication, runId } from './harness.js';

const N1 = process.env.MERO_NODE1_URL ?? 'http://localhost:4501';
const N2 = process.env.MERO_NODE2_URL ?? 'http://localhost:4502';
const CREDS = resolveCreds();
const RUN = runId();

// Only run when a real 2-node cluster is provided.
const suite = process.env.MERO_MULTINODE ? describe : describe.skip;

let n1: MeroJs;
let n2: MeroJs;
let applicationId: string;
let namespaceId: string;
/** node-2's account in the namespace: what every member-addressing route takes. */
let memberAccount: string;

suite('Multi-node E2E — namespace invite/join', () => {
  beforeAll(async () => {
    // A debug merod (core's SDK e2e builds one) can outlast the 10s default on
    // a cold first call, and every governance op here waits for peer acks.
    n1 = new MeroJs({ baseUrl: N1, timeoutMs: 60_000 });
    await n1.authenticate(CREDS);
    n2 = new MeroJs({ baseUrl: N2, timeoutMs: 60_000 });
    await n2.authenticate(CREDS);

    // Both nodes need the application to run the shared context.
    applicationId = await ensureApplication(n1);
    await ensureApplication(n2);

    const ns = await n1.admin.createNamespace({
      applicationId,
      name: `mn-${RUN}`,
    });
    namespaceId = ns.namespaceId;
  }, 90000);

  afterAll(async () => {
    if (namespaceId) await n1?.admin.deleteNamespace(namespaceId).catch(() => {});
    n1?.close();
    n2?.close();
  }, 60000);

  it('node-1 issues an open invitation → node-2 joins the namespace', async () => {
    const inv = (await n1.admin.createNamespaceInvitation(namespaceId, {})) as {
      invitation?: unknown;
    };
    expect(inv.invitation).toBeTruthy();

    const joined = await n2.admin.joinNamespace(namespaceId, {
      invitation: inv.invitation as never,
    });
    // node-2 is now a member of the namespace (got its own member identity back).
    expect(joined.memberIdentity).toBeTruthy();
    // `namespaceId`, not `groupId`: core 0.11.0-rc.25 renamed this field
    // (core#3598). Asserted here rather than only in the unit tests because
    // this runs against a real released merod, so it is what catches the next
    // rename on the way in.
    //
    // Shape rather than equality against the id we joined with: what is being
    // pinned is that the field is present and renders as an id at all.
    expect(joined.namespaceId).toMatch(/^[0-9a-f]{64}$/);
    // The account it joined as, not the key it signs with: this is what every
    // member-addressing endpoint takes. Both render as 64 hex, so the shape
    // cannot tell them apart - see the listing note in round-trip.test.ts.
    expect(joined.memberAccount).toMatch(/^[0-9a-f]{64}$/);
    memberAccount = joined.memberAccount;
  });

  /**
   * Context-aware blob discovery, end to end: node-1 announces a blob to a
   * context, node-2 — which does not hold it — discovers and pulls it by
   * passing the same context.
   *
   * The negative control is what makes this test mean anything. Blobs are
   * content-addressed, so a node that happens to already hold identical bytes
   * answers a local read and never touches the network; without proving node-2
   * cannot serve the blob locally first, a green cross-node fetch could be a
   * purely local read and prove nothing. Hence: random bytes (so no other run's
   * blob collides), and an asserted local-only 404 on node-2 before the
   * context-scoped fetch.
   */
  it('node-1 announces a blob to the context → node-2 discovers it with contextId', async () => {
    // A context in the namespace both nodes are now members of. node-2 picks it
    // up through the namespace it joined in the previous test, so wait for it to
    // land rather than assuming replication is instantaneous.
    const created = await n1.admin.createContext({
      applicationId,
      groupId: namespaceId,
      name: `blob-${RUN}`,
    });
    const contextId = created.contextId;
    await waitFor(
      async () =>
        (await n2.admin.getContexts()).contexts.find((c) => c.id === contextId)?.id,
      90000,
    );

    // Random, so these exact bytes exist nowhere else: their blob id cannot be
    // one a previous run left sitting in node-2's store.
    const bytes = new Uint8Array(4096);
    crypto.getRandomValues(bytes);

    const { blobId } = await n1.admin.uploadBlob({ data: bytes, contextId });
    expect(blobId).toBeTruthy();

    // NEGATIVE CONTROL — node-2 must not already hold these bytes. A local-only
    // read (no contextId) has to fail, or the fetch below proves nothing.
    // Specifically a 404 — "not here" — so an auth or transport failure can't
    // stand in for the control and let a local read pass as a network fetch.
    await expect(n2.admin.getBlob(blobId)).rejects.toThrow(/404/);

    // The real assertion: with the context, node-2 probes the context's peers,
    // finds node-1 holding the blob, and transfers the bytes.
    const fetched = await n2.admin.getBlob(blobId, { contextId });
    expect(new Uint8Array(fetched)).toEqual(bytes);

    // getBlobInfo also accepts the context and reports the size. Discovery
    // stores what it fetched, so by now node-2 holds the blob and this HEAD is
    // answered locally — it pins the wire shape (the query is accepted, the
    // response still parses), NOT the probe path, which needs a node that has
    // never held the blob.
    const info = await n2.admin.getBlobInfo(blobId, { contextId });
    expect(info.size).toBe(bytes.length);
  }, 180000);

  it('node-2 joins a subgroup by invitation, then leaves it', async () => {
    const subgroupId = await subgroupJoinedByNode2(`leave-${RUN}`);
    await n2.admin.leaveGroup(subgroupId);
    await waitFor(async () => ((await roleOnNode1(subgroupId)) === undefined ? true : undefined), 60000);
  }, 120000);

  it('node-1 removes node-2 from a subgroup it joined', async () => {
    const subgroupId = await subgroupJoinedByNode2(`remove-${RUN}`);
    await n1.admin.removeGroupMembers(subgroupId, { members: [memberAccount] });
    expect(await roleOnNode1(subgroupId)).toBeUndefined();
  }, 120000);

  it("node-1 sets node-2's role, auto-follow and metadata in the namespace", async () => {
    await n1.admin.updateMemberRole(namespaceId, memberAccount, { role: 'Admin' });
    expect(await roleOnNode1(namespaceId)).toBe('Admin');
    await n1.admin.updateMemberRole(namespaceId, memberAccount, { role: 'Member' });
    expect(await roleOnNode1(namespaceId)).toBe('Member');

    await n1.admin.setMemberAutoFollow(namespaceId, memberAccount, {
      autoFollowContexts: true,
      autoFollowSubgroups: false,
    });

    const tag = `mn-${RUN}`;
    await n1.admin.setMemberMetadata(namespaceId, memberAccount, { data: { tag } });
    const meta = await n1.admin.getMemberMetadata(namespaceId, memberAccount);
    expect(meta?.data).toMatchObject({ tag });
  }, 60000);

  // Last: node-2 is out of the namespace afterwards.
  it('node-2 leaves the namespace', async () => {
    await n2.admin.leaveNamespace(namespaceId);
    await waitFor(async () => ((await roleOnNode1(namespaceId)) === undefined ? true : undefined), 60000);
  }, 120000);
});

/**
 * node-1 creates a subgroup of the namespace and invites node-2, which joins
 * it. Resolves once node-1 lists node-2 as a member, so a call that addresses
 * node-2 there cannot race the join.
 */
async function subgroupJoinedByNode2(name: string): Promise<string> {
  const { groupId } = await n1.admin.createGroup({
    applicationId,
    parentGroupId: namespaceId,
    name,
    visibility: 'restricted',
  });
  // Not recursive, so the single-invitation shape.
  const { invitation } = (await n1.admin.createGroupInvitation(
    groupId,
    {},
  )) as CreateGroupInvitationResponseData;
  const joined = await n2.admin.joinGroup({ invitation });
  expect(joined.groupId).toBe(groupId);
  await waitFor(async () => roleOnNode1(groupId), 60000);
  return groupId;
}

/** node-2's role in `groupId` as node-1 lists it, or undefined if it is not a member. */
async function roleOnNode1(groupId: string): Promise<string | undefined> {
  const { members } = await n1.admin.listGroupMembers(groupId);
  return members.find((m) => m.identity === memberAccount)?.role;
}

/** Poll `fn` until it returns something defined, or the budget runs out. */
async function waitFor<T>(fn: () => Promise<T | undefined>, budgetMs: number): Promise<T> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const value = await fn().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for the condition to hold');
    await new Promise((r) => setTimeout(r, 2000));
  }
}
