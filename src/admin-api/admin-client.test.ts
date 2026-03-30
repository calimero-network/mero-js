import { describe, it, expect, beforeEach } from 'vitest';
import { AdminApiClient } from './admin-client';
import { HttpClient } from '../http-client';

// Mock HttpClient that stores expected responses by "METHOD /path"
class MockHttpClient implements HttpClient {
  private mockResponses = new Map<string, unknown>();

  setMockResponse(method: string, path: string, response: unknown) {
    this.mockResponses.set(`${method} ${path}`, response);
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
  async post<T>(path: string, _body?: unknown): Promise<T> { return this.getResponse('POST', path) as T; }
  async put<T>(path: string, _body?: unknown): Promise<T> { return this.getResponse('PUT', path) as T; }
  async delete<T>(path: string): Promise<T> { return this.getResponse('DELETE', path) as T; }
  async patch<T>(path: string, _body?: unknown): Promise<T> { return this.getResponse('PATCH', path) as T; }
  async head(_path: string): Promise<{ headers: Record<string, string>; status: number }> {
    return { headers: {}, status: 200 };
  }
  async request<T>(): Promise<T> { throw new Error('Not implemented'); }
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
    it('inviteToContext unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/contexts/invite', { data: { invitation: 'xyz' } });
      const result = await client.inviteToContext({ contextId: 'ctx-1', inviterId: 'id-1', validForSeconds: 3600 });
      expect(result).toEqual({ invitation: 'xyz' });
    });

    it('joinContext unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/contexts/join', { data: { contextId: 'ctx-1', memberPublicKey: 'pk-1' } });
      const result = await client.joinContext({ invitation: {}, newMemberPublicKey: 'pk-1' });
      expect(result).toEqual({ contextId: 'ctx-1', memberPublicKey: 'pk-1' });
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
});
