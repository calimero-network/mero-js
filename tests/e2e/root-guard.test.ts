/**
 * Root-guarded owner ops against a live node (core schema 18).
 *
 * The CI node is `merod init`ed, so it holds the account root its device speaks
 * for, and is the owner of every namespace it founds. Every call here therefore
 * omits `rootProof` and has the node sign the proof itself: that is the path a
 * node-held root takes, and it proves each new route answers under 400.
 *
 * The owner hands things to ITSELF (the node is the only account this harness
 * has): a transfer to the current owner, and an admin change to the current
 * admin. Both are full applies of the guarded op, so each spends the group's
 * guarded-op counter, which is what the test reads back.
 *
 * A proof from an account the node does not hold is the other path: signed
 * offline by a stranger's root, it is refused as not the signer's own.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MeroJs } from '../../src/mero-js.js';
import { adminChangedOp, signOwnerOpProof } from '../../src/owner-op/index.js';
import { ensureApplication, resolveBaseUrl, resolveCreds, runId } from './harness.js';

const NODE_URL = resolveBaseUrl();
const CREDS = resolveCreds();
const RUN = runId();

let mero: MeroJs;
let namespaceId: string;
let owner: string;

async function counter(groupId: string): Promise<number> {
  const info = await mero.admin.getGroupInfo(groupId);
  expect(info.ownerOpCounter, 'a schema-18 node reports the counter').toBeTypeOf('number');
  return info.ownerOpCounter ?? -1;
}

beforeAll(async () => {
  mero = new MeroJs({ baseUrl: NODE_URL });
  await mero.authenticate(CREDS);
  const applicationId = await ensureApplication(mero);
  const ns = await mero.admin.createNamespace({ applicationId, name: `rg-${RUN}` });
  namespaceId = ns.namespaceId;
  owner = (await mero.admin.getNodeIdentity()).accountId;
}, 60000);

afterAll(async () => {
  if (namespaceId) await mero.admin.deleteNamespace(namespaceId).catch(() => {});
  mero.close();
}, 60000);

describe('Root-guarded owner ops — node-held root', () => {
  it('reports the namespace and a zero counter on a fresh namespace', async () => {
    const info = await mero.admin.getGroupInfo(namespaceId);
    expect(info.namespaceId).toBe(namespaceId);
    expect(info.ownerOpCounter).toBe(0);
  });

  it('changes the namespace admin, and spends the counter', async () => {
    const before = await counter(namespaceId);
    await expect(
      mero.admin.changeNamespaceAdmin(namespaceId, { newAdmin: owner }),
    ).resolves.toBeUndefined();
    expect(await counter(namespaceId)).toBe(before + 1);
  });

  it('transfers ownership, and spends the counter', async () => {
    const before = await counter(namespaceId);
    await expect(
      mero.admin.transferOwnership(namespaceId, { newOwner: owner }),
    ).resolves.toBeUndefined();
    expect(await counter(namespaceId)).toBe(before + 1);
  });

  it('deletes an empty subgroup through the owner-only path', async () => {
    const { groupId } = await mero.admin.createGroupInNamespace(namespaceId, {
      groupName: `rg-sub-${RUN}`,
    });
    await expect(mero.admin.ownerDeleteGroup(groupId)).resolves.toBeUndefined();
  });
});

describe('Root-guarded owner ops — supplied proof', () => {
  it("refuses a proof signed by another account's root", async () => {
    const info = await mero.admin.getGroupInfo(namespaceId);
    const stranger = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    const rootProof = await signOwnerOpProof({
      rootSecret: stranger,
      namespaceId,
      groupId: namespaceId,
      op: adminChangedOp(owner),
      counter: info.ownerOpCounter ?? 0,
    });
    await expect(
      mero.admin.changeNamespaceAdmin(namespaceId, { newAdmin: owner, rootProof }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
