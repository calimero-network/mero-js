/**
 * E2E for the case direct admission exists for: an account with a key, a device
 * certificate signed offline, and no node of its own.
 *
 * Everything the joiner does here happens in this process — mint a root, derive
 * an account, sign its own device certificate, sign its own membership op. The
 * node's only role is to publish an op it cannot author, because the op is signed
 * by the device key inside the credential it carries and every peer checks that
 * when applying a join.
 *
 * This is the test that makes the borsh encoding in `signMemberJoinOp` honest.
 * The layout is transcribed from core's structs by hand, and a single wrong
 * offset produces an op whose signature does not verify — so the assertion that
 * matters is not `published`, it is the joiner appearing in the member list.
 *
 * Run manually:
 *   NODE_URL=http://localhost:4001 pnpm test:e2e
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MeroJs } from '../../src/mero-js.js';
import { signDeviceCert, accountForRoot, mintDeviceId } from '../../src/device-cert/index.js';
import { signMemberJoinOp } from '../../src/namespace-op/index.js';
import { derivePublicKey, hex } from '../../src/crypto/internal.js';
import { resolveBaseUrl, resolveCreds, ensureApplication, runId } from './harness.js';

const NODE_URL = resolveBaseUrl();
const { username: USERNAME, password: PASSWORD } = resolveCreds();
const RUN = runId();

let mero: MeroJs;
let namespaceId: string;
let selfAccount: string;
let supported = false;

describe('Keyholder join via a designated admitter', () => {
  beforeAll(async () => {
    mero = new MeroJs({ baseUrl: NODE_URL });
    await mero.authenticate({ username: USERNAME, password: PASSWORD });
    const applicationId = await ensureApplication(mero);

    const ns = await mero.admin.createNamespace({
      applicationId,
      name: `keyholder-${RUN}`,
    });
    namespaceId = ns.namespaceId;
    selfAccount = (await mero.admin.getNodeIdentity()).accountId;

    const probe = await mero.admin.createGroupInvitation(namespaceId, {
      admitters: [selfAccount],
    });
    supported =
      'invitation' in probe && (probe.invitation.invitation.admitters?.length ?? 0) > 0;
  }, 60000);

  afterAll(() => {
    mero?.close();
  });

  it('admits an account that signed its own certificate and its own join', async (ctx) => {
    if (!supported) ctx.skip();

    // ---- everything below is the keyholder, with no node ----

    const rootSecret = '5c'.repeat(32);
    const deviceSecret = '6d'.repeat(32);
    // The credential's `sign_pk` must be the real public key of the key that
    // signs the op. A placeholder here still encodes 32 bytes and still fails
    // at the peer, as `signer != credential.statement.sign_pk`.
    const signPublicKey = hex(await derivePublicKey(deviceSecret));
    const kemPublicKey = '3a'.repeat(32);

    const account = await accountForRoot(rootSecret);
    // mintDeviceId(account, nonce) — the nonce is 16 bytes, not a struct.
    const device = await mintDeviceId(account, new Uint8Array(16).fill(0xa1));
    const credential = await signDeviceCert({
      rootSecret,
      device,
      signPublicKey,
      kemPublicKey,
      deviceEpoch: 0,
    });

    // ---- the inviter names this node as the only admitter ----

    const created = await mero.admin.createGroupInvitation(namespaceId, {
      admitters: [selfAccount],
    });
    if (!('invitation' in created)) throw new Error('expected a single invitation');

    const signedOp = await signMemberJoinOp({
      namespaceId,
      member: account,
      invitation: created.invitation,
      credential,
      deviceSecret,
      nonce: 1,
    });

    // ---- the admitter publishes what it cannot author ----

    const result = await mero.admin.admitJoin(namespaceId, {
      invitation: created.invitation,
      signedOp,
    });
    expect(result.published).toBe(true);

    // `published` only says it reached the topic. Membership landing is what
    // proves the op verified, which is what proves the encoding.
    let joined = false;
    for (let attempt = 0; attempt < 20 && !joined; attempt += 1) {
      const members = await mero.admin.listGroupMembers(namespaceId);
      joined = members.members.some((m) => m.identity === account);
      if (!joined) await new Promise((r) => setTimeout(r, 500));
    }
    expect(joined, `${account} never appeared in the member list`).toBe(true);
  }, 60000);

  it('never admits an op signed by a key the credential does not name', async (ctx) => {
    if (!supported) ctx.skip();

    const rootSecret = '7e'.repeat(32);
    const credentialSignPk = hex(await derivePublicKey('8f'.repeat(32)));
    const kemPublicKey = '3a'.repeat(32);

    const account = await accountForRoot(rootSecret);
    const device = await mintDeviceId(account, new Uint8Array(16).fill(0xb2));
    const credential = await signDeviceCert({
      rootSecret,
      device,
      signPublicKey: credentialSignPk,
      kemPublicKey,
      deviceEpoch: 0,
    });

    const created = await mero.admin.createGroupInvitation(namespaceId, {
      admitters: [selfAccount],
    });
    if (!('invitation' in created)) throw new Error('expected a single invitation');

    // Signed with a DIFFERENT key than the credential names — the substitution
    // an admitter would attempt to admit somebody of its own choosing.
    const signedOp = await signMemberJoinOp({
      namespaceId,
      member: account,
      invitation: created.invitation,
      credential,
      deviceSecret: '90'.repeat(32),
      nonce: 2,
    });

    // The endpoint accepts it, and that is not the bug it looks like. The op is
    // internally consistent: it is signed by the key it names as `signer`, so its
    // signature verifies. What makes it inadmissible is `signer` not matching the
    // credential's `sign_pk`, and that is checked at apply by every peer —
    // deliberately there rather than here, because it has to hold for ops this
    // endpoint never sees.
    const result = await mero.admin.admitJoin(namespaceId, {
      invitation: created.invitation,
      signedOp,
    });
    expect(result.published).toBe(true);

    // So the property to assert is not a rejection, it is that membership never
    // lands. Waited out rather than checked once: a pass here has to mean "did
    // not appear", not "had not appeared yet".
    await new Promise((r) => setTimeout(r, 5000));
    const members = await mero.admin.listGroupMembers(namespaceId);
    expect(members.members.some((m) => m.identity === account)).toBe(false);
  }, 60000);
});
