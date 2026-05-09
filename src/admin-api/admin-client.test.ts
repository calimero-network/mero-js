import { describe, it, expect, beforeEach } from 'vitest';
import { AdminApiClient } from './admin-client';
import { HttpClient } from '../http-client';

// Mock HttpClient that stores expected responses and records request bodies
class MockHttpClient implements HttpClient {
  private mockResponses = new Map<string, unknown>();
  private requestBodies = new Map<string, unknown>();

  setMockResponse(method: string, path: string, response: unknown) {
    this.mockResponses.set(`${method} ${path}`, response);
  }

  getRequestBody(method: string, path: string): unknown {
    return this.requestBodies.get(`${method} ${path}`);
  }

  private getResponse(method: string, path: string): unknown {
    const key = `${method} ${path}`;
    const response = this.mockResponses.get(key);
    if (!response) {
      throw new Error(`No mock response for ${key}`);
    }
    return response;
  }

  async get<T>(path: string): Promise<T> { return this.getResponse('GET', path) as T; }
  async post<T>(path: string, body?: unknown): Promise<T> {
    this.requestBodies.set(`POST ${path}`, body);
    return this.getResponse('POST', path) as T;
  }
  async put<T>(path: string, body?: unknown): Promise<T> {
    this.requestBodies.set(`PUT ${path}`, body);
    return this.getResponse('PUT', path) as T;
  }
  async delete<T>(path: string): Promise<T> { return this.getResponse('DELETE', path) as T; }
  async patch<T>(path: string, body?: unknown): Promise<T> {
    this.requestBodies.set(`PATCH ${path}`, body);
    return this.getResponse('PATCH', path) as T;
  }
  async head(_path: string): Promise<{ headers: Record<string, string>; status: number }> {
    return { headers: {}, status: 200 };
  }
  async request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const method = init?.method ?? 'GET';
    let body = init?.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    this.requestBodies.set(`${method} ${path}`, body);
    return this.getResponse(method, path) as T;
  }
}

describe('AdminApiClient', () => {
  let mock: MockHttpClient;
  let client: AdminApiClient;

  beforeEach(() => {
    mock = new MockHttpClient();
    client = new AdminApiClient(mock);
  });

  describe('Health and Status', () => {
    it('healthCheck unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/health', { data: { status: 'alive' } });
      const result = await client.healthCheck();
      expect(result).toEqual({ status: 'alive' });
    });

    it('isAuthed returns raw response', async () => {
      mock.setMockResponse('GET', '/admin-api/is-authed', { data: { status: 'alive' } });
      const result = await client.isAuthed();
      expect(result).toEqual({ data: { status: 'alive' } });
    });
  });

  describe('Application Management', () => {
    it('installApplication unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/install-application', { data: { applicationId: 'app-1' } });
      const result = await client.installApplication({ url: 'http://...', metadata: [] });
      expect(result).toEqual({ applicationId: 'app-1' });
    });

    it('installDevApplication unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/install-dev-application', { data: { applicationId: 'app-2' } });
      const result = await client.installDevApplication({ path: '/tmp/app.mpk', metadata: [] });
      expect(result).toEqual({ applicationId: 'app-2' });
    });

    it('uninstallApplication unwraps data', async () => {
      mock.setMockResponse('DELETE', '/admin-api/applications/app-1', { data: { applicationId: 'app-1' } });
      const result = await client.uninstallApplication('app-1');
      expect(result).toEqual({ applicationId: 'app-1' });
    });

    it('listApplications unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/applications', { data: { apps: [{ id: 'app-1' }] } });
      const result = await client.listApplications();
      expect(result).toEqual({ apps: [{ id: 'app-1' }] });
    });

    it('getApplication unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/applications/app-1', { data: { application: { id: 'app-1' } } });
      const result = await client.getApplication('app-1');
      expect(result).toEqual({ application: { id: 'app-1' } });
    });
  });

  describe('Package Management', () => {
    it('getLatestPackageVersion returns flat response', async () => {
      mock.setMockResponse('GET', '/admin-api/packages/com.calimero.app/latest', { applicationId: 'app-1', version: '1.0' });
      const result = await client.getLatestPackageVersion('com.calimero.app');
      expect(result).toEqual({ applicationId: 'app-1', version: '1.0' });
    });

    it('listPackages unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/packages', { data: { packages: ['pkg-a', 'pkg-b'] } });
      const result = await client.listPackages();
      expect(result).toEqual({ packages: ['pkg-a', 'pkg-b'] });
    });

    it('listPackageVersions unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/packages/pkg-a/versions', { data: { versions: ['1.0', '2.0'] } });
      const result = await client.listPackageVersions('pkg-a');
      expect(result).toEqual({ versions: ['1.0', '2.0'] });
    });
  });

  describe('Context Management', () => {
    it('createContext unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/contexts', { data: { contextId: 'ctx-1', memberPublicKey: 'key-1' } });
      const result = await client.createContext({ applicationId: 'app-1', groupId: 'group-1' });
      expect(result).toEqual({ contextId: 'ctx-1', memberPublicKey: 'key-1' });
    });

    it('createContext sends all optional fields', async () => {
      mock.setMockResponse('POST', '/admin-api/contexts', { data: { contextId: 'ctx-1', memberPublicKey: 'key-1', groupId: 'g-1', groupCreated: true } });
      const result = await client.createContext({
        applicationId: 'app-1',
        groupId: 'group-1',
        serviceName: 'chat',
        identitySecret: 'secret',
        alias: 'my-ctx',
      });
      expect(result.groupId).toBe('g-1');
      expect(result.groupCreated).toBe(true);
      expect(mock.getRequestBody('POST', '/admin-api/contexts')).toEqual({
        applicationId: 'app-1',
        groupId: 'group-1',
        serviceName: 'chat',
        identitySecret: 'secret',
        alias: 'my-ctx',
      });
    });

    it('deleteContext unwraps data', async () => {
      mock.setMockResponse('DELETE', '/admin-api/contexts/ctx-1', { data: { isDeleted: true } });
      const result = await client.deleteContext('ctx-1');
      expect(result).toEqual({ isDeleted: true });
    });

    it('deleteContext with requester sends body', async () => {
      mock.setMockResponse('DELETE', '/admin-api/contexts/ctx-1', { data: { isDeleted: true } });
      const result = await client.deleteContext('ctx-1', { requester: 'pk-admin' });
      expect(result).toEqual({ isDeleted: true });
      expect(mock.getRequestBody('DELETE', '/admin-api/contexts/ctx-1')).toEqual({ requester: 'pk-admin' });
    });

    it('getContexts returns contexts with groupId', async () => {
      const ctx = { id: 'ctx-1', applicationId: 'app-1', rootHash: 'abc', dagHeads: [], groupId: 'g-1' };
      mock.setMockResponse('GET', '/admin-api/contexts', { data: { contexts: [ctx] } });
      const result = await client.getContexts();
      expect(result.contexts).toHaveLength(1);
      expect(result.contexts[0].id).toBe('ctx-1');
      expect(result.contexts[0].groupId).toBe('g-1');
    });

    it('getContext unwraps data', async () => {
      const ctx = { id: 'ctx-1', applicationId: 'app-1', rootHash: 'abc', dagHeads: [] };
      mock.setMockResponse('GET', '/admin-api/contexts/ctx-1', { data: ctx });
      const result = await client.getContext('ctx-1');
      expect(result.id).toBe('ctx-1');
    });

    it('getContextsForApplication unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/contexts/for-application/app-1', { data: { contexts: [] } });
      const result = await client.getContextsForApplication('app-1');
      expect(result.contexts).toEqual([]);
    });
  });

  describe('Context Identity', () => {
    it('generateContextIdentity unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/identity/context', { data: { publicKey: 'pk-1' } });
      const result = await client.generateContextIdentity();
      expect(result).toEqual({ publicKey: 'pk-1' });
    });

    it('getContextIdentities unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/contexts/ctx-1/identities', { data: { identities: ['id-1'] } });
      const result = await client.getContextIdentities('ctx-1');
      expect(result).toEqual({ identities: ['id-1'] });
    });

    it('getContextIdentitiesOwned unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/contexts/ctx-1/identities-owned', { data: { identities: ['id-1'] } });
      const result = await client.getContextIdentitiesOwned('ctx-1');
      expect(result).toEqual({ identities: ['id-1'] });
    });
  });

  describe('Context Join / Group / Storage / Sync', () => {
    it('joinContext posts to contexts/:id/join and unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/contexts/ctx-1/join', { data: { contextId: 'ctx-1', memberPublicKey: 'pk-1' } });
      const result = await client.joinContext('ctx-1');
      expect(result).toEqual({ contextId: 'ctx-1', memberPublicKey: 'pk-1' });
    });

    it('getContextGroup returns group id', async () => {
      mock.setMockResponse('GET', '/admin-api/contexts/ctx-1/group', { data: 'abcdef0123456789' });
      const result = await client.getContextGroup('ctx-1');
      expect(result).toBe('abcdef0123456789');
    });

    it('getContextGroup returns null when no group', async () => {
      mock.setMockResponse('GET', '/admin-api/contexts/ctx-1/group', { data: null });
      const result = await client.getContextGroup('ctx-1');
      expect(result).toBeNull();
    });

    it('getContextStorage unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/contexts/ctx-1/storage', { data: { sizeInBytes: 1024 } });
      const result = await client.getContextStorage('ctx-1');
      expect(result).toEqual({ sizeInBytes: 1024 });
    });

    it('syncContext posts to correct path', async () => {
      mock.setMockResponse('POST', '/admin-api/contexts/sync/ctx-1', { data: null });
      await client.syncContext('ctx-1');
      expect(mock.getRequestBody('POST', '/admin-api/contexts/sync/ctx-1')).toEqual({});
    });

    it('syncContext without id syncs all', async () => {
      mock.setMockResponse('POST', '/admin-api/contexts/sync/', { data: null });
      await client.syncContext();
      expect(mock.getRequestBody('POST', '/admin-api/contexts/sync/')).toEqual({});
    });

    it('getContextsWithExecutorsForApplication unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/contexts/with-executors/for-application/app-1', {
        data: [{ contextId: 'ctx-1', executors: ['exec-1'] }],
      });
      const result = await client.getContextsWithExecutorsForApplication('app-1');
      expect(result).toEqual([{ contextId: 'ctx-1', executors: ['exec-1'] }]);
    });
  });

  describe('Specialized Node Invite', () => {
    it('inviteSpecializedNode sends correct request and unwraps nonce', async () => {
      mock.setMockResponse('POST', '/admin-api/contexts/invite-specialized-node', { data: { nonce: 'abc123' } });
      const result = await client.inviteSpecializedNode({ contextId: 'ctx-1', inviterId: 'pk-1' });
      expect(result).toEqual({ nonce: 'abc123' });
      expect(mock.getRequestBody('POST', '/admin-api/contexts/invite-specialized-node')).toEqual({
        contextId: 'ctx-1',
        inviterId: 'pk-1',
      });
    });

    it('inviteSpecializedNode works without inviterId', async () => {
      mock.setMockResponse('POST', '/admin-api/contexts/invite-specialized-node', { data: { nonce: 'def456' } });
      const result = await client.inviteSpecializedNode({ contextId: 'ctx-1' });
      expect(result.nonce).toBe('def456');
    });
  });

  describe('Update Context Application', () => {
    it('updateContextApplication sends all fields', async () => {
      mock.setMockResponse('POST', '/admin-api/contexts/ctx-1/application', { data: {} });
      await client.updateContextApplication('ctx-1', {
        applicationId: 'app-2',
        executorPublicKey: 'pk-1',
        migrateMethod: 'migrate_v2',
      });
      expect(mock.getRequestBody('POST', '/admin-api/contexts/ctx-1/application')).toEqual({
        applicationId: 'app-2',
        executorPublicKey: 'pk-1',
        migrateMethod: 'migrate_v2',
      });
    });
  });

  describe('Blob Management', () => {
    it('uploadBlob uses PUT and unwraps data', async () => {
      mock.setMockResponse('PUT', '/admin-api/blobs', { data: { blobId: 'blob-1', size: 3 } });
      const result = await client.uploadBlob({ data: new Uint8Array([1, 2, 3]) });
      expect(result).toEqual({ blobId: 'blob-1', size: 3 });
    });

    it('deleteBlob unwraps data', async () => {
      mock.setMockResponse('DELETE', '/admin-api/blobs/blob-1', { data: { blobId: 'blob-1', deleted: true } });
      const result = await client.deleteBlob('blob-1');
      expect(result).toEqual({ blobId: 'blob-1', deleted: true });
    });

    it('listBlobs unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/blobs', { data: { blobs: [{ blobId: 'blob-1', size: 100 }] } });
      const result = await client.listBlobs();
      expect(result).toEqual({ blobs: [{ blobId: 'blob-1', size: 100 }] });
    });

    it('getBlob unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/blobs/blob-1', { data: { blobId: 'blob-1', size: 100 } });
      const result = await client.getBlob('blob-1');
      expect(result).toEqual({ blobId: 'blob-1', size: 100 });
    });
  });

  describe('Alias Management', () => {
    it('createContextAlias unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/alias/create/context', { data: {} });
      const result = await client.createContextAlias({ name: 'my-ctx', value: 'ctx-1' });
      expect(result).toEqual({});
    });

    it('createApplicationAlias unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/alias/create/application', { data: {} });
      const result = await client.createApplicationAlias({ name: 'my-app', value: 'app-1' });
      expect(result).toEqual({});
    });

    it('lookupContextAlias unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/alias/lookup/context/my-ctx', { data: { value: 'ctx-1' } });
      const result = await client.lookupContextAlias('my-ctx');
      expect(result).toEqual({ value: 'ctx-1' });
    });

    it('lookupApplicationAlias unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/alias/lookup/application/my-app', { data: { value: 'app-1' } });
      const result = await client.lookupApplicationAlias('my-app');
      expect(result).toEqual({ value: 'app-1' });
    });

    it('deleteContextAlias unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/alias/delete/context/my-ctx', { data: {} });
      const result = await client.deleteContextAlias('my-ctx');
      expect(result).toEqual({});
    });

    it('deleteApplicationAlias unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/alias/delete/application/my-app', { data: {} });
      const result = await client.deleteApplicationAlias('my-app');
      expect(result).toEqual({});
    });

    it('listContextAliases unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/alias/list/context', { data: { aliases: [{ name: 'a', value: 'ctx-1' }] } });
      const result = await client.listContextAliases();
      expect(result).toEqual({ aliases: [{ name: 'a', value: 'ctx-1' }] });
    });

    it('listApplicationAliases unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/alias/list/application', { data: { aliases: [] } });
      const result = await client.listApplicationAliases();
      expect(result).toEqual({ aliases: [] });
    });
  });

  describe('Context Identity Aliases', () => {
    it('listContextIdentityAliases unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/alias/list/identity/ctx-1', { data: { aliases: [{ name: 'alice', value: 'pk-1' }] } });
      const result = await client.listContextIdentityAliases('ctx-1');
      expect(result).toEqual({ aliases: [{ name: 'alice', value: 'pk-1' }] });
    });

    it('createContextIdentityAlias unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/alias/create/identity/ctx-1', { data: {} });
      const result = await client.createContextIdentityAlias('ctx-1', { name: 'alice', value: 'pk-1' });
      expect(result).toEqual({});
    });

    it('lookupContextIdentityAlias unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/alias/lookup/identity/ctx-1/alice', { data: { value: 'pk-1' } });
      const result = await client.lookupContextIdentityAlias('ctx-1', 'alice');
      expect(result).toEqual({ value: 'pk-1' });
    });

    it('deleteContextIdentityAlias unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/alias/delete/identity/ctx-1/alice', { data: {} });
      const result = await client.deleteContextIdentityAlias('ctx-1', 'alice');
      expect(result).toEqual({});
    });
  });

  describe('Namespace Management', () => {
    it('listNamespaces unwraps data', async () => {
      const ns = { namespaceId: 'ns-1', appKey: 'key', targetApplicationId: 'app-1', upgradePolicy: 'manual', createdAt: 123, memberCount: 1, contextCount: 0, subgroupCount: 0 };
      mock.setMockResponse('GET', '/admin-api/namespaces', { data: [ns] });
      const result = await client.listNamespaces();
      expect(result).toEqual([ns]);
    });

    it('getNamespace unwraps data', async () => {
      const ns = { namespaceId: 'ns-1', appKey: 'key', targetApplicationId: 'app-1', upgradePolicy: 'manual', createdAt: 123, memberCount: 1, contextCount: 0, subgroupCount: 0 };
      mock.setMockResponse('GET', '/admin-api/namespaces/ns-1', { data: ns });
      const result = await client.getNamespace('ns-1');
      expect(result.namespaceId).toBe('ns-1');
    });

    it('getNamespaceIdentity unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/namespaces/ns-1/identity', { data: { namespaceId: 'ns-1', publicKey: 'pk-1' } });
      const result = await client.getNamespaceIdentity('ns-1');
      expect(result).toEqual({ namespaceId: 'ns-1', publicKey: 'pk-1' });
    });

    it('listNamespacesForApplication unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/namespaces/for-application/app-1', { data: [] });
      const result = await client.listNamespacesForApplication('app-1');
      expect(result).toEqual([]);
    });

    it('createNamespace sends correct fields', async () => {
      mock.setMockResponse('POST', '/admin-api/namespaces', { data: { namespaceId: 'ns-1' } });
      const result = await client.createNamespace({ applicationId: 'app-1', upgradePolicy: 'manual', alias: 'My NS' });
      expect(result).toEqual({ namespaceId: 'ns-1' });
      expect(mock.getRequestBody('POST', '/admin-api/namespaces')).toEqual({
        applicationId: 'app-1',
        upgradePolicy: 'manual',
        alias: 'My NS',
      });
    });

    it('deleteNamespace with requester', async () => {
      mock.setMockResponse('DELETE', '/admin-api/namespaces/ns-1', { data: { isDeleted: true } });
      const result = await client.deleteNamespace('ns-1', { requester: 'pk-admin' });
      expect(result).toEqual({ isDeleted: true });
      expect(mock.getRequestBody('DELETE', '/admin-api/namespaces/ns-1')).toEqual({ requester: 'pk-admin' });
    });

    it('createNamespaceInvitation sends structured request', async () => {
      const invitation = {
        invitation: { inviterIdentity: [1], groupId: [2], expirationTimestamp: 999, secretSalt: [3], invitedRole: 1 },
        inviterSignature: 'sig-1',
      };
      mock.setMockResponse('POST', '/admin-api/namespaces/ns-1/invite', { data: { invitation, groupAlias: 'NS' } });
      const result = await client.createNamespaceInvitation('ns-1', { expirationTimestamp: 999 });
      expect(result).toEqual({ invitation, groupAlias: 'NS' });
    });

    it('joinNamespace sends structured invitation', async () => {
      const invitation = {
        invitation: { inviterIdentity: [1], groupId: [2], expirationTimestamp: 999, secretSalt: [3] },
        inviterSignature: 'sig-1',
      };
      mock.setMockResponse('POST', '/admin-api/namespaces/ns-1/join', {
        data: { groupId: 'g-1', memberIdentity: 'pk-1', governanceOp: 'op-hex' },
      });
      const result = await client.joinNamespace('ns-1', { invitation, groupAlias: 'My NS' });
      expect(result).toEqual({ groupId: 'g-1', memberIdentity: 'pk-1', governanceOp: 'op-hex' });
      expect(mock.getRequestBody('POST', '/admin-api/namespaces/ns-1/join')).toEqual({ invitation, groupAlias: 'My NS' });
    });

    it('createGroupInNamespace sends request', async () => {
      mock.setMockResponse('POST', '/admin-api/namespaces/ns-1/groups', { data: { groupId: 'g-1' } });
      const result = await client.createGroupInNamespace('ns-1', { alias: 'Sub' });
      expect(result).toEqual({ groupId: 'g-1' });
    });

    it('listNamespaceGroups unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/namespaces/ns-1/groups', { data: [{ groupId: 'g-1', alias: 'Sub' }] });
      const result = await client.listNamespaceGroups('ns-1');
      expect(result).toEqual([{ groupId: 'g-1', alias: 'Sub' }]);
    });
  });

  describe('Group Management', () => {
    it('getGroupInfo unwraps data with all fields', async () => {
      const info = {
        groupId: 'g-1',
        appKey: 'key',
        targetApplicationId: 'app-1',
        upgradePolicy: 'manual',
        memberCount: 3,
        contextCount: 2,
        defaultCapabilities: 7,
        subgroupVisibility: 'open',
        alias: 'Lobby',
        activeUpgrade: null,
      };
      mock.setMockResponse('GET', '/admin-api/groups/g-1', { data: info });
      const result = await client.getGroupInfo('g-1');
      expect(result.memberCount).toBe(3);
      expect(result.defaultCapabilities).toBe(7);
      expect(result.subgroupVisibility).toBe('open');
    });

    it('deleteGroup without requester', async () => {
      mock.setMockResponse('DELETE', '/admin-api/groups/g-1', { data: { isDeleted: true } });
      const result = await client.deleteGroup('g-1');
      expect(result).toEqual({ isDeleted: true });
    });

    it('deleteGroup with requester sends body', async () => {
      mock.setMockResponse('DELETE', '/admin-api/groups/g-1', { data: { isDeleted: true } });
      const result = await client.deleteGroup('g-1', { requester: 'pk-admin' });
      expect(result).toEqual({ isDeleted: true });
      expect(mock.getRequestBody('DELETE', '/admin-api/groups/g-1')).toEqual({ requester: 'pk-admin' });
    });

    it('listGroupMembers preserves selfIdentity', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/g-1/members', {
        members: [{ identity: 'member-1', role: 'Member' }],
        selfIdentity: 'self-1',
      });
      const result = await client.listGroupMembers('g-1');
      expect(result.members).toHaveLength(1);
      expect(result.selfIdentity).toBe('self-1');
    });

    it('listGroupContexts unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/g-1/contexts', { data: [{ contextId: 'ctx-1', alias: 'Chat' }] });
      const result = await client.listGroupContexts('g-1');
      expect(result).toEqual([{ contextId: 'ctx-1', alias: 'Chat' }]);
    });

    it('addGroupMembers sends structured members with requester', async () => {
      mock.setMockResponse('POST', '/admin-api/groups/g-1/members', {});
      await client.addGroupMembers('g-1', {
        members: [{ identity: 'pk-1', role: 'Member' }],
        requester: 'pk-admin',
      });
      expect(mock.getRequestBody('POST', '/admin-api/groups/g-1/members')).toEqual({
        members: [{ identity: 'pk-1', role: 'Member' }],
        requester: 'pk-admin',
      });
    });

    it('removeGroupMembers sends identity list', async () => {
      mock.setMockResponse('POST', '/admin-api/groups/g-1/members/remove', {});
      await client.removeGroupMembers('g-1', { members: ['pk-1', 'pk-2'] });
      expect(mock.getRequestBody('POST', '/admin-api/groups/g-1/members/remove')).toEqual({
        members: ['pk-1', 'pk-2'],
      });
    });

    it('updateMemberRole sends role', async () => {
      mock.setMockResponse('PUT', '/admin-api/groups/g-1/members/pk-1/role', {});
      await client.updateMemberRole('g-1', 'pk-1', { role: 'Admin' });
      expect(mock.getRequestBody('PUT', '/admin-api/groups/g-1/members/pk-1/role')).toEqual({ role: 'Admin' });
    });

    it('getMemberCapabilities unwraps data with bitmask', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/g-1/members/pk-1/capabilities', { data: { capabilities: 7 } });
      const result = await client.getMemberCapabilities('g-1', 'pk-1');
      expect(result).toEqual({ capabilities: 7 });
    });

    it('setMemberCapabilities sends bitmask with requester', async () => {
      mock.setMockResponse('PUT', '/admin-api/groups/g-1/members/pk-1/capabilities', {});
      await client.setMemberCapabilities('g-1', 'pk-1', { capabilities: 7, requester: 'pk-admin' });
      expect(mock.getRequestBody('PUT', '/admin-api/groups/g-1/members/pk-1/capabilities')).toEqual({
        capabilities: 7,
        requester: 'pk-admin',
      });
    });
  });

  describe('Group Settings', () => {
    it('setDefaultCapabilities sends bitmask', async () => {
      mock.setMockResponse('PUT', '/admin-api/groups/g-1/settings/default-capabilities', {});
      await client.setDefaultCapabilities('g-1', { defaultCapabilities: 3 });
      expect(mock.getRequestBody('PUT', '/admin-api/groups/g-1/settings/default-capabilities')).toEqual({
        defaultCapabilities: 3,
      });
    });

    it('setSubgroupVisibility sends visibility string', async () => {
      mock.setMockResponse('PUT', '/admin-api/groups/g-1/settings/subgroup-visibility', {});
      await client.setSubgroupVisibility('g-1', { subgroupVisibility: 'open' });
      expect(mock.getRequestBody('PUT', '/admin-api/groups/g-1/settings/subgroup-visibility')).toEqual({
        subgroupVisibility: 'open',
      });
    });

    it('setSubgroupVisibility forwards requester when provided', async () => {
      mock.setMockResponse('PUT', '/admin-api/groups/g-1/settings/subgroup-visibility', {});
      await client.setSubgroupVisibility('g-1', {
        subgroupVisibility: 'restricted',
        requester: 'pk-admin',
      });
      expect(mock.getRequestBody('PUT', '/admin-api/groups/g-1/settings/subgroup-visibility')).toEqual({
        subgroupVisibility: 'restricted',
        requester: 'pk-admin',
      });
    });

    it('setTeeAdmissionPolicy sends full policy', async () => {
      const policy = {
        allowedMrtd: ['abc'],
        allowedRtmr0: [],
        allowedRtmr1: [],
        allowedRtmr2: [],
        allowedRtmr3: [],
        allowedTcbStatuses: ['UpToDate'],
        acceptMock: false,
      };
      mock.setMockResponse('PUT', '/admin-api/groups/g-1/settings/tee-admission-policy', {});
      await client.setTeeAdmissionPolicy('g-1', policy);
      expect(mock.getRequestBody('PUT', '/admin-api/groups/g-1/settings/tee-admission-policy')).toEqual(policy);
    });

    it('updateGroupSettings sends PATCH with upgradePolicy', async () => {
      mock.setMockResponse('PATCH', '/admin-api/groups/g-1', {});
      await client.updateGroupSettings('g-1', { upgradePolicy: 'automatic' });
      expect(mock.getRequestBody('PATCH', '/admin-api/groups/g-1')).toEqual({ upgradePolicy: 'automatic' });
    });

    it('setGroupAlias sends alias', async () => {
      mock.setMockResponse('PUT', '/admin-api/groups/g-1/alias', {});
      await client.setGroupAlias('g-1', { alias: 'My Group' });
      expect(mock.getRequestBody('PUT', '/admin-api/groups/g-1/alias')).toEqual({ alias: 'My Group' });
    });

    it('setMemberAlias sends alias', async () => {
      mock.setMockResponse('PUT', '/admin-api/groups/g-1/members/pk-1/alias', {});
      await client.setMemberAlias('g-1', 'pk-1', { alias: 'Alice' });
      expect(mock.getRequestBody('PUT', '/admin-api/groups/g-1/members/pk-1/alias')).toEqual({ alias: 'Alice' });
    });
  });

  describe('Group Sync & Signing Key', () => {
    it('syncGroup unwraps data with full response', async () => {
      mock.setMockResponse('POST', '/admin-api/groups/g-1/sync', {
        data: { groupId: 'g-1', appKey: 'key', targetApplicationId: 'app-1', memberCount: 2, contextCount: 1 },
      });
      const result = await client.syncGroup('g-1');
      expect(result.groupId).toBe('g-1');
      expect(result.memberCount).toBe(2);
    });

    it('registerGroupSigningKey unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/groups/g-1/signing-key', { data: { publicKey: 'pk-123' } });
      const result = await client.registerGroupSigningKey('g-1', { signingKey: 'sk-123' });
      expect(result).toEqual({ publicKey: 'pk-123' });
    });
  });

  describe('Group Upgrade', () => {
    it('upgradeGroup sends request with migrateMethod', async () => {
      mock.setMockResponse('POST', '/admin-api/groups/g-1/upgrade', {
        data: { groupId: 'g-1', status: 'in_progress', total: 3, completed: 0, failed: 0 },
      });
      const result = await client.upgradeGroup('g-1', {
        targetApplicationId: 'app-2',
        migrateMethod: 'migrate_v2',
      });
      expect(result.status).toBe('in_progress');
      expect(mock.getRequestBody('POST', '/admin-api/groups/g-1/upgrade')).toEqual({
        targetApplicationId: 'app-2',
        migrateMethod: 'migrate_v2',
      });
    });

    it('getGroupUpgradeStatus returns status', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/g-1/upgrade/status', {
        data: { fromVersion: '1.0', toVersion: '2.0', initiatedAt: 123, initiatedBy: 'pk-1', status: 'completed', total: 3, completed: 3, failed: 0, completedAt: 456 },
      });
      const result = await client.getGroupUpgradeStatus('g-1');
      expect(result?.status).toBe('completed');
      expect(result?.completedAt).toBe(456);
    });

    it('getGroupUpgradeStatus returns null when no upgrade', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/g-1/upgrade/status', { data: null });
      const result = await client.getGroupUpgradeStatus('g-1');
      expect(result).toBeNull();
    });

    it('retryGroupUpgrade unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/groups/g-1/upgrade/retry', {
        data: { groupId: 'g-1', status: 'in_progress', total: 3, completed: 1, failed: 0 },
      });
      const result = await client.retryGroupUpgrade('g-1');
      expect(result.status).toBe('in_progress');
    });
  });

  describe('Group Nesting', () => {
    it('nestGroup sends childGroupId', async () => {
      mock.setMockResponse('POST', '/admin-api/groups/parent-1/nest', {});
      await client.nestGroup('parent-1', { childGroupId: 'child-1' });
      expect(mock.getRequestBody('POST', '/admin-api/groups/parent-1/nest')).toEqual({ childGroupId: 'child-1' });
    });

    it('unnestGroup sends childGroupId', async () => {
      mock.setMockResponse('POST', '/admin-api/groups/parent-1/unnest', {});
      await client.unnestGroup('parent-1', { childGroupId: 'child-1' });
      expect(mock.getRequestBody('POST', '/admin-api/groups/parent-1/unnest')).toEqual({ childGroupId: 'child-1' });
    });

    it('listSubgroups unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/g-1/subgroups', { data: [{ groupId: 'sub-1', alias: 'Sub' }] });
      const result = await client.listSubgroups('g-1');
      expect(result).toEqual([{ groupId: 'sub-1', alias: 'Sub' }]);
    });

    it('detachContextFromGroup sends request', async () => {
      mock.setMockResponse('POST', '/admin-api/groups/g-1/contexts/ctx-1/remove', {});
      await client.detachContextFromGroup('g-1', 'ctx-1', { requester: 'pk-admin' });
      expect(mock.getRequestBody('POST', '/admin-api/groups/g-1/contexts/ctx-1/remove')).toEqual({ requester: 'pk-admin' });
    });
  });

  describe('Group Invitation & Join', () => {
    const mockInvitation = {
      invitation: { inviterIdentity: [1], groupId: [2], expirationTimestamp: 999, secretSalt: [3] },
      inviterSignature: 'sig-1',
    };

    it('createGroupInvitation returns structured invitation', async () => {
      mock.setMockResponse('POST', '/admin-api/groups/g-1/invite', {
        data: { invitation: mockInvitation, groupAlias: 'Lobby' },
      });
      const result = await client.createGroupInvitation('g-1', { expirationTimestamp: 999 });
      expect(result).toEqual({ invitation: mockInvitation, groupAlias: 'Lobby' });
    });

    it('createGroupInvitation with recursive returns list', async () => {
      mock.setMockResponse('POST', '/admin-api/groups/g-1/invite', {
        data: { invitations: [{ groupId: 'g-1', invitation: mockInvitation, groupAlias: 'Lobby' }] },
      });
      const result = await client.createGroupInvitation('g-1', { recursive: true });
      expect('invitations' in result).toBe(true);
    });

    it('joinGroup sends invitation and unwraps response', async () => {
      mock.setMockResponse('POST', '/admin-api/groups/join', {
        data: { groupId: 'g-1', memberIdentity: 'pk-1', governanceOp: 'op-hex' },
      });
      const result = await client.joinGroup({ invitation: mockInvitation, groupAlias: 'Lobby' });
      expect(result).toEqual({ groupId: 'g-1', memberIdentity: 'pk-1', governanceOp: 'op-hex' });
      expect(mock.getRequestBody('POST', '/admin-api/groups/join')).toEqual({
        invitation: mockInvitation,
        groupAlias: 'Lobby',
      });
    });
  });

  describe('TEE', () => {
    it('getTeeInfo unwraps data with correct fields', async () => {
      mock.setMockResponse('GET', '/admin-api/tee/info', {
        data: { cloudProvider: 'gcp', osImage: 'ubuntu-2404-tdx', mrtd: 'aabbcc' },
      });
      const result = await client.getTeeInfo();
      expect(result.cloudProvider).toBe('gcp');
      expect(result.osImage).toBe('ubuntu-2404-tdx');
      expect(result.mrtd).toBe('aabbcc');
    });

    it('teeAttest sends nonce and unwraps quote', async () => {
      const quote = { header: {}, body: {}, signature: 'sig', attestationKey: 'ak', certificationData: {} };
      mock.setMockResponse('POST', '/admin-api/tee/attest', { data: { quoteB64: 'base64...', quote } });
      const result = await client.teeAttest({ nonce: 'a'.repeat(64) });
      expect(result.quoteB64).toBe('base64...');
      expect(result.quote).toBeDefined();
      expect(mock.getRequestBody('POST', '/admin-api/tee/attest')).toEqual({ nonce: 'a'.repeat(64) });
    });

    it('teeAttest with applicationId', async () => {
      const quote = { header: {}, body: {}, signature: 'sig', attestationKey: 'ak', certificationData: {} };
      mock.setMockResponse('POST', '/admin-api/tee/attest', { data: { quoteB64: 'base64...', quote } });
      await client.teeAttest({ nonce: 'a'.repeat(64), applicationId: 'app-1' });
      expect(mock.getRequestBody('POST', '/admin-api/tee/attest')).toEqual({
        nonce: 'a'.repeat(64),
        applicationId: 'app-1',
      });
    });

    it('teeVerifyQuote sends correct fields', async () => {
      const quote = { header: {}, body: {}, signature: 'sig', attestationKey: 'ak', certificationData: {} };
      mock.setMockResponse('POST', '/admin-api/tee/verify-quote', {
        data: { quoteVerified: true, nonceVerified: true, applicationHashVerified: true, quote },
      });
      const result = await client.teeVerifyQuote({
        quoteB64: 'base64...',
        nonce: 'a'.repeat(64),
        expectedApplicationHash: 'b'.repeat(64),
      });
      expect(result.quoteVerified).toBe(true);
      expect(result.nonceVerified).toBe(true);
      expect(result.applicationHashVerified).toBe(true);
    });
  });

  describe('Network', () => {
    it('getPeersCount returns flat response', async () => {
      mock.setMockResponse('GET', '/admin-api/peers', { count: 3 });
      const result = await client.getPeersCount();
      expect(result).toEqual({ count: 3 });
    });
  });
});
