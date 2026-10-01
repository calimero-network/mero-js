/**
 * E2E for a nodeless account minting invitations: an account that was added to
 * a namespace **by account**, holds `CAN_INVITE_MEMBERS`, and has no node.
 *
 * Such an account has no device bound in the namespace, so every peer refuses
 * what its device signs as signed by a key "bound to no account". The fix is a
 * relay carrying the device's `AccountDeviceLinked` —
 * `POST /admin-api/namespaces/{namespace_id}/account/link-device` — endorsed
 * with the relay's own member key. After that the device signs the invitation
 * itself, in this process, and an admitter admits a joiner on it.
 *
 * Everything the account does happens here: mint a root, certify and scope a
 * device (`signDeviceCert`, `signDeviceScope`), sign the invitation
 * (`signGroupInvitation`). The relay only publishes the link it cannot author.
 * The assertion that matters is the joiner appearing in the member list: it
 * proves the scope encoding (the link bound), the invitation encoding (the
 * signature verified) and the grant (the inviter's authority was accepted).
 *
 * Same rig as `delegated-governance.test.ts`: setup goes to the relay's
 * unguarded admin API. Requires `NODE_TEE_RELAY_URL`; skipped without it.
 *
 *   NODE_TEE_RELAY_URL=http://localhost:2468 pnpm test:e2e -- nodeless-invite
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MeroJs } from '../../src/mero-js.js';
import { CAPABILITIES } from '../../src/capabilities.js';
import { generateAccountRoot } from '../../src/account/index.js';
import { signerFromSecret, type Signer } from '../../src/signer/index.js';
import {
  mintDeviceId,
  signDeviceCert,
  signDeviceScope,
} from '../../src/device-cert/index.js';
import { signGroupInvitation } from '../../src/invitation/index.js';
import { signMemberJoinOp } from '../../src/namespace-op/index.js';
import { hex } from '../../src/crypto/internal.js';
import { ensureApplication, runId } from './harness.js';

const RELAY_URL = process.env.NODE_TEE_RELAY_URL;
const RUN = runId();

const random = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)));

/** An account with no node: a root, one device, and the proofs a relay needs. */
interface Keyholder {
  account: string;
  deviceSecret: string;
  signer: Signer;
  credential: string;
  scope: string;
}

async function keyholder(): Promise<Keyholder> {
  const root = await generateAccountRoot();
  const deviceSecret = random(32);
  const signer = await signerFromSecret(deviceSecret, 'deviceSecret');
  const device = await mintDeviceId(root.accountId, crypto.getRandomValues(new Uint8Array(16)));
  const credential = await signDeviceCert({
    rootSecret: root.secret,
    device,
    signPublicKey: signer.publicKey,
    kemPublicKey: random(32),
    deviceEpoch: 0,
  });
  // No applications: the device may speak for every one, so the scope reaches
  // this namespace whatever it serves.
  const scope = await signDeviceScope({ rootSecret: root.secret, device });
  return { account: root.accountId, deviceSecret, signer, credential, scope };
}

describe.skipIf(!RELAY_URL)('nodeless invite E2E: a relay carries the device link', () => {
  const relayUrl = RELAY_URL as string;
  let operator: MeroJs;
  let namespaceId: string;
  let relayAccount: string;
  let inviter: Keyholder;

  beforeAll(async () => {
    operator = new MeroJs({ baseUrl: relayUrl, timeoutMs: 60_000 });
    const applicationId = await ensureApplication(operator);
    namespaceId = (
      await operator.admin.createNamespace({ applicationId, name: `nodeless-invite-${RUN}` })
    ).namespaceId;
    relayAccount = (await operator.admin.getNodeIdentity()).accountId;

    // Added by account: a membership row and a grant, and no device binding.
    inviter = await keyholder();
    await operator.admin.addGroupMembers(namespaceId, {
      members: [{ identity: inviter.account, role: 'Member' }],
    });
    await operator.admin.setMemberCapabilities(namespaceId, inviter.account, {
      capabilities: CAPABILITIES.CAN_INVITE_MEMBERS,
    });
  }, 180_000);

  afterAll(() => operator?.close());

  it('refuses to vouch for an account the namespace does not know', async () => {
    const stranger = await keyholder();
    // The status, not merely a throw: a 404 from a node without the route would
    // satisfy `rejects` and prove nothing.
    await expect(
      operator.admin.linkAccountDevice(namespaceId, {
        credential: stranger.credential,
        scope: stranger.scope,
      }),
    ).rejects.toMatchObject({ status: 403 });
  }, 60_000);

  it('binds the device of a member account, once', async () => {
    const linked = await operator.admin.linkAccountDevice(namespaceId, {
      credential: inviter.credential,
      scope: inviter.scope,
    });
    expect(linked.accountId).toBe(inviter.account);
    expect(linked.deviceId).toMatch(/^[0-9a-f]{64}$/);
    expect(linked.alreadyBound).toBe(false);

    // Carrying it again publishes nothing and says so.
    await expect(
      operator.admin.linkAccountDevice(namespaceId, {
        credential: inviter.credential,
        scope: inviter.scope,
      }),
    ).resolves.toEqual({ ...linked, alreadyBound: true });
  }, 60_000);

  it('admits a joiner on an invitation the nodeless account signed', async () => {
    const { members } = await operator.admin.listGroupMembers(namespaceId);
    const invitation = await signGroupInvitation({
      groupId: namespaceId,
      inviterAccount: inviter.account,
      signer: inviter.signer,
      // Defaulted to the admins, as a node would: the relay, here. The inviter
      // holds CAN_INVITE_MEMBERS, which mints but does not admit.
      members,
    });
    expect(invitation.invitation.admitters).toContain(relayAccount);
    expect(invitation.invitation.admitters).not.toContain(inviter.account);

    const joiner = await keyholder();
    const signedOp = await signMemberJoinOp({
      namespaceId,
      member: joiner.account,
      invitation,
      credential: joiner.credential,
      deviceSecret: joiner.deviceSecret,
      nonce: 1,
    });
    const result = await operator.admin.admitJoin(namespaceId, { invitation, signedOp });
    expect(result.published).toBe(true);

    let joined = false;
    for (let attempt = 0; attempt < 20 && !joined; attempt += 1) {
      const now = await operator.admin.listGroupMembers(namespaceId);
      joined = now.members.some((m) => m.identity === joiner.account);
      if (!joined) await new Promise((r) => setTimeout(r, 500));
    }
    expect(joined, `${joiner.account} never appeared in the member list`).toBe(true);
  }, 120_000);
});
