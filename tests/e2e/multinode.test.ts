/**
 * Multi-node E2E: drives the SDK across TWO live nodes to assert a real cross-node
 * flow (node-1 invites → node-2 joins). Needs a 2-node cluster, so it's gated
 * behind MERO_MULTINODE; the single-node CI skips it. The dedicated multi-node CI
 * job boots two embedded-auth merod nodes and sets MERO_NODE1_URL/MERO_NODE2_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MeroJs } from '../../src/mero-js.js';
import { resolveCreds, ensureApplication, runId } from './harness.js';

const N1 = process.env.MERO_NODE1_URL ?? 'http://localhost:4501';
const N2 = process.env.MERO_NODE2_URL ?? 'http://localhost:4502';
/**
 * A node that joins NOTHING, so it can be paired into node-1's account.
 * pair-init refuses a machine already holding a linked device of another
 * account, which is what node-2 becomes the moment it joins. Absent locally
 * unless a third node is running, so the pairing test skips rather than fails.
 */
const N3 = process.env.MERO_NODE3_URL;
const CREDS = resolveCreds();
const RUN = runId();

// Only run when a real 2-node cluster is provided.
const suite = process.env.MERO_MULTINODE ? describe : describe.skip;

let n1: MeroJs;
let n2: MeroJs;
let n3: MeroJs | undefined;
let applicationId: string;
let namespaceId: string;

suite('Multi-node E2E — cross-node flows', () => {
  beforeAll(async () => {
    n1 = new MeroJs({ baseUrl: N1 });
    await n1.authenticate(CREDS);
    n2 = new MeroJs({ baseUrl: N2 });
    await n2.authenticate(CREDS);
    if (N3) {
      n3 = new MeroJs({ baseUrl: N3 });
      await n3.authenticate(CREDS);
    }

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
    n3?.close();
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
  });

  /**
   * The pairing happy path, and the only place the SDK can drive it: pair-init
   * runs on the joining device and pair-complete on the account holder, so one
   * node cannot exercise both halves. Revoking needs a device that is safe to
   * withdraw, which is exactly what pairing here produces - the single-node
   * suite can only assert revoke's refusals, because its one device is the
   * node's own.
   */
  it('node-3 pairs a device into node-1 account, then node-1 revokes it', async (ctx) => {
    if (!n3) return ctx.skip();
    const id1 = await n1.admin.getNodeIdentity();
    // Absent below 0.11.0-rc.22, and pair-init has nothing to mint against it.
    if (!id1.accountRootPublicKey) return ctx.skip();

    let offer;
    try {
      // Deliberately node-3, not node-2: this half is built for a machine that
      // is a member of nothing, and node-2 stopped being one when it joined
      // above. It mints key material and publishes nothing, so the root key has
      // to be handed to it.
      offer = await n3.admin.initAccountPairing({
        accountRootPublicKey: id1.accountRootPublicKey,
        namespaces: [namespaceId],
      });
    } catch (e) {
      // 404 means this merod predates the account routes. Anything else is a
      // real failure and must not be swallowed.
      if ((e as { status?: number }).status !== 404) throw e;
      console.log('(skip) account routes absent - this merod predates them');
      return ctx.skip();
    }

    // Only node-1 holds the root that can sign the certificate. Empty
    // `applications` publishes the link into every namespace it takes part in.
    await n1.admin.completeAccountPairing({
      deviceId: offer.deviceId,
      kemPublicKey: offer.kemPublicKey,
      signPublicKey: offer.signPublicKey,
      statement: offer.statement,
      confirmationCode: offer.confirmationCode,
      applications: [],
    });

    const paired = (await n1.admin.listAccountDevices()).find(
      (d) => d.deviceId === offer.deviceId,
    );
    expect(paired, 'the paired device is absent from the holder listing').toBeTruthy();
    expect(paired!.revoked).toBe(false);
    // Load-bearing, not decorative: this test revokes a device, and the only
    // one it may ever revoke is the one it just paired. Were `isSelf` true the
    // revocation would withdraw the node running the rest of the suite.
    expect(paired!.isSelf, 'refusing to revoke the node own device').toBe(false);

    const res = await n1.admin.revokeAccountDevice(namespaceId, {
      deviceId: offer.deviceId,
    });
    expect(res.deviceId).toBe(offer.deviceId);
    expect(res.accountId).toBe(id1.accountId);
    // The answer that matters: a device belongs to the account, so publication
    // is per-namespace and the caller has to be able to see which ones took it.
    expect(res.revokedIn.map((r) => r.namespaceId)).toContain(namespaceId);

    const after = (await n1.admin.listAccountDevices()).find(
      (d) => d.deviceId === offer.deviceId,
    );
    expect(after?.revoked, 'the listing still reports the device as live').toBe(true);
  });
});
