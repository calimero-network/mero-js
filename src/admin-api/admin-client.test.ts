import { describe, it, expect, beforeEach } from 'vitest';
import { AdminApiClient } from './admin-client';
import { HttpClient } from '../http-client';

// Mock HttpClient that stores expected responses by "METHOD /path"
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
  });

  describe('Context Management', () => {
    it('createContext unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/contexts', { data: { contextId: 'ctx-1', memberPublicKey: 'key-1' } });
      const result = await client.createContext({ applicationId: 'app-1' });
      expect(result).toEqual({ contextId: 'ctx-1', memberPublicKey: 'key-1' });
    });

    it('deleteContext unwraps data', async () => {
      mock.setMockResponse('DELETE', '/admin-api/contexts/ctx-1', { data: { isDeleted: true } });
      const result = await client.deleteContext('ctx-1');
      expect(result).toEqual({ isDeleted: true });
    });

    it('getContexts unwraps data', async () => {
      const ctx = { id: 'ctx-1', applicationId: 'app-1', rootHash: 'abc', dagHeads: [] };
      mock.setMockResponse('GET', '/admin-api/contexts', { data: { contexts: [ctx] } });
      const result = await client.getContexts();
      expect(result.contexts).toHaveLength(1);
      expect(result.contexts[0].id).toBe('ctx-1');
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

  describe('Context Invite / Join', () => {
    it('inviteToContext returns typed SignedOpenInvitation', async () => {
      const invitation = {
        invitation: { inviter_identity: 'id-1', context_id: 'ctx-1', expiration_timestamp: 123, secret_salt: [0] },
        inviter_signature: 'sig-1',
      };
      mock.setMockResponse('POST', '/admin-api/contexts/invite', { data: invitation });
      const result = await client.inviteToContext({ contextId: 'ctx-1', inviterId: 'id-1', validForSeconds: 3600 });
      expect(result).toEqual(invitation);
    });

    it('inviteToContext returns null when no invitation', async () => {
      mock.setMockResponse('POST', '/admin-api/contexts/invite', { data: null });
      const result = await client.inviteToContext({ contextId: 'ctx-1', inviterId: 'id-1', validForSeconds: 3600 });
      expect(result).toBeNull();
    });

    it('joinContext unwraps data', async () => {
      const invitation = {
        invitation: { inviter_identity: 'id-1', context_id: 'ctx-1', expiration_timestamp: 123, secret_salt: [0] },
        inviter_signature: 'sig-1',
      };
      mock.setMockResponse('POST', '/admin-api/contexts/join', { data: { contextId: 'ctx-1', memberPublicKey: 'pk-1' } });
      const result = await client.joinContext({ invitation, newMemberPublicKey: 'pk-1' });
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

    it('getContextStorageSize unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/contexts/ctx-1/storage', { data: { sizeInBytes: 1024 } });
      const result = await client.getContextStorageSize('ctx-1');
      expect(result).toEqual({ sizeInBytes: 1024 });
    });

    it('syncContext posts to correct path', async () => {
      mock.setMockResponse('POST', '/admin-api/contexts/sync/ctx-1', { data: null });
      await client.syncContext('ctx-1');
      expect(mock.getRequestBody('POST', '/admin-api/contexts/sync/ctx-1')).toEqual({});
    });

    it('syncAllContexts posts to correct path', async () => {
      mock.setMockResponse('POST', '/admin-api/contexts/sync', { data: null });
      await client.syncAllContexts();
      expect(mock.getRequestBody('POST', '/admin-api/contexts/sync')).toEqual({});
    });
  });

  describe('Blob Management', () => {
    it('uploadBlob uses PUT and unwraps data', async () => {
      mock.setMockResponse('PUT', '/admin-api/blobs', { data: { hash: 'abc123' } });
      const result = await client.uploadBlob({ data: new Uint8Array([1, 2, 3]) });
      expect(result).toEqual({ hash: 'abc123' });
    });

    it('deleteBlob unwraps data', async () => {
      mock.setMockResponse('DELETE', '/admin-api/blobs/blob-1', { data: { success: true } });
      const result = await client.deleteBlob('blob-1');
      expect(result).toEqual({ success: true });
    });

    it('listBlobs unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/blobs', { data: [] });
      const result = await client.listBlobs();
      expect(result).toEqual([]);
    });
  });

  describe('Alias Management', () => {
    it('createContextAlias posts to correct path', async () => {
      mock.setMockResponse('POST', '/admin-api/alias/create/context', { ok: true });
      const result = await client.createContextAlias({ name: 'my-ctx', value: 'ctx-1' });
      expect(result).toEqual({ ok: true });
    });

    it('lookupContextAlias posts to correct path', async () => {
      mock.setMockResponse('POST', '/admin-api/alias/lookup/context/my-ctx', { value: 'ctx-1' });
      const result = await client.lookupContextAlias('my-ctx');
      expect(result).toEqual({ value: 'ctx-1' });
    });

    it('listContextAliases unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/alias/list/context', { data: { aliases: [] } });
      const result = await client.listContextAliases();
      expect(result).toEqual({ aliases: [] });
    });

    it('deleteContextAlias posts to correct path', async () => {
      mock.setMockResponse('POST', '/admin-api/alias/delete/context/my-ctx', { ok: true });
      const result = await client.deleteContextAlias('my-ctx');
      expect(result).toEqual({ ok: true });
    });
  });

  describe('Network', () => {
    it('getPeersCount returns flat response', async () => {
      mock.setMockResponse('GET', '/admin-api/peers', { count: 3 });
      const result = await client.getPeersCount();
      expect(result).toEqual({ count: 3 });
    });
  });

  describe('Group Management', () => {
    it('listGroups unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/groups', {
        data: [{ groupId: 'group-1', appKey: 'app-key-1', targetApplicationId: 'app-1', upgradePolicy: 'manual', createdAt: 123 }],
      });
      const result = await client.listGroups();
      expect(result).toEqual([
        {
          groupId: 'group-1',
          appKey: 'app-key-1',
          targetApplicationId: 'app-1',
          upgradePolicy: 'manual',
          createdAt: 123,
        },
      ]);
    });

    it('createGroup posts to correct path and unwraps data', async () => {
      const request = { applicationId: 'app-1', upgradePolicy: 'manual', alias: 'Lobby' };
      mock.setMockResponse('POST', '/admin-api/groups', { data: { groupId: 'group-1' } });
      const result = await client.createGroup(request);
      expect(result).toEqual({ groupId: 'group-1' });
      expect(mock.getRequestBody('POST', '/admin-api/groups')).toEqual(request);
    });

    it('getGroupInfo unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/group-1', {
        data: {
          groupId: 'group-1',
          appKey: 'app-key-1',
          targetApplicationId: 'app-1',
          upgradePolicy: 'manual',
          memberCount: 2,
          contextCount: 1,
          defaultCapabilities: 7,
          defaultVisibility: 'Members',
        },
      });
      const result = await client.getGroupInfo('group-1');
      expect(result.memberCount).toBe(2);
    });

    it('deleteGroup sends an empty delete body and unwraps data', async () => {
      mock.setMockResponse('DELETE', '/admin-api/groups/group-1', { data: { isDeleted: true } });
      const result = await client.deleteGroup('group-1');
      expect(result).toEqual({ isDeleted: true });
      expect(mock.getRequestBody('DELETE', '/admin-api/groups/group-1')).toEqual({});
    });

    it('listGroupMembers preserves self identity metadata', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/group-1/members', {
        data: [{ identity: 'member-1', role: 'Member' }],
        selfIdentity: 'self-1',
      });
      const result = await client.listGroupMembers('group-1');
      expect(result).toEqual({
        data: [{ identity: 'member-1', role: 'Member' }],
        selfIdentity: 'self-1',
      });
    });

    it('addGroupMembers posts members payload', async () => {
      const request = { members: [{ identity: 'member-1', role: 'Admin' }] };
      mock.setMockResponse('POST', '/admin-api/groups/group-1/members', { data: null });
      const result = await client.addGroupMembers('group-1', request);
      expect(result).toBeNull();
      expect(mock.getRequestBody('POST', '/admin-api/groups/group-1/members')).toEqual(request);
    });

    it('removeGroupMembers posts remove payload', async () => {
      const request = { members: ['member-1'] };
      mock.setMockResponse('POST', '/admin-api/groups/group-1/members/remove', { data: null });
      const result = await client.removeGroupMembers('group-1', request);
      expect(result).toBeNull();
      expect(mock.getRequestBody('POST', '/admin-api/groups/group-1/members/remove')).toEqual(request);
    });

    it('listGroupContexts unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/group-1/contexts', {
        data: [{ contextId: 'ctx-1' }],
      });
      const result = await client.listGroupContexts('group-1');
      expect(result).toEqual([{ contextId: 'ctx-1' }]);
    });

    it('joinGroupContext posts context id and unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/groups/group-1/join-context', {
        data: { contextId: 'ctx-1', memberPublicKey: 'pk-1' },
      });
      const result = await client.joinGroupContext('group-1', 'ctx-1');
      expect(result).toEqual({ contextId: 'ctx-1', memberPublicKey: 'pk-1' });
      expect(mock.getRequestBody('POST', '/admin-api/groups/group-1/join-context')).toEqual({
        contextId: 'ctx-1',
      });
    });

    it('createGroupInvitation posts empty body and unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/groups/group-1/invite', {
        data: {
          invitation: {
            invitation: {
              inviter_identity: new Array(32).fill(0),
              group_id: new Array(32).fill(0),
              expiration_timestamp: 123,
            },
            inviter_signature: 'sig-1',
          },
        },
      });
      const result = await client.createGroupInvitation('group-1');
      expect(result.invitation.inviter_signature).toBe('sig-1');
      expect(mock.getRequestBody('POST', '/admin-api/groups/group-1/invite')).toEqual({});
    });

    it('joinGroup posts invitation payload and unwraps data', async () => {
      const request = {
        invitation: {
          invitation: {
            inviter_identity: new Array(32).fill(0),
            group_id: new Array(32).fill(0),
            expiration_timestamp: 123,
          },
          inviter_signature: 'sig-1',
        },
        groupAlias: 'Lobby',
      };
      mock.setMockResponse('POST', '/admin-api/groups/join', {
        data: { groupId: 'group-1', memberIdentity: 'member-2' },
      });
      const result = await client.joinGroup(request);
      expect(result).toEqual({ groupId: 'group-1', memberIdentity: 'member-2' });
      expect(mock.getRequestBody('POST', '/admin-api/groups/join')).toEqual(request);
    });

    it('setMemberCapabilities puts capabilities payload', async () => {
      mock.setMockResponse('PUT', '/admin-api/groups/group-1/members/member-1/capabilities', {
        data: null,
      });
      const result = await client.setMemberCapabilities('group-1', 'member-1', 7);
      expect(result).toBeNull();
      expect(
        mock.getRequestBody('PUT', '/admin-api/groups/group-1/members/member-1/capabilities'),
      ).toEqual({ capabilities: 7 });
    });

    it('getMemberCapabilities unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/group-1/members/member-1/capabilities', {
        data: { capabilities: 7 },
      });
      const result = await client.getMemberCapabilities('group-1', 'member-1');
      expect(result).toEqual({ capabilities: 7 });
    });
  });

  describe('Group Governance / Settings', () => {
    it('setDefaultCapabilities sends PUT with body', async () => {
      mock.setMockResponse('PUT', '/admin-api/groups/group-1/settings/default-capabilities', { data: null });
      await client.setDefaultCapabilities('group-1', { defaultCapabilities: 3 });
      expect(mock.getRequestBody('PUT', '/admin-api/groups/group-1/settings/default-capabilities')).toEqual({ defaultCapabilities: 3 });
    });

    it('setDefaultVisibility sends PUT with body', async () => {
      mock.setMockResponse('PUT', '/admin-api/groups/group-1/settings/default-visibility', { data: null });
      await client.setDefaultVisibility('group-1', { defaultVisibility: 'open' });
      expect(mock.getRequestBody('PUT', '/admin-api/groups/group-1/settings/default-visibility')).toEqual({ defaultVisibility: 'open' });
    });

    it('getContextVisibility unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/group-1/contexts/ctx-1/visibility', {
        data: { mode: 'open', creator: 'member-1' },
      });
      const result = await client.getContextVisibility('group-1', 'ctx-1');
      expect(result).toEqual({ mode: 'open', creator: 'member-1' });
    });

    it('setContextVisibility sends PUT with body', async () => {
      mock.setMockResponse('PUT', '/admin-api/groups/group-1/contexts/ctx-1/visibility', { data: null });
      await client.setContextVisibility('group-1', 'ctx-1', { mode: 'restricted' });
      expect(mock.getRequestBody('PUT', '/admin-api/groups/group-1/contexts/ctx-1/visibility')).toEqual({ mode: 'restricted' });
    });

    it('getContextAllowlist unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/group-1/contexts/ctx-1/allowlist', {
        data: ['member-1', 'member-2'],
      });
      const result = await client.getContextAllowlist('group-1', 'ctx-1');
      expect(result).toEqual(['member-1', 'member-2']);
    });

    it('updateContextAllowlist sends POST with add/remove', async () => {
      mock.setMockResponse('POST', '/admin-api/groups/group-1/contexts/ctx-1/allowlist', { data: null });
      await client.updateContextAllowlist('group-1', 'ctx-1', { add: ['member-3'], remove: ['member-1'] });
      expect(mock.getRequestBody('POST', '/admin-api/groups/group-1/contexts/ctx-1/allowlist')).toEqual({
        add: ['member-3'],
        remove: ['member-1'],
      });
    });

    it('updateMemberRole sends PUT with role', async () => {
      mock.setMockResponse('PUT', '/admin-api/groups/group-1/members/member-1/role', { data: null });
      await client.updateMemberRole('group-1', 'member-1', { role: 'Admin' });
      expect(mock.getRequestBody('PUT', '/admin-api/groups/group-1/members/member-1/role')).toEqual({ role: 'Admin' });
    });
  });

  describe('Group Upgrade', () => {
    it('upgradeGroup posts request and unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/groups/group-1/upgrade', {
        data: { groupId: 'group-1', status: 'in_progress', total: 3, completed: 0, failed: 0 },
      });
      const result = await client.upgradeGroup('group-1', { targetApplicationId: 'app-2' });
      expect(result.status).toBe('in_progress');
    });

    it('getGroupUpgradeStatus unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/group-1/upgrade/status', {
        data: { groupId: 'group-1', status: 'completed', total: 3, completed: 3, failed: 0 },
      });
      const result = await client.getGroupUpgradeStatus('group-1');
      expect(result?.status).toBe('completed');
    });

    it('getGroupUpgradeStatus returns null when no upgrade', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/group-1/upgrade/status', { data: null });
      const result = await client.getGroupUpgradeStatus('group-1');
      expect(result).toBeNull();
    });

    it('retryGroupUpgrade posts and unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/groups/group-1/upgrade/retry', {
        data: { groupId: 'group-1', status: 'in_progress' },
      });
      const result = await client.retryGroupUpgrade('group-1');
      expect(result.status).toBe('in_progress');
    });
  });

  describe('Group / Member Alias', () => {
    it('setGroupAlias sends PUT with alias', async () => {
      mock.setMockResponse('PUT', '/admin-api/groups/group-1/alias', { data: null });
      await client.setGroupAlias('group-1', { alias: 'My Group' });
      expect(mock.getRequestBody('PUT', '/admin-api/groups/group-1/alias')).toEqual({ alias: 'My Group' });
    });

    it('setMemberAlias sends PUT with alias', async () => {
      mock.setMockResponse('PUT', '/admin-api/groups/group-1/members/member-1/alias', { data: null });
      await client.setMemberAlias('group-1', 'member-1', { alias: 'Alice' });
      expect(mock.getRequestBody('PUT', '/admin-api/groups/group-1/members/member-1/alias')).toEqual({ alias: 'Alice' });
    });
  });

  describe('Group Update / Context Removal', () => {
    it('updateGroup sends PATCH with body', async () => {
      mock.setMockResponse('PATCH', '/admin-api/groups/group-1', { data: null });
      await client.updateGroup('group-1', { upgradePolicy: 'automatic' });
      expect(mock.getRequestBody('PATCH', '/admin-api/groups/group-1')).toEqual({ upgradePolicy: 'automatic' });
    });

    it('removeContextFromGroup posts to correct path', async () => {
      mock.setMockResponse('POST', '/admin-api/groups/group-1/contexts/ctx-1/remove', { data: null });
      await client.removeContextFromGroup('group-1', 'ctx-1');
      expect(mock.getRequestBody('POST', '/admin-api/groups/group-1/contexts/ctx-1/remove')).toEqual({});
    });
  });

  describe('Signing Key', () => {
    it('registerSigningKey posts and unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/groups/group-1/signing-key', {
        data: { publicKey: 'pk-123' },
      });
      const result = await client.registerSigningKey('group-1', { signingKey: 'sk-123' });
      expect(result).toEqual({ publicKey: 'pk-123' });
    });
  });
});
