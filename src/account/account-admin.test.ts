import { describe, expect, it, vi } from 'vitest';
import {
  contextDetachedOp,
  memberJoinedOpenOp,
  memberRoleSetOp,
} from '../warrant/index.js';
import { createAccountAdmin, InvitationNotClaimableError, NoRelayError, NotForAccountError } from './account-admin.js';
import { namespaceOfGroup } from './govern.js';

const S = { account: 'aa'.repeat(32), credential: 'cc', deviceSecret: '11'.repeat(32), relayUrl: 'http://relay' };
/** What the relay answers a direct member's MemberJoinedOpen with (core's `AlreadyDirectMember`). */
const DIRECT_MEMBER_REFUSAL = Object.assign(
  new Error(`HTTP 409 Conflict: signer ${'aa'.repeat(32)} is a direct member; use MemberJoined or add_group_members instead`),
  { status: 409 },
);
const NS = '01'.repeat(32), SUB = '02'.repeat(32), CTX = '03'.repeat(32), ME = S.account, BOB = 'bb'.repeat(32);

function rig(extra: Record<string, unknown> = {}) {
  const govern = {
    group: vi.fn(async (_s, groupId: string) => ({ groupId })),
    root: vi.fn(async (_s, _groupId: string) => ({ groupId: SUB })),
  };
  const read = {
    getContextGroup: vi.fn(async () => SUB),
    listGroupMembers: vi.fn(async () => ({ members: [{ identity: ME, role: 'Admin' }] })),
    getGroupInfo: vi.fn(async () => ({ groupId: NS, targetApplicationId: 'ap'.repeat(32), appKey: 'ak'.repeat(32), namespaceId: NS })),
    listNamespaces: vi.fn(async () => [{ namespaceId: NS }]),
  };
  read.listNamespaces.mockResolvedValue([
    { namespaceId: NS, targetApplicationId: 'ap'.repeat(32) },
    { namespaceId: SUB, targetApplicationId: 'zz'.repeat(32) },
  ] as never);
  const join = vi.fn(async (namespaceId: string) => ({ namespaceId }));
  const deps = {
    join,
    govern,
    createContext: vi.fn(async () => ({ contextId: CTX })),
    found: vi.fn(async (): Promise<{ namespaceId: string; teeEnabled: boolean; haEnabled: boolean; haError?: string }> => ({
      namespaceId: NS,
      teeEnabled: true,
      haEnabled: true,
    })),
    latestVersion: vi.fn(async () => '1.2.3'),
    signInvitation: vi.fn(async () => ({ invitation: { group_id: NS }, inviter_signature: 'sig' })),
    ...extra,
  };
  const admin = createAccountAdmin(
    { session: S, read: read as never, app: { packageName: 'com.calimero.chat', registryUrl: 'https://reg' } },
    deps as never,
  );
  return { admin, govern, read, deps, join };
}

describe('createAccountAdmin', () => {
  it('reads go to the relay read client unchanged', async () => {
    const { admin, read } = rig();
    await expect(admin.listNamespaces()).resolves.toHaveLength(2);
    expect(read.listNamespaces).toHaveBeenCalledOnce();
  });

  it('lists its namespaces for an application from its own scoped list', async () => {
    // The node-wide `for-application` route is not caller-scoped, so the relay
    // refuses it to an account; its own list, filtered, is the same answer.
    const { admin } = rig();
    await expect(admin.listNamespacesForApplication('ap'.repeat(32))).resolves.toEqual([
      { namespaceId: NS, targetApplicationId: 'ap'.repeat(32) },
    ]);
  });

  it('is the account itself when asked who it is', async () => {
    const { admin } = rig();
    await expect(admin.getNodeIdentity()).resolves.toMatchObject({ accountId: ME });
  });

  it('creates a subgroup through the namespace and remembers which namespace it is in', async () => {
    const { admin, govern } = rig();
    await expect(admin.createGroupInNamespace(NS, { groupName: 'general', visibility: 'open' })).resolves.toEqual({ groupId: SUB });
    expect(govern.root).toHaveBeenCalledWith(S, NS, expect.objectContaining({ kind: 'root' }));
    // the name is set on the subgroup itself, as a group op
    expect(govern.group).toHaveBeenCalledWith(S, SUB, expect.objectContaining({ kind: 'group' }));
  });

  it('member, metadata, visibility and capability writes are group ops on the named group', async () => {
    const { admin, govern } = rig();
    await admin.addGroupMembers(SUB, { members: [{ identity: BOB, role: 'Member' }] });
    await admin.removeGroupMembers(SUB, { members: [BOB] });
    await admin.setGroupMetadata(SUB, { name: 'general' });
    await admin.setMemberMetadata(SUB, BOB, { name: 'Bob' });
    await admin.setContextMetadata(SUB, CTX, { name: 'room' });
    await admin.setDefaultCapabilities(SUB, { defaultCapabilities: 231 });
    await admin.setSubgroupVisibility(SUB, { subgroupVisibility: 'restricted' });
    await admin.setMemberCapabilities(SUB, BOB, { capabilities: 1 });
    expect(govern.group).toHaveBeenCalledTimes(8);
    for (const call of govern.group.mock.calls) expect(call[1]).toBe(SUB);
  });

  it('delete and reparent are root ops; leaving is my own MemberLeft', async () => {
    const { admin, govern } = rig();
    await expect(admin.deleteGroup(SUB)).resolves.toEqual({ isDeleted: true });
    await expect(admin.reparentGroup(SUB, { newParentId: NS })).resolves.toEqual({ reparented: true });
    expect(govern.root).toHaveBeenCalledTimes(2);
    await admin.leaveGroup(SUB);
    expect(govern.group).toHaveBeenLastCalledWith(S, SUB, expect.objectContaining({ kind: 'group' }));
  });

  it('governs a subgroup it neither created nor was told about, learning its namespace from the relay', async () => {
    // A member leaving an open channel someone else made: the account never
    // recorded that subgroup's namespace, and the relay answers it.
    const { admin, govern, read } = rig();
    const OTHER = '04'.repeat(32);
    expect(namespaceOfGroup(S as never, OTHER)).toBeUndefined();
    await admin.leaveGroup(OTHER);
    expect(read.getGroupInfo).toHaveBeenCalledWith(OTHER);
    expect(namespaceOfGroup(S as never, OTHER)).toBe(NS);
    expect(govern.group).toHaveBeenLastCalledWith(S, OTHER, expect.objectContaining({ kind: 'group' }));
  });

  it('asks the relay for a namespace only once per subgroup', async () => {
    const { admin, read } = rig();
    const OTHER = '05'.repeat(32);
    await admin.setGroupMetadata(OTHER, { name: 'a' });
    await admin.setGroupMetadata(OTHER, { name: 'b' });
    expect(read.getGroupInfo.mock.calls.filter((c) => (c as unknown[])[0] === OTHER)).toHaveLength(1);
  });

  it('joins an open channel by its context: MemberJoinedOpen on the context group', async () => {
    const { admin, govern, read } = rig();
    read.listGroupMembers.mockResolvedValueOnce({ members: [{ identity: BOB, role: 'Admin' }] });
    await expect(admin.joinContext(CTX)).resolves.toEqual({ contextId: CTX, memberPublicKey: ME });
    expect(read.getContextGroup).toHaveBeenCalledWith(CTX);
    expect(govern.root).toHaveBeenCalledWith(S, SUB, expect.objectContaining({ kind: 'root' }));
  });

  // Core's member list includes members who only INHERIT through Open subgroups,
  // and a node's join turns such a member into a direct one (MemberJoinedOpen);
  // only a DIRECT member's join is a no-op. Listing cannot tell the two apart,
  // so the account sends the join, as the node does, and core says which.
  it('an inherited member joining a context still joins: MemberJoinedOpen, as on a node', async () => {
    const { admin, govern } = rig();
    await expect(admin.joinContext(CTX)).resolves.toEqual({ contextId: CTX, memberPublicKey: ME });
    expect(govern.root).toHaveBeenCalledWith(S, SUB, memberJoinedOpenOp({ member: ME, groupId: SUB, credential: S.credential }));
  });

  it('a direct member joining a context is a no-op: core refuses its MemberJoinedOpen, as a node skips it', async () => {
    const { admin, govern } = rig();
    govern.root.mockRejectedValueOnce(DIRECT_MEMBER_REFUSAL);
    await expect(admin.joinContext(CTX)).resolves.toEqual({ contextId: CTX, memberPublicKey: ME });
  });

  it('any other refusal of the join is still an error', async () => {
    const { admin, govern } = rig();
    govern.root.mockRejectedValueOnce(Object.assign(new Error('HTTP 403 Forbidden: signer has no membership path'), { status: 403 }));
    await expect(admin.joinContext(CTX)).rejects.toThrow(/no membership path/);
  });

  // An account runs as itself in every context it can reach: the relay executes
  // as the account, so the account IS its identity there. Answering with it is
  // what lets an app tell "joined" from "not joined" the way it does on a node.
  it('owns its account as the identity of a context whose group it belongs to', async () => {
    const { admin } = rig();
    await expect(admin.getContextIdentitiesOwned(CTX)).resolves.toEqual({ identities: [ME] });
  });

  it('owns no identity in a context whose group it has not joined', async () => {
    const { admin, read } = rig();
    read.listGroupMembers.mockResolvedValueOnce({ members: [{ identity: BOB, role: 'Admin' }] });
    await expect(admin.getContextIdentitiesOwned(CTX)).resolves.toEqual({ identities: [] });
  });

  it('creates a context through the relay, in the group it names', async () => {
    const { admin, deps } = rig();
    await expect(admin.createContext({ applicationId: 'ap'.repeat(32), groupId: SUB, name: 'room' })).resolves.toMatchObject({ contextId: CTX });
    expect(deps.createContext).toHaveBeenCalledWith(S, expect.objectContaining({ groupId: SUB, name: 'room' }));
  });

  // The relay executes as the account, so the account IS its identity in the
  // context it just created, as `joinContext` and `getContextIdentitiesOwned`
  // already say. An empty key here was written into app state as the owner.
  it('names the account as the member key of the context it creates', async () => {
    const { admin } = rig();
    await expect(admin.createContext({ applicationId: 'ap'.repeat(32), groupId: SUB })).resolves.toEqual({
      contextId: CTX,
      memberPublicKey: ME,
      groupId: SUB,
    });
  });

  it('names the bundle service and the seed in the context it creates', async () => {
    // mero-docs creates its `registry` context as an account: the warrant must
    // say which service of the bundle, or the relay runs the default one's init.
    const { admin, deps } = rig();
    const contextSeed = 'ff'.repeat(32);
    await admin.createContext({ applicationId: 'ap'.repeat(32), groupId: NS, serviceName: 'registry', name: 'Registry', contextSeed, initializationParams: [] });
    expect(deps.createContext).toHaveBeenCalledWith(
      S,
      expect.objectContaining({ namespaceId: NS, groupId: NS, serviceName: 'registry', name: 'Registry', contextSeed, initializationParams: [] }),
    );
  });

  it("founds a namespace with this app's package at the registry's latest version", async () => {
    const { admin, deps } = rig();
    await expect(admin.createNamespace({ applicationId: 'ap'.repeat(32), name: 'Team' })).resolves.toMatchObject({ namespaceId: NS });
    expect(deps.found).toHaveBeenCalledWith(S, expect.objectContaining({ application: { applicationId: 'ap'.repeat(32), package: 'com.calimero.chat', version: '1.2.3' } }));
  });

  it("carries founding's HA outcome as extra fields on createNamespace's result", async () => {
    const { admin, deps } = rig();
    await expect(admin.createNamespace({ applicationId: 'ap'.repeat(32) })).resolves.toEqual({ namespaceId: NS, haEnabled: true });
    deps.found.mockResolvedValueOnce({ namespaceId: NS, teeEnabled: true, haEnabled: false, haError: 'link it' });
    await expect(admin.createNamespace({ applicationId: 'ap'.repeat(32), name: 'Team' })).resolves.toEqual({
      namespaceId: NS,
      haEnabled: false,
      haError: 'link it',
    });
  });

  it("signs an invitation itself, defaulting the admitters to the group's members", async () => {
    const { admin, deps, read } = rig();
    const out = await admin.createNamespaceInvitation(NS);
    expect(read.listGroupMembers).toHaveBeenCalledWith(NS);
    expect(deps.signInvitation).toHaveBeenCalledWith(expect.objectContaining({ groupId: NS, inviterAccount: ME, deviceSecret: S.deviceSecret }));
    expect(out).toMatchObject({ invitation: { inviter_signature: 'sig' } });
  });

  // Whoever claims an account's invitation may have no node, and only a relay
  // can admit a joiner with none. An admin's own node is not reachable by one.
  it("names the namespace's relays as the admitters of an account's invitation", async () => {
    const { admin, deps, read } = rig();
    read.listGroupMembers.mockResolvedValueOnce({
      members: [
        { identity: ME, role: 'Admin' },
        { identity: 'ee'.repeat(32), role: 'RelayTee' },
        { identity: BOB, role: 'Member' },
      ],
    });
    await admin.createNamespaceInvitation(NS);
    expect(deps.signInvitation).toHaveBeenCalledWith(expect.objectContaining({ admitters: ['ee'.repeat(32)] }));
  });

  it("falls back to the admins when the namespace has no relay", async () => {
    const { admin, deps } = rig();
    await admin.createNamespaceInvitation(NS);
    const call = (deps.signInvitation.mock.calls[0] as unknown as [{ admitters?: string[] }])[0];
    expect(call.admitters ?? []).toEqual([]);
  });

  // An invitation is only worth handing out if its claimant can reach a node
  // it names. A node-less joiner reaches nodes through the cloud's routing, so
  // the account checks that routing BEFORE minting, with the same intersection
  // the claimant's client will make.
  describe('refusing an invitation nobody could claim', () => {
    const RELAY = 'ee'.repeat(32);
    const withRelay = (read: { listGroupMembers: { mockResolvedValueOnce: (v: never) => unknown } }) =>
      read.listGroupMembers.mockResolvedValueOnce({
        members: [
          { identity: ME, role: 'Admin' },
          { identity: RELAY, role: 'RelayTee' },
        ],
      } as never);

    it('mints when the cloud routes to a node the invitation names', async () => {
      const routing = vi.fn(async () => ({ nodes: [{ account: RELAY.toUpperCase() }] }));
      const { admin, deps, read } = rig({ routing });
      withRelay(read);
      await expect(admin.createNamespaceInvitation(NS)).resolves.toMatchObject({ invitation: { inviter_signature: 'sig' } });
      expect(routing).toHaveBeenCalledWith(NS);
      expect(deps.signInvitation).toHaveBeenCalled();
    });

    // The cloud routes only namespaces whose founder linked the account (HA).
    // An unlinked founder's namespace still has a relay in it: the one that
    // founded it and serves this very session, which admits through its own
    // `/admit`. The invitation names it, and carries where it is reached, so a
    // claimant the cloud cannot route still has a door to knock on.
    it("mints through the namespace's relay when the cloud hosts it nowhere: the relay admits, its address rides along", async () => {
      const routing = vi.fn(async () => ({ nodes: [] }));
      const { admin, deps, read } = rig({ routing });
      withRelay(read);
      await expect(admin.createNamespaceInvitation(NS)).resolves.toMatchObject({ invitation: { inviter_signature: 'sig' } });
      expect(deps.signInvitation).toHaveBeenCalledWith(
        expect.objectContaining({ admitters: [RELAY], admitterAddrs: [S.relayUrl] }),
      );
    });

    it('carries no address when the cloud does route the namespace: the claimant finds the relay there', async () => {
      const routing = vi.fn(async () => ({ nodes: [{ account: RELAY }] }));
      const { admin, deps, read } = rig({ routing });
      withRelay(read);
      await admin.createNamespaceInvitation(NS);
      const call = (deps.signInvitation.mock.calls[0] as unknown as [{ admitterAddrs?: string[] }])[0];
      expect(call.admitterAddrs).toBeUndefined();
    });

    it('refuses, without signing, when the cloud hosts the namespace on no node and no relay is in it', async () => {
      const routing = vi.fn(async () => ({ nodes: [] }));
      const { admin, deps } = rig({ routing });
      const err = await admin.createNamespaceInvitation(NS).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InvitationNotClaimableError);
      expect((err as InvitationNotClaimableError).reason).toBe('not-hosted');
      expect((err as Error).message).toMatch(/not hosted/);
      expect(deps.signInvitation).not.toHaveBeenCalled();
    });

    it('refuses when the cloud routes only to nodes the invitation would not name', async () => {
      const routing = vi.fn(async () => ({ nodes: [{ account: BOB }, { account: null }] }));
      const { admin, deps, read } = rig({ routing });
      withRelay(read);
      const err = await admin.createNamespaceInvitation(NS).catch((e: unknown) => e);
      expect((err as InvitationNotClaimableError).reason).toBe('no-named-node');
      expect(deps.signInvitation).not.toHaveBeenCalled();
    });

    it("checks the admins when the namespace has no relay (signGroupInvitation's default)", async () => {
      const routing = vi.fn(async () => ({ nodes: [{ account: ME }] }));
      const { admin, deps } = rig({ routing });
      await admin.createNamespaceInvitation(NS);
      expect(deps.signInvitation).toHaveBeenCalled();
    });

    // A failed lookup says nothing about the namespace: minting is not refused
    // over a network blip, the claimant's own lookup will report it.
    it('still mints when the routing lookup itself fails', async () => {
      const routing = vi.fn(async () => {
        throw new Error('offline');
      });
      const { admin, deps, read } = rig({ routing });
      withRelay(read);
      await admin.createNamespaceInvitation(NS);
      expect(deps.signInvitation).toHaveBeenCalled();
    });
  });

  it('a node-only write is refused by name, never sent to a node route', async () => {
    const { admin } = rig();
    await expect(admin.upgradeGroup(NS, {} as never)).rejects.toBeInstanceOf(NotForAccountError);
    await expect(admin.installApplication({} as never)).rejects.toBeInstanceOf(NotForAccountError);
  });

  it('syncGroup is a no-op for an account: the relay syncs', async () => {
    const { admin } = rig();
    await expect(admin.syncGroup(NS)).resolves.toBeDefined();
  });

  // GroupCreated: tag, groupId (32), parentId (32), then the restricted flag.
  const restrictedFlag = (call: unknown[] | undefined) =>
    (call?.[2] as { bytes: Uint8Array }).bytes[1 + 32 + 32];

  it('creates a subgroup Open when no visibility is named', async () => {
    const { admin, govern } = rig();
    await admin.createGroupInNamespace(NS, { groupName: 'general' });
    expect(restrictedFlag(govern.root.mock.calls.at(-1))).toBe(0);
  });

  it('creates a subgroup Restricted only when asked', async () => {
    const { admin, govern } = rig();
    await admin.createGroupInNamespace(NS, { visibility: 'restricted' });
    expect(restrictedFlag(govern.root.mock.calls.at(-1))).toBe(1);
  });

  it('a subgroup created in the second of two namespaces is written to that namespace', async () => {
    const { admin, govern } = rig();
    const NS2 = '09'.repeat(32);
    await admin.createGroupInNamespace(NS2, { groupName: 'general' });
    expect(govern.root).toHaveBeenLastCalledWith(S, NS2, expect.anything());
  });
});

describe('createAccountAdmin: the rest of the admin surface', () => {
  const INVITATION = { invitation: { group_id: NS }, inviter_signature: 'sig' } as never;

  it('joins a namespace from an invitation through the relay it names', async () => {
    const { admin, join } = rig();
    await expect(admin.joinNamespace(NS, { invitation: INVITATION })).resolves.toMatchObject({ namespaceId: NS });
    expect(join).toHaveBeenCalledWith(NS, INVITATION);
  });

  it('a join refused by the admitter rejects with its reason and status', async () => {
    const { admin, join } = rig();
    join.mockRejectedValueOnce(Object.assign(new Error('The admitter refused the join'), { status: 403 }));
    await expect(admin.joinNamespace(NS, { invitation: INVITATION })).rejects.toMatchObject({ status: 403 });
  });

  it("sets a member's role as MemberRoleSet on the group", async () => {
    const { admin, govern } = rig();
    await admin.updateMemberRole(SUB, BOB, { role: 'Admin' });
    expect(govern.group).toHaveBeenCalledWith(S, SUB, memberRoleSetOp(BOB, 'Admin'));
  });

  it('inherits into an open subgroup with MemberJoinedOpen, as joining its context does', async () => {
    const { admin, govern, read } = rig();
    read.listGroupMembers.mockResolvedValueOnce({ members: [{ identity: BOB, role: 'Admin' }] });
    await expect(admin.joinSubgroupInheritance(SUB)).resolves.toMatchObject({ groupId: SUB, memberPublicKey: ME });
    expect(govern.root).toHaveBeenCalledWith(S, SUB, memberJoinedOpenOp({ member: ME, groupId: SUB, credential: S.credential }));
  });

  it('an inherited member inheriting into a subgroup becomes direct, as on a node', async () => {
    const { admin, govern } = rig();
    await expect(admin.joinSubgroupInheritance(SUB)).resolves.toMatchObject({ groupId: SUB, wasInherited: true });
    expect(govern.root).toHaveBeenCalledWith(S, SUB, memberJoinedOpenOp({ member: ME, groupId: SUB, credential: S.credential }));
  });

  it('a direct member inheriting into its own subgroup is a no-op, as on a node', async () => {
    const { admin, govern } = rig();
    govern.root.mockRejectedValueOnce(DIRECT_MEMBER_REFUSAL);
    await expect(admin.joinSubgroupInheritance(SUB)).resolves.toMatchObject({ groupId: SUB, wasInherited: false });
  });

  it('detaches a context from its group as ContextDetached', async () => {
    const { admin, govern } = rig();
    await admin.detachContextFromGroup(SUB, CTX);
    expect(govern.group).toHaveBeenCalledWith(S, SUB, contextDetachedOp(CTX));
  });

  it('syncing a context is a no-op: an account holds no local copy, the relay syncs it', async () => {
    const { admin, govern } = rig();
    await expect(admin.syncContext(CTX)).resolves.toBeUndefined();
    expect(govern.group).not.toHaveBeenCalled();
  });

  it('deleting a context is refused by name: an account has no copy of its own to delete', async () => {
    // A node's deleteContext drops that node's copy; the group keeps the context.
    // An account's copy is the relay's, shared with every account it serves, and
    // detaching it from the group is a different, group-wide act.
    const { admin, govern } = rig();
    await expect(admin.deleteContext(CTX)).rejects.toBeInstanceOf(NotForAccountError);
    expect(govern.group).not.toHaveBeenCalled();
    expect(govern.root).not.toHaveBeenCalled();
  });

  it("leaving a context is refused by name: a node's leave is local, and an account has nothing local", async () => {
    // A node's leaveContext is a local-only opt-out (a tombstone and its own
    // identity rows); it publishes nothing and the node stays in the group.
    // Leaving the group instead would take the account out of every context
    // there: that is leaveGroup, and it must be asked for as such.
    const { admin, govern } = rig();
    await expect(admin.leaveContext(CTX)).rejects.toBeInstanceOf(NotForAccountError);
    expect(govern.group).not.toHaveBeenCalled();
    expect(govern.root).not.toHaveBeenCalled();
  });

  it('refuses by name what core has no account form for, rather than a bare 403 from the relay', async () => {
    const { admin } = rig();
    const refused = [
      () => admin.createContextAlias({} as never),
      () => admin.deleteContextAlias('a'),
      () => admin.createApplicationAlias({} as never),
      () => admin.deleteNamespace(NS),
      () => admin.createGroupInvitation(SUB),
      () => admin.joinGroup({} as never),
      () => admin.setTeeAdmissionPolicy(NS, {} as never),
      () => admin.getTeeAdmissionPolicy(NS),
      () => admin.deleteBlob('b'),
      () => admin.listAccountDevices(),
      () => admin.revokeAccountDevice(NS, {} as never),
      // Aliases are a node's own names for its contexts, applications and
      // devices; a relay's are the relay's, so reading them is no more an
      // account's than writing them. Core gives an account session no alias
      // permission, and the relay would answer a bare 403.
      () => admin.lookupContextAlias('a'),
      () => admin.listContextAliases(),
      () => admin.lookupApplicationAlias('a'),
      () => admin.listApplicationAliases(),
      () => admin.lookupDeviceAlias('a'),
      () => admin.listDeviceAliases(),
    ];
    for (const call of refused) await expect(call()).rejects.toBeInstanceOf(NotForAccountError);
  });

  // core serves an account its own groups' upgrade and cascade status (#4392,
  // rc.76), and migration status when it administers the namespace (#4400, rc.77).
  it('reads its groups\' upgrade, migration and cascade status from the relay', async () => {
    const { admin, read } = rig();
    const status = { upgrade: vi.fn(async () => ({ status: 'completed' })), migration: vi.fn(async () => ({ failed: 0 })), cascade: vi.fn(async () => ({ groups: [] })) };
    Object.assign(read, { getGroupUpgradeStatus: status.upgrade, getMigrationStatus: status.migration, getCascadeStatus: status.cascade });
    await expect(admin.getGroupUpgradeStatus(NS)).resolves.toEqual({ status: 'completed' });
    await expect(admin.getMigrationStatus(NS)).resolves.toEqual({ failed: 0 });
    await expect(admin.getCascadeStatus(NS)).resolves.toEqual({ groups: [] });
    expect(status.upgrade).toHaveBeenCalledWith(NS);
    expect(status.migration).toHaveBeenCalledWith(NS);
    expect(status.cascade).toHaveBeenCalledWith(NS);
  });
});

describe('createAccountAdmin with no relay yet', () => {
  const fresh = createAccountAdmin({ session: { ...S, relayUrl: null } as never, read: null, app: {} });

  it('is a member of nothing: the listings are empty', async () => {
    await expect(fresh.listNamespaces()).resolves.toEqual([]);
    await expect(fresh.getContexts()).resolves.toEqual({ contexts: [] });
    await expect(fresh.listNamespacesForApplication('ap'.repeat(32))).resolves.toEqual([]);
  });

  it('still knows who it is', async () => {
    await expect(fresh.getNodeIdentity()).resolves.toMatchObject({ accountId: ME });
  });

  it('joins from an invitation: the join is what gives it its first relay', async () => {
    const join = vi.fn(async (namespaceId: string) => ({ namespaceId }));
    const admin = createAccountAdmin({ session: { ...S, relayUrl: null } as never, read: null, app: {} }, { join } as never);
    await expect(admin.joinNamespace(NS, { invitation: {} as never })).resolves.toMatchObject({ namespaceId: NS });
    expect(join).toHaveBeenCalledOnce();
  });

  it('refuses anything else by name, as a missing relay', async () => {
    await expect(fresh.getGroupInfo(NS)).rejects.toBeInstanceOf(NoRelayError);
    await expect(fresh.setGroupMetadata(NS, { name: 'x' })).rejects.toBeInstanceOf(NoRelayError);
  });
});
