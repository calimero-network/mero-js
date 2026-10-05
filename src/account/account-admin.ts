/**
 * An account's admin API: the same method names and types as mero-js's
 * `AdminApiClient`, so an app written against a node's admin needs no second
 * code path. Reads go to the relay's caller-scoped admin client; writes go
 * through the relay as governance ops, delegated context and namespace
 * creation, or an invitation the account signs itself. A write with no
 * account form (upgrades, installs) is refused by name.
 */
import {
  type AdminApiClient,
  type CreateContextRequest,
  type SignedGroupOpenInvitation,
} from '../admin-api/index.js';
import {
  groupDeletedOp,
  groupMetadataSetOp,
  groupReparentedOp,
  memberAddedOp,
  memberCapabilitySetOp,
  memberJoinedOpenOp,
  memberLeftOp,
  memberMetadataSetOp,
  memberRemovedOp,
  contextMetadataSetOp,
  defaultCapabilitiesSetOp,
  subgroupCreation,
  subgroupVisibilitySetOp,
  memberRoleSetOp,
  contextDetachedOp,
  type GovernanceMemberRole,
} from '../warrant/index.js';
import {
  signGroupInvitation,
} from '../invitation/index.js';
import type { DelegatedSession } from './session.js';
import { governGroup, governRoot, namespaceOfGroup, rememberGroupNamespace } from './govern.js';
import { createDelegatedContext, foundDelegatedNamespace, latestPublishedVersion } from './create-context.js';

export class NotForAccountError extends Error {
  constructor(readonly method: string) {
    super(`${method} is not available for an account: it needs a node`);
    this.name = 'NotForAccountError';
  }
}

/**
 * An account that has enrolled but joined nothing has no relay: nothing serves
 * it yet. Its listings are empty, which is true; anything else names this.
 */
export class NoRelayError extends Error {
  constructor(readonly method: string) {
    super(`${method} needs a relay, and this account has none yet: join from an invitation first`);
    this.name = 'NoRelayError';
  }
}

/**
 * Why an account's invitation was not minted: nobody its claimant could reach
 * would admit them. A claimant with no node finds its admitter through the
 * cloud's routing, intersected with the invitation's signed admitters, so an
 * invitation the cloud routes to none of them can only fail in their hands.
 *
 * - `not-hosted` — the cloud serves the namespace on no node AND no relay is a
 *   member of it, so nothing admits a node-less claimant. A namespace with a
 *   relay in it is minted for even when the cloud routes it nowhere: the relay
 *   admits through its own `/admit`, and the invitation carries its address.
 * - `no-named-node` — the cloud's nodes are not among the admitters this
 *   invitation would name.
 */
export class InvitationNotClaimableError extends Error {
  constructor(
    readonly namespaceId: string,
    readonly reason: 'not-hosted' | 'no-named-node',
  ) {
    super(
      reason === 'not-hosted'
        ? `nobody could claim an invitation to ${namespaceId} yet: the namespace is not hosted in the cloud and has no relay in it, so an invitee with no node has no relay to be admitted through. Link this account to your cloud user in the wallet and enable HA for the namespace, then invite.`
        : `nobody could claim an invitation to ${namespaceId}: the cloud routes to none of the relays or admins it would name as admitters`,
    );
    this.name = 'InvitationNotClaimableError';
  }
}

/** What an account with no relay answers: it is a member of nothing. */
const EMPTY_READS: Partial<Record<keyof AdminApiClient, () => Promise<unknown>>> = {
  listNamespaces: async () => [],
  listNamespacesForApplication: async () => [],
  getContexts: async () => ({ contexts: [] }),
};

export interface AccountAdminDeps {
  govern?: { group: typeof governGroup; root: typeof governRoot };
  createContext?: typeof createDelegatedContext;
  found?: typeof foundDelegatedNamespace;
  latestVersion?: (registryUrl: string, pkg: string) => Promise<string>;
  signInvitation?: typeof signGroupInvitation;
  /**
   * Redeem an invitation for this account: resolve the relay the invitation
   * names, have it admit the account, and switch the session onto that relay.
   * The provider supplies it (it owns the session); without it a join is
   * refused by name. Rejects with the refusal's reason and HTTP `status`.
   */
  join?: (namespaceId: string, invitation: SignedGroupOpenInvitation) => Promise<{ namespaceId: string }>;
  /**
   * The cloud's routing for a namespace (`CloudClient.getNamespaceRouting`):
   * the nodes a node-less invitee can be admitted through. Given, an
   * invitation is minted only if one of them is an admitter it names; a lookup
   * that fails does not block minting. The provider supplies it.
   */
  routing?: (namespaceId: string) => Promise<{ nodes: ReadonlyArray<{ account: string | null }> }>;
}

/**
 * Calls with no account form: refused by name, so an app sees why rather than
 * the bare 403 a relay gives a call its session may not make. Everything not
 * listed and not overridden below is a read, answered by the relay.
 *
 * - Upgrades, installs, a node's own context identity: a node's to do.
 * - `deleteContext`: a node drops its own copy and the group keeps the context.
 *   An account's copy is the relay's, shared with every account it serves;
 *   removing a context for the group is `detachContextFromGroup` or
 *   `deleteGroup`.
 * - Aliases, read or written: they are a node's own names, and a relay's are the
 *   relay's. Core gives an account session no alias permission.
 * - Deleting a namespace, legacy group invitations and joins, TEE policy, blob
 *   deletion: core has no delegated form for them.
 * - Account devices: the wallet manages them, not an app.
 *
 * Upgrade, cascade and migration status are NOT here: core serves an account
 * its own groups' status (#4392, rc.76), and migration status to the account
 * that administers the namespace (#4400, rc.77), so they go to the relay.
 */
const NODE_ONLY = new Set([
  'upgradeGroup', 'retryGroupUpgrade', 'abortMigration', 'installApplication', 'installDevApplication',
  'uninstallApplication', 'generateContextIdentity', 'deleteContext',
  // A node's leaveContext is a local opt-out (a tombstone, its own identity rows)
  // and publishes nothing; an account has nothing local to opt out of, and
  // leaving the context's group instead is leaveGroup.
  'leaveContext',
  'createContextAlias', 'createApplicationAlias', 'createDeviceAlias',
  'deleteContextAlias', 'deleteApplicationAlias', 'deleteDeviceAlias',
  'lookupContextAlias', 'lookupApplicationAlias', 'lookupDeviceAlias',
  'listContextAliases', 'listApplicationAliases', 'listDeviceAliases',
  'deleteNamespace', 'createGroupInvitation', 'joinGroup',
  'setTeeAdmissionPolicy', 'getTeeAdmissionPolicy', 'deleteBlob',
  'listAccountDevices', 'revokeAccountDevice',
]);

/**
 * Core's refusal of a MemberJoinedOpen from someone already a direct member
 * (`AlreadyDirectMember`, answered 409): "signer … is a direct member; use
 * MemberJoined or add_group_members instead". Not to be confused with "is not a
 * direct member", which a leave by an inherited member gets.
 */
function isAlreadyDirectMember(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const status = (e as { status?: number }).status;
  return (status === undefined || status === 409) && /signer [0-9a-f]+ is a direct member/i.test(e.message);
}

export function createAccountAdmin(
  input: { session: DelegatedSession; read: AdminApiClient | null; app: { packageName?: string; packageVersion?: string; registryUrl?: string } },
  deps: AccountAdminDeps = {},
): AdminApiClient {
  const { session: s, read, app } = input;
  const governGroupOp = deps.govern?.group ?? governGroup;
  const governRootOp = deps.govern?.root ?? governRoot;
  const createContext = deps.createContext ?? createDelegatedContext;
  const found = deps.found ?? foundDelegatedNamespace;
  const latestVersion = deps.latestVersion ?? latestPublishedVersion;
  const signInvitation = deps.signInvitation ?? signGroupInvitation;
  const join = deps.join;
  const routing = deps.routing;

  // Reachable with or without a relay: the join is how an account gets one.
  async function joinNamespace(namespaceId: string, req: { invitation: SignedGroupOpenInvitation }) {
    if (!join) throw new NotForAccountError('joinNamespace without a join handler');
    return join(namespaceId, req.invitation);
  }

  // Only reached through the relay proxy below, so a null here is unreachable;
  // the guard keeps the types honest rather than asserting it away.
  const relay = (): AdminApiClient => {
    if (read === null) throw new NoRelayError('this call');
    return read;
  };

  // A group or root op is posted to the group's namespace. A subgroup this
  // account neither created nor joined (an open channel someone else made) is
  // one the relay can name: ask it once, as `createContext` does, and remember.
  async function knowNamespaceOf(groupId: string): Promise<void> {
    if (namespaceOfGroup(s, groupId)) return;
    const info = await relay().getGroupInfo(groupId);
    rememberGroupNamespace(s.account, groupId, (info as { namespaceId?: string }).namespaceId ?? groupId);
  }
  const group: typeof governGroup = async (session, groupId, op) => {
    await knowNamespaceOf(groupId);
    return governGroupOp(session, groupId, op);
  };
  const root: typeof governRoot = async (session, groupId, op) => {
    await knowNamespaceOf(groupId);
    return governRootOp(session, groupId, op);
  };

  // MemberJoinedOpen on `groupId`, as a node's join sends it: a member who only
  // inherits becomes a direct one, and a direct member's join is a no-op. The
  // member list cannot tell those two apart (it lists inherited members too), so
  // the join is sent and core's refusal of a direct member is the no-op.
  // Returns whether this join made the account a member.
  async function joinOpen(groupId: string): Promise<boolean> {
    try {
      await root(s, groupId, memberJoinedOpenOp({ member: s.account, groupId, credential: s.credential }));
      return true;
    } catch (e) {
      if (isAlreadyDirectMember(e)) return false;
      throw e;
    }
  }

  async function isMemberOfContextGroup(contextId: string, knownGroupId?: string): Promise<boolean> {
    const groupId = knownGroupId ?? String(await relay().getContextGroup(contextId));
    const { members } = await relay().listGroupMembers(groupId);
    return members.some((m) => m.identity.toLowerCase() === s.account.toLowerCase());
  }

  const writes: Partial<Record<keyof AdminApiClient, unknown>> = {
    // The node-wide `for-application` listing is not caller-scoped, so a relay
    // refuses it to an account. Its own scoped list, filtered, is the answer.
    async listNamespacesForApplication(applicationId: string) {
      return (await relay().listNamespaces()).filter((ns) => ns.targetApplicationId === applicationId);
    },
    async getNodeIdentity() {
      return { accountId: s.account, deviceId: null, publicKey: '', deviceCertified: true };
    },
    async createNamespace(req: { applicationId: string; name?: string }) {
      if (!app.packageName) throw new NotForAccountError('createNamespace without a packageName');
      const version = app.packageVersion ?? (await latestVersion(app.registryUrl ?? 'https://apps.calimero.network', app.packageName));
      const { namespaceId, haEnabled, haError } = await found(s, {
        defaultCapabilities: 231,
        application: { applicationId: req.applicationId, package: app.packageName, version },
      });
      if (req.name) await group(s, namespaceId, groupMetadataSetOp({ name: req.name }));
      // A node's result is `{ namespaceId }`; HA's outcome rides along as extra
      // fields, so code typed against the node call is unaffected.
      return { namespaceId, haEnabled, ...(haError !== undefined ? { haError } : {}) };
    },
    async createGroupInNamespace(namespaceId: string, req: { groupName?: string; visibility?: 'open' | 'restricted' } = {}) {
      const { op } = await subgroupCreation({ parentId: namespaceId, restricted: req.visibility !== 'open', admin: s.account });
      const { groupId } = await root(s, namespaceId, op);
      rememberGroupNamespace(s.account, groupId, namespaceId);
      if (req.groupName) await group(s, groupId, groupMetadataSetOp({ name: req.groupName }));
      return { groupId };
    },
    async addGroupMembers(groupId: string, req: { members: { identity: string; role?: string }[] }) {
      for (const m of req.members) await group(s, groupId, memberAddedOp(m.identity, (m.role ?? 'Member') as never));
    },
    async removeGroupMembers(groupId: string, req: { members: string[] }) {
      for (const m of req.members) await group(s, groupId, memberRemovedOp(m));
    },
    async setGroupMetadata(groupId: string, req: { name?: string; data?: Record<string, string> }) {
      await group(s, groupId, groupMetadataSetOp(req));
    },
    async setMemberMetadata(groupId: string, identity: string, req: { name?: string; data?: Record<string, string> }) {
      await group(s, groupId, memberMetadataSetOp(identity, req));
    },
    async setContextMetadata(groupId: string, contextId: string, req: { name?: string; data?: Record<string, string> }) {
      await group(s, groupId, contextMetadataSetOp(contextId, req));
    },
    async setDefaultCapabilities(groupId: string, req: { defaultCapabilities: number }) {
      await group(s, groupId, defaultCapabilitiesSetOp(req.defaultCapabilities));
    },
    async setSubgroupVisibility(groupId: string, req: { subgroupVisibility: string }) {
      await group(s, groupId, subgroupVisibilitySetOp(req.subgroupVisibility === 'open' ? 'open' : 'restricted'));
    },
    async setMemberCapabilities(groupId: string, identity: string, req: { capabilities: number }) {
      await group(s, groupId, memberCapabilitySetOp(identity, req.capabilities));
    },
    async deleteGroup(groupId: string) {
      await root(s, groupId, groupDeletedOp(groupId));
      return { isDeleted: true };
    },
    async reparentGroup(childGroupId: string, req: { newParentId: string }) {
      await root(s, childGroupId, groupReparentedOp(childGroupId, req.newParentId));
      return { reparented: true };
    },
    async leaveGroup(groupId: string) {
      await group(s, groupId, memberLeftOp(s.account));
    },
    async leaveNamespace(namespaceId: string) {
      await group(s, namespaceId, memberLeftOp(s.account));
    },
    // An account runs as itself in every context it can reach (the relay
    // executes as the account), so its identity there is the account. Owned
    // when its account is a member of the context's group, as on a node a
    // context identity is owned once the node has joined.
    async getContextIdentitiesOwned(contextId: string) {
      return { identities: (await isMemberOfContextGroup(contextId)) ? [s.account] : [] };
    },
    async joinContext(contextId: string) {
      await joinOpen(String(await relay().getContextGroup(contextId)));
      return { contextId, memberPublicKey: s.account };
    },
    async createContext(req: CreateContextRequest) {
      const info = await relay().getGroupInfo(req.groupId);
      const namespaceId = (info as { namespaceId?: string }).namespaceId ?? req.groupId;
      // Every field with a place in the creation warrant; `identitySecret` has
      // none for an account (see CreateDelegatedContextRequest).
      const { contextId } = await createContext(s, {
        namespaceId, groupId: req.groupId, applicationId: req.applicationId,
        serviceName: req.serviceName, contextSeed: req.contextSeed,
        name: req.name, initializationParams: req.initializationParams,
      });
      // The relay executes as the account, so the account is its member key
      // here as it is in `joinContext` and `getContextIdentitiesOwned`. Apps
      // record this key as the context's owner; an empty one was being stored.
      return { contextId, memberPublicKey: s.account, groupId: req.groupId };
    },
    async createNamespaceInvitation(namespaceId: string) {
      const [{ members }, info] = await Promise.all([relay().listGroupMembers(namespaceId), relay().getGroupInfo(namespaceId)]);
      // The relays admit: whoever claims an account's invitation may have no
      // node, and only a relay can admit a joiner with none. With no relay in
      // the namespace, leave it to the admins (signGroupInvitation's default).
      const relays = members
        .filter((m) => m.role === 'RelayTee')
        .map((m) => m.identity.toLowerCase());
      // Where the claimant reaches an admitter when the cloud routes them to
      // none: set only then, so a routed namespace stays the cloud's to route.
      let admitterAddrs: string[] | undefined;
      if (routing) {
        // Who the claimant's client will look for: the admitters this
        // invitation names (the relays, else signGroupInvitation's admins).
        const named = new Set(
          relays.length > 0
            ? relays
            : members.filter((m) => m.role === 'Admin').map((m) => m.identity.toLowerCase()),
        );
        let nodes: ReadonlyArray<{ account: string | null }> | null = null;
        try {
          nodes = (await routing(namespaceId)).nodes;
        } catch {
          // Nothing learned: the claimant's own lookup will say what is wrong.
        }
        if (nodes !== null) {
          if (nodes.length === 0) {
            // The cloud routes a namespace only once its founder has linked
            // the account (HA). Unlinked, the namespace is still served by the
            // relay that founded it and serves this session, a RelayTee
            // member; its own `/admit` takes the join (measured on prod: 200,
            // where the cloud's lookup answered no nodes). The claimant's
            // client cannot find that relay through the cloud, so the
            // invitation says where it is.
            if (relays.length === 0 || !s.relayUrl) throw new InvitationNotClaimableError(namespaceId, 'not-hosted');
            admitterAddrs = [s.relayUrl];
          } else if (!nodes.some((n) => n.account !== null && named.has(n.account.toLowerCase()))) {
            throw new InvitationNotClaimableError(namespaceId, 'no-named-node');
          }
        }
      }
      const invitation = await signInvitation({
        groupId: namespaceId,
        inviterAccount: s.account,
        deviceSecret: s.deviceSecret,
        ...(relays.length > 0 ? { admitters: relays } : {}),
        ...(admitterAddrs ? { admitterAddrs } : {}),
        members: members as never,
        applicationId: (info as { targetApplicationId?: string }).targetApplicationId,
        appKey: (info as { appKey?: string }).appKey,
      });
      return { invitation };
    },
    // The relay syncs its own view; an account has nothing to pull.
    async syncGroup(groupId: string) {
      return { groupId, synced: true };
    },
    async syncContext() {
      // Same: nothing for an account to pull.
    },
    joinNamespace,
    async updateMemberRole(groupId: string, identity: string, req: { role: string }) {
      await group(s, groupId, memberRoleSetOp(identity, req.role as GovernanceMemberRole));
    },
    // An open subgroup is joined the way `joinContext` joins one: MemberJoinedOpen
    // on the subgroup, and nothing to do for a member already in it.
    async joinSubgroupInheritance(groupId: string) {
      return { groupId, memberPublicKey: s.account, wasInherited: await joinOpen(groupId) };
    },
    async detachContextFromGroup(groupId: string, contextId: string) {
      await group(s, groupId, contextDetachedOp(contextId));
    },
  };

  if (read === null) {
    return new Proxy({} as AdminApiClient, {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop === 'getNodeIdentity') return writes.getNodeIdentity;
        if (prop === 'joinNamespace') return joinNamespace;
        if (prop in EMPTY_READS) return EMPTY_READS[prop as keyof AdminApiClient];
        return async () => {
          throw new NoRelayError(prop);
        };
      },
    });
  }

  return new Proxy(read, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && prop in writes) return writes[prop as keyof AdminApiClient];
      if (typeof prop === 'string' && NODE_ONLY.has(prop)) {
        return async () => {
          throw new NotForAccountError(prop);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as AdminApiClient;
}
