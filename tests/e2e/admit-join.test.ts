/**
 * E2E for direct admission — naming who may admit a join, and handing a signed
 * join to one of them.
 *
 * Covers `POST /admin-api/namespaces/:namespace_id/admit` and the `admitters`
 * field on group invitations.
 *
 * What is proven here is the endpoint's refusals and the round trip of the
 * signed `admitters` list. The happy path — a keyholder with no node signing its
 * own membership op and getting admitted — needs this SDK to borsh-encode and
 * sign a `SignedNamespaceOp`, which it cannot do yet. That signer is the
 * follow-up; until it lands, no test here can claim a join succeeded, and none
 * of them do.
 *
 * Run manually:
 *   NODE_URL=http://localhost:4001 pnpm test:e2e
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MeroJs } from '../../src/mero-js.js';
import { resolveBaseUrl, resolveCreds, ensureApplication, runId } from './harness.js';

const NODE_URL = resolveBaseUrl();
const { username: USERNAME, password: PASSWORD } = resolveCreds();
const RUN = runId();

let mero: MeroJs;
let namespaceId: string;
let groupId: string;
let selfAccount: string;

describe('Direct admission E2E', () => {
  beforeAll(async () => {
    mero = new MeroJs({ baseUrl: NODE_URL });
    await mero.authenticate({ username: USERNAME, password: PASSWORD });
    const applicationId = await ensureApplication(mero);

    const ns = await mero.admin.createNamespace({
      name: `admit-${RUN}`,
      applicationId,
    });
    namespaceId = ns.namespaceId;
    groupId = ns.groupId;

    selfAccount = (await mero.admin.getNodeIdentity()).accountId;
    expect(selfAccount).toMatch(/^[0-9a-f]{64}$/);
  }, 60000);

  afterAll(() => {
    mero?.destroy?.();
  });

  it('signs the admitter list into the invitation it returns', async () => {
    const created = await mero.admin.createGroupInvitation(groupId, {
      admitters: [selfAccount],
    });
    expect('invitation' in created).toBe(true);
    if (!('invitation' in created)) return;

    // 32 bytes, and the account we named — the list travels inside the
    // inviter's signature, so a joiner can tell who is allowed to admit it
    // without trusting whoever handed it the invitation.
    const admitters = created.invitation.invitation.admitters;
    expect(admitters).toBeDefined();
    expect(admitters).toHaveLength(1);
    expect(admitters?.[0]).toHaveLength(32);

    const asHex = Buffer.from(admitters![0]!).toString('hex');
    expect(asHex).toBe(selfAccount);
  }, 30000);

  it('refuses an op it cannot decode, rather than publishing it blind', async () => {
    const created = await mero.admin.createGroupInvitation(groupId, {
      admitters: [selfAccount],
    });
    if (!('invitation' in created)) throw new Error('expected a single invitation');

    // A designated admitter publishes on its own connection, so relaying opaque
    // bytes would make it an injector for the namespace topic. It decodes first.
    await expect(
      mero.admin.admitJoin(namespaceId, {
        invitation: created.invitation,
        signedOp: 'deadbeef',
      }),
    ).rejects.toThrow();
  }, 30000);

  it('refuses an empty op', async () => {
    const created = await mero.admin.createGroupInvitation(groupId, {
      admitters: [selfAccount],
    });
    if (!('invitation' in created)) throw new Error('expected a single invitation');

    await expect(
      mero.admin.admitJoin(namespaceId, {
        invitation: created.invitation,
        signedOp: '',
      }),
    ).rejects.toThrow();
  }, 30000);
});
