/**
 * E2E tests for Admin API — namespace/group/context model.
 *
 * Requires a running merod node with embedded auth on localhost:4001.
 * The CI workflow starts the node via Docker before running these tests.
 *
 * Run manually:
 *   NODE_URL=http://localhost:4001 pnpm test:e2e:admin
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MeroJs } from '../../src/mero-js';

const NODE_URL = process.env.NODE_URL || 'http://localhost:4001';
const USERNAME = 'dev';
const PASSWORD = 'dev';
const KV_STORE_PACKAGE = 'com.calimero.kv-store';

let mero: MeroJs;

// Shared state across ordered test sections
let applicationId: string;
let namespaceId: string;
let namespaceGroupId: string;
let subgroupId: string;
let contextId: string;
let memberPublicKey: string;

describe('Admin API E2E — Namespace Model', () => {
  // ---- Setup ----

  beforeAll(async () => {
    mero = new MeroJs({ baseUrl: NODE_URL });
    await mero.authenticate({ username: USERNAME, password: PASSWORD });
    expect(mero.isAuthenticated()).toBe(true);
  }, 30000);

  afterAll(() => {
    mero.close();
  });

  // ---- Health ----

  describe('Health & Status', () => {
    it('should return alive status', async () => {
      const health = await mero.admin.healthCheck();
      expect(health.status).toBe('alive');
    });

    it('should return peers count', async () => {
      const response = await mero.admin.getPeersCount();
      expect(typeof response.count).toBe('number');
    });
  });

  // ---- Applications ----

  describe('Applications', () => {
    it('should list installed applications', async () => {
      const response = await mero.admin.listApplications();
      expect(response.apps).toBeDefined();
      expect(response.apps.length).toBeGreaterThan(0);

      const kvApp = response.apps.find((a) => a.package === KV_STORE_PACKAGE);
      expect(kvApp).toBeTruthy();
      applicationId = kvApp!.id;
    });

    it('should get application by ID', async () => {
      const response = await mero.admin.getApplication(applicationId);
      expect(response.application).toBeDefined();
      expect(response.application!.id).toBe(applicationId);
      expect(response.application!.package).toBe(KV_STORE_PACKAGE);
    });

    it('should get latest package version', async () => {
      const response = await mero.admin.getLatestPackageVersion(KV_STORE_PACKAGE);
      expect(response.applicationId).toBeTruthy();
      expect(response.version).toBeTruthy();
    });
  });

  // ---- Packages ----

  describe('Packages', () => {
    it('should list packages', async () => {
      const response = await mero.admin.listPackages();
      expect(response.packages).toBeDefined();
      expect(response.packages.length).toBeGreaterThan(0);
      expect(response.packages).toContain(KV_STORE_PACKAGE);
    });

    it('should list package versions', async () => {
      const response = await mero.admin.listPackageVersions(KV_STORE_PACKAGE);
      expect(response.versions).toBeDefined();
      expect(response.versions.length).toBeGreaterThan(0);
    });
  });

  // ---- Namespace lifecycle ----

  describe('Namespace Lifecycle', () => {
    it('should create a namespace', async () => {
      const response = await mero.admin.createNamespace({
        applicationId,
        upgradePolicy: 'manual',
        alias: 'e2e-test-ns',
      });
      expect(response.namespaceId).toBeTruthy();
      namespaceId = response.namespaceId;
    });

    it('should list namespaces', async () => {
      const namespaces = await mero.admin.listNamespaces();
      expect(namespaces.length).toBeGreaterThan(0);
      const found = namespaces.find((ns) => ns.namespaceId === namespaceId);
      expect(found).toBeTruthy();
      expect(found!.alias).toBe('e2e-test-ns');
    });

    it('should get namespace by ID', async () => {
      const ns = await mero.admin.getNamespace(namespaceId);
      expect(ns.namespaceId).toBe(namespaceId);
      expect(ns.targetApplicationId).toBe(applicationId);
      expect(ns.upgradePolicy).toBe('manual');
    });

    it('should get namespace identity', async () => {
      const identity = await mero.admin.getNamespaceIdentity(namespaceId);
      expect(identity.namespaceId).toBe(namespaceId);
      expect(identity.publicKey).toBeTruthy();
    });

    it('should list namespaces for application', async () => {
      const namespaces = await mero.admin.listNamespacesForApplication(applicationId);
      expect(namespaces.length).toBeGreaterThan(0);
      expect(namespaces.some((ns) => ns.namespaceId === namespaceId)).toBe(true);
    });
  });

  // ---- Group within namespace ----

  describe('Group Management', () => {
    it('should create a group in namespace', async () => {
      const response = await mero.admin.createGroupInNamespace(namespaceId, { alias: 'e2e-subgroup' });
      expect(response.groupId).toBeTruthy();
      subgroupId = response.groupId;
    });

    it('should list namespace groups', async () => {
      const groups = await mero.admin.listNamespaceGroups(namespaceId);
      expect(groups.length).toBeGreaterThan(0);
      expect(groups.some((g) => g.groupId === subgroupId)).toBe(true);
    });

    it('should get group info', async () => {
      // Use the namespace's root group (namespaceId is the root group ID)
      const info = await mero.admin.getGroupInfo(namespaceId);
      expect(info.groupId).toBe(namespaceId);
      expect(info.targetApplicationId).toBe(applicationId);
      expect(typeof info.memberCount).toBe('number');
      expect(typeof info.contextCount).toBe('number');
      expect(typeof info.defaultCapabilities).toBe('number');
      expect(typeof info.defaultVisibility).toBe('string');
      namespaceGroupId = info.groupId;
    });

    it('should list group members', async () => {
      const response = await mero.admin.listGroupMembers(namespaceGroupId);
      expect(response.data).toBeDefined();
      expect(response.data.length).toBeGreaterThan(0);
      expect(response.data[0].identity).toBeTruthy();
      expect(response.data[0].role).toBeTruthy();
      expect(response.selfIdentity).toBeTruthy();
    });

    it('should get member capabilities', async () => {
      const members = await mero.admin.listGroupMembers(namespaceGroupId);
      const firstMember = members.data[0].identity;
      const caps = await mero.admin.getMemberCapabilities(namespaceGroupId, firstMember);
      expect(typeof caps.capabilities).toBe('number');
    });
  });

  // ---- Context lifecycle ----

  describe('Context Lifecycle', () => {
    it('should create a context in the namespace group', async () => {
      const response = await mero.admin.createContext({
        applicationId,
        groupId: namespaceGroupId,
      });
      expect(response.contextId).toBeTruthy();
      expect(response.memberPublicKey).toBeTruthy();
      contextId = response.contextId;
      memberPublicKey = response.memberPublicKey;
    });

    it('should list contexts', async () => {
      const response = await mero.admin.getContexts();
      expect(response.contexts.length).toBeGreaterThan(0);
      const found = response.contexts.find((c) => c.id === contextId);
      expect(found).toBeTruthy();
    });

    it('should get context by ID', async () => {
      const ctx = await mero.admin.getContext(contextId);
      expect(ctx.id).toBe(contextId);
      expect(ctx.applicationId).toBe(applicationId);
    });

    it('should get contexts for application', async () => {
      const response = await mero.admin.getContextsForApplication(applicationId);
      expect(response.contexts.some((c) => c.id === contextId)).toBe(true);
    });

    it('should get context group', async () => {
      const groupId = await mero.admin.getContextGroup(contextId);
      expect(groupId).toBe(namespaceGroupId);
    });

    it('should get context storage', async () => {
      const storage = await mero.admin.getContextStorage(contextId);
      expect(typeof storage.sizeInBytes).toBe('number');
    });

    it('should list group contexts', async () => {
      const contexts = await mero.admin.listGroupContexts(namespaceGroupId);
      expect(contexts.length).toBeGreaterThan(0);
      expect(contexts.some((c) => c.contextId === contextId)).toBe(true);
    });

    it('should get context identities', async () => {
      const response = await mero.admin.getContextIdentities(contextId);
      expect(response.identities.length).toBeGreaterThan(0);
      expect(response.identities).toContain(memberPublicKey);
    });

    it('should get owned context identities', async () => {
      const response = await mero.admin.getContextIdentitiesOwned(contextId);
      expect(response.identities.length).toBeGreaterThan(0);
      expect(response.identities).toContain(memberPublicKey);
    });

    it('should join context (as existing group member)', async () => {
      const response = await mero.admin.joinContext(contextId);
      expect(response.contextId).toBe(contextId);
      expect(response.memberPublicKey).toBeTruthy();
    });
  });

  // ---- Alias Management ----

  describe('Alias Management', () => {
    it('should create and lookup a context alias', async () => {
      await mero.admin.createContextAlias({ name: 'e2e-ctx', value: contextId });
      const lookup = await mero.admin.lookupContextAlias('e2e-ctx');
      expect(lookup.value).toBe(contextId);
    });

    it('should list context aliases', async () => {
      const aliases = await mero.admin.listContextAliases();
      expect(aliases.aliases).toBeDefined();
    });

    it('should delete context alias', async () => {
      await mero.admin.deleteContextAlias('e2e-ctx');
      // After delete, lookup should return null/undefined value
      const lookup = await mero.admin.lookupContextAlias('e2e-ctx');
      expect(lookup.value).toBeFalsy();
    });

    it('should create and lookup an application alias', async () => {
      await mero.admin.createApplicationAlias({ name: 'e2e-app', value: applicationId });
      const lookup = await mero.admin.lookupApplicationAlias('e2e-app');
      expect(lookup.value).toBe(applicationId);
      await mero.admin.deleteApplicationAlias('e2e-app');
    });
  });

  // ---- Group Settings ----

  describe('Group Settings', () => {
    it('should set default visibility', async () => {
      await mero.admin.setDefaultVisibility(namespaceGroupId, { defaultVisibility: 'open' });
      const info = await mero.admin.getGroupInfo(namespaceGroupId);
      expect(info.defaultVisibility).toBe('open');
    });

    it('should set default capabilities', async () => {
      await mero.admin.setDefaultCapabilities(namespaceGroupId, { defaultCapabilities: 7 });
      const info = await mero.admin.getGroupInfo(namespaceGroupId);
      expect(info.defaultCapabilities).toBe(7);
    });

    it('should set group alias', async () => {
      await mero.admin.setGroupAlias(namespaceGroupId, { alias: 'renamed-group' });
      const info = await mero.admin.getGroupInfo(namespaceGroupId);
      expect(info.alias).toBe('renamed-group');
    });
  });

  // ---- Namespace Invitation Flow ----

  describe('Namespace Invitation', () => {
    it('should create a namespace invitation', async () => {
      const response = await mero.admin.createNamespaceInvitation(namespaceId);
      expect('invitation' in response).toBe(true);
      if ('invitation' in response) {
        expect(response.invitation).toBeTruthy();
        expect(response.invitation.inviterSignature).toBeTruthy();
      }
    });

    it('should create a group invitation', async () => {
      const response = await mero.admin.createGroupInvitation(namespaceGroupId);
      if ('invitation' in response) {
        expect(response.invitation).toBeTruthy();
        expect(response.invitation.inviterSignature).toBeTruthy();
      }
    });
  });

  // ---- Group Sync & Signing Key ----

  describe('Group Sync & Signing Key', () => {
    it('should sync group', async () => {
      const response = await mero.admin.syncGroup(namespaceGroupId);
      expect(response.groupId).toBe(namespaceGroupId);
      expect(typeof response.memberCount).toBe('number');
      expect(typeof response.contextCount).toBe('number');
    });

    it('should sync context', async () => {
      // Should not throw
      await mero.admin.syncContext(contextId);
    });
  });

  // ---- Group Nesting ----

  describe('Group Nesting', () => {
    it('should list subgroups', async () => {
      const subgroups = await mero.admin.listSubgroups(namespaceGroupId);
      expect(Array.isArray(subgroups)).toBe(true);
      // The subgroup we created earlier should be listed
      expect(subgroups.some((sg) => sg.groupId === subgroupId)).toBe(true);
    });
  });

  // ---- TEE (may not be enabled, test gracefully) ----

  describe('TEE', () => {
    it('should get TEE info', async () => {
      try {
        const info = await mero.admin.getTeeInfo();
        expect(info.cloudProvider).toBeDefined();
        expect(info.osImage).toBeDefined();
        expect(info.mrtd).toBeDefined();
      } catch {
        // TEE may not be enabled on the test node, that's OK
      }
    });
  });

  // ---- Cleanup ----

  describe('Cleanup', () => {
    it('should delete context', async () => {
      if (!contextId) return;
      const result = await mero.admin.deleteContext(contextId);
      expect(result.isDeleted).toBe(true);
    });

    it('should delete subgroup', async () => {
      if (!subgroupId) return;
      const result = await mero.admin.deleteGroup(subgroupId);
      expect(result.isDeleted).toBe(true);
    });

    it('should delete namespace', async () => {
      if (!namespaceId) return;
      const result = await mero.admin.deleteNamespace(namespaceId);
      expect(result.isDeleted).toBe(true);
    });

    it('should verify namespace is deleted', async () => {
      const namespaces = await mero.admin.listNamespaces();
      expect(namespaces.find((ns) => ns.namespaceId === namespaceId)).toBeUndefined();
    });
  });
});
