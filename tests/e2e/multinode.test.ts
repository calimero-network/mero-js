/**
 * Multi-node E2E: drives the SDK across TWO live nodes to assert a real cross-node
 * flow (node-1 invites → node-2 joins). Needs a 2-node cluster, so it's gated
 * behind MERO_MULTINODE; the single-node CI skips it. The dedicated multi-node CI
 * job boots two embedded-auth merod nodes and sets MERO_NODE1_URL/MERO_NODE2_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MeroJs } from '../../src/mero-js';
import type { GroupMembershipEventData } from '../../src/events/group';
import { resolveCreds, ensureApplication, runId } from './harness';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

suite('Multi-node E2E — namespace invite/join', () => {
  beforeAll(async () => {
    n1 = new MeroJs({ baseUrl: N1 });
    await n1.authenticate(CREDS);
    n2 = new MeroJs({ baseUrl: N2 });
    await n2.authenticate(CREDS);

    // Both nodes need the application to run the shared context.
    applicationId = await ensureApplication(n1);
    await ensureApplication(n2);

    const ns = await n1.admin.createNamespace({
      applicationId,
      upgradePolicy: 'Automatic',
      alias: `mn-${RUN}`,
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
    expect(joined.groupId).toBeTruthy();
  });

  // The real "inviter sees the member appear live" UX: the join op propagates by
  // gossip and node-1 emits a GroupMembership event when it applies node-2's join,
  // so we subscribe on node-1 (the inviter) and prove the event is delivered live.
  it('node-1 receives a live GroupMembership event when node-2 joins', async () => {
    // Fresh namespace so the subscription is active BEFORE any join happens.
    const ns = await n1.admin.createNamespace({
      applicationId,
      upgradePolicy: 'Automatic',
      alias: `mn-evt-${RUN}`,
    });
    const evtNamespaceId = ns.namespaceId;

    const events: Array<GroupMembershipEventData> = [];
    const collect = (ev: unknown) => {
      if (ev && typeof ev === 'object' && 'groupId' in ev) {
        events.push(ev as GroupMembershipEventData);
      }
    };

    try {
      n1.events.on('event', collect);
      await n1.events.connect();
      await n1.events.subscribe({ groupIds: [evtNamespaceId] });
      // Let the SSE session + group subscription settle on the node before the join.
      await sleep(2000);

      const inv = (await n1.admin.createNamespaceInvitation(evtNamespaceId, {})) as {
        invitation?: unknown;
      };
      expect(inv.invitation).toBeTruthy();

      const joined = await n2.admin.joinNamespace(evtNamespaceId, {
        invitation: inv.invitation as never,
      });
      expect(joined.memberIdentity).toBeTruthy();

      // Poll for the delivered event; gossip propagation + apply is not instant.
      const deadline = Date.now() + 20000;
      let hit: GroupMembershipEventData | undefined;
      while (Date.now() < deadline) {
        hit = events.find((e) => e.type === 'MemberJoined');
        if (hit) break;
        await sleep(500);
      }

      expect(
        hit,
        `no MemberJoined GroupMembership event delivered on node-1; saw: ${JSON.stringify(events)}`,
      ).toBeTruthy();
      expect(hit!.groupId).toBeTruthy();
      // When the payload carries the member, it must be the identity node-2 joined as.
      if (hit!.data?.member) {
        expect(hit!.data.member).toBe(joined.memberIdentity);
      }
    } finally {
      n1.events.off('event', collect);
      await n1.admin.deleteNamespace(evtNamespaceId).catch(() => {});
    }
  }, 60000);
});
