/**
 * E2E for delegated governance: a member with no node adds someone to a group
 * and creates a subgroup, through a relay, under warrants this SDK signs.
 *
 * `GET`/`POST /admin-api/groups/{group_id}/governance-intents` had no SDK call
 * that answered under 400, which is what core's coverage gate counts. The
 * warrants here are real (`signGovernanceWarrant`, through `RelayClient.govern`)
 * and each one's effect is read back from the node: the new member is in the
 * group with the role signed for, and the new subgroup exists with the
 * **author** as its admin. A fabricated warrant would 4xx, register the route,
 * and prove nothing.
 *
 * It covers both planes a governance warrant can name: a group op
 * (`MemberAdded`, published on the namespace group itself) and a root op
 * (`GroupCreated`, published on the namespace log). The relay holds no right to
 * either op; the author does, and every peer applies the op as the author.
 *
 * And the genesis: the author founds a namespace of its own through the relay
 * (`NamespaceCreatedV2` under a warrant scoped to the id derived from the
 * author and a salt), becomes its admin, and can govern it through the same
 * relay straight away, since the relay is seated as its founding relay.
 *
 * Same rig as `delegated-creation.test.ts`: the relay is a node serving
 * delegated execution publicly, and setup goes to its unguarded admin API.
 *
 * Requires `NODE_TEE_RELAY_URL` and `MEROD_BINARY`; skipped without either.
 *
 *   NODE_TEE_RELAY_URL=http://localhost:2468 MEROD_BINARY=... pnpm test:e2e -- delegated-governance
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MeroJs } from '../../src/mero-js.js';
import { IntentRefusedError, RelayClient } from '../../src/relay/relay-client.js';
import { createMemoryNonceSource } from '../../src/relay/nonce-source.js';
import { signerFromSecret } from '../../src/signer/index.js';
import { generateAccountRoot } from '../../src/account/index.js';
import {
  foundedNamespaceId,
  groupCreatedOp,
  memberAddedOp,
} from '../../src/warrant/governance-op.js';
import {
  MEROD_BINARY,
  ensureApplication,
  mintDevice,
  runId,
  type MintedDevice,
} from './harness.js';

const RELAY_URL = process.env.NODE_TEE_RELAY_URL;
const RUN = runId();
/** `MemberCapabilities::MANAGE_MEMBERS`: bit 3. */
const MANAGE_MEMBERS = 8;
/** `MemberCapabilities::CAN_CREATE_SUBGROUP`: bit 5. */
const CAN_CREATE_SUBGROUP = 32;
/** `MemberCapabilities::CAN_AUTHOR_ON_BEHALF`: bit 9. */
const CAN_AUTHOR_ON_BEHALF = 512;

const randomId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

describe.skipIf(!RELAY_URL || !MEROD_BINARY)('govern E2E: delegated governance', () => {
  const relayUrl = RELAY_URL as string;
  let operator: MeroJs;
  let namespaceId: string;
  let relayAccount: string;
  /** The relay's signing key, which a refusal of the AUTHOR's authority must not name. */
  let relayKey: string;
  let device: MintedDevice;
  let relay: RelayClient;

  beforeAll(async () => {
    operator = new MeroJs({ baseUrl: relayUrl, timeoutMs: 60_000 });
    const applicationId = await ensureApplication(operator);
    namespaceId = (
      await operator.admin.createNamespace({ applicationId, name: `deleg-gov-${RUN}` })
    ).namespaceId;
    const identity = await operator.admin.getNodeIdentity();
    relayAccount = identity.accountId;
    relayKey = identity.publicKey;

    device = mintDevice();
    await operator.admin.addGroupMembers(namespaceId, {
      members: [{ identity: device.account, role: 'Member' }],
    });

    relay = new RelayClient({
      relayUrl,
      authorAccount: device.account,
      authorProof: device.credential,
      // Through a Signer, the path a non-extractable key takes.
      signer: await signerFromSecret(device.secret, 'deviceSecret'),
      nonces: createMemoryNonceSource(1),
      timeoutMs: 60_000,
    });
  }, 180_000);

  afterAll(() => operator?.close());

  it('describes the relay as unable to act before the grant', async () => {
    await expect(relay.describeGovernance(namespaceId)).resolves.toEqual({
      executorAccount: relayAccount,
      groupId: namespaceId,
      canActOnBehalf: false,
    });
    // Refused on that answer, before a nonce is spent.
    await expect(
      relay.govern({ groupId: namespaceId, op: memberAddedOp(relayAccount, 'Member') }),
    ).rejects.toBeInstanceOf(IntentRefusedError);
  }, 60_000);

  it('describes the relay as able to act once granted', async () => {
    await operator.admin.setMemberCapabilities(namespaceId, relayAccount, {
      capabilities: CAN_AUTHOR_ON_BEHALF,
    });
    // The rights to the ops are the AUTHOR's: the relay is granted neither.
    await operator.admin.setMemberCapabilities(namespaceId, device.account, {
      capabilities: MANAGE_MEMBERS | CAN_CREATE_SUBGROUP,
    });

    await expect(relay.describeGovernance(namespaceId)).resolves.toEqual({
      executorAccount: relayAccount,
      groupId: namespaceId,
      canActOnBehalf: true,
    });
  }, 60_000);

  it('adds a member as the author (group op)', async () => {
    // Someone with no node and no prior tie to this namespace: a fresh account.
    const newcomer = (await generateAccountRoot()).accountId;

    await expect(
      relay.govern({ groupId: namespaceId, op: memberAddedOp(newcomer, 'Member') }),
    ).resolves.toEqual({ groupId: namespaceId });

    const { members } = await operator.admin.listGroupMembers(namespaceId);
    expect(members).toContainEqual(
      expect.objectContaining({ identity: newcomer, role: 'Member' }),
    );
  }, 120_000);

  it('refuses an op the author has no right to', async () => {
    // MANAGE_MEMBERS does not reach admin-making. The relay holds nothing that
    // would let it either, so the only authority in play is the author's.
    const stranger = (await generateAccountRoot()).accountId;
    const err = await relay
      .govern({ groupId: namespaceId, op: memberAddedOp(stranger, 'Admin') })
      .catch((e: unknown) => e);

    // Refused at the API, before anything is published, by the ordinary
    // add-an-admin gate run against the author's device key. Not the relay's:
    // the relay is this namespace's admin, so its key would have passed.
    expect(err).toBeInstanceOf(IntentRefusedError);
    const refusal = err as IntentRefusedError;
    expect(refusal.status).toBe(403);
    expect(refusal.retryable).toBe(false);
    expect(refusal.reason).toMatch(/is not an admin/);
    expect(refusal.reason).not.toContain(relayKey);

    const { members } = await operator.admin.listGroupMembers(namespaceId);
    expect(members.map((m) => m.identity)).not.toContain(stranger);
  }, 120_000);

  it('creates a subgroup the author owns (root op, on the namespace)', async () => {
    const subgroupId = randomId();

    await expect(
      relay.govern({
        groupId: namespaceId,
        op: groupCreatedOp({
          groupId: subgroupId,
          parentId: namespaceId,
          restricted: true,
          admin: device.account,
        }),
      }),
    ).resolves.toEqual({ groupId: subgroupId });

    const groups = await operator.admin.listNamespaceGroups(namespaceId);
    expect(groups.map((g) => g.groupId)).toContain(subgroupId);
    await expect(operator.admin.getGroupInfo(subgroupId)).resolves.toMatchObject({
      groupId: subgroupId,
    });

    // The AUTHOR is the subgroup's admin; the relay that published it gained
    // nothing by doing so.
    const { members } = await operator.admin.listGroupMembers(subgroupId);
    expect(members).toContainEqual(
      expect.objectContaining({ identity: device.account, role: 'Admin' }),
    );
    expect(members).not.toContainEqual(
      expect.objectContaining({ identity: relayAccount, role: 'Admin' }),
    );
  }, 120_000);

  it('founds a namespace the author owns, and governs it through the same relay', async () => {
    // mero-chat's mask: core founds with a minimal default and the app names its own.
    const MASK = 231;
    const founded = await relay.foundNamespace({
      executorAccount: relayAccount,
      defaultCapabilities: MASK,
    });
    expect(founded.namespaceId).toBe(await foundedNamespaceId(device.account, founded.salt));
    expect(typeof founded.teeEnabled).toBe('boolean');
    if (!founded.teeEnabled && founded.teeError) {
      // A relay that is not a TEE says nothing; one that tried and failed says why.
      console.warn(`founding relay did not attest: ${founded.teeError}`);
    }

    // Set through the relay as the founder, who is the namespace's admin.
    expect(founded.defaultCapabilitiesError).toBeUndefined();
    expect(founded.defaultCapabilitiesSet).toBe(true);
    await expect(operator.admin.getGroupInfo(founded.namespaceId)).resolves.toMatchObject({
      groupId: founded.namespaceId,
      defaultCapabilities: MASK,
    });
    // The AUTHOR is the founder and admin. The relay is seated to serve it, as
    // a Member, or as the namespace's first TEE if it attested.
    const { members } = await operator.admin.listGroupMembers(founded.namespaceId);
    expect(members).toContainEqual(
      expect.objectContaining({ identity: device.account, role: 'Admin' }),
    );
    expect(members).toContainEqual(
      expect.objectContaining({
        identity: relayAccount,
        role: founded.teeEnabled ? 'RelayTee' : 'Member',
      }),
    );

    // Seated with standing to act for members, so the founder governs its new
    // namespace through the relay with no grant from anyone.
    await expect(relay.describeGovernance(founded.namespaceId)).resolves.toEqual({
      executorAccount: relayAccount,
      groupId: founded.namespaceId,
      canActOnBehalf: true,
    });
    const subgroupId = randomId();
    await expect(
      relay.govern({
        groupId: founded.namespaceId,
        op: groupCreatedOp({
          groupId: subgroupId,
          parentId: founded.namespaceId,
          restricted: true,
          admin: device.account,
        }),
      }),
    ).resolves.toEqual({ groupId: subgroupId });

    // The same salt names the same namespace, which is never founded twice.
    const again = await relay
      .foundNamespace({ salt: founded.salt, executorAccount: relayAccount })
      .catch((e: unknown) => e);
    expect(again).toBeInstanceOf(Error);
  }, 180_000);
});
