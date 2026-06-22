import { describe, it, expect, beforeEach } from 'vitest';
import { AdminApiClient, compareSemver } from './admin-client';
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
    // .has(...) rather than truthiness so an explicitly-mocked `null` body
    // (the "no metadata record" wire shape) is "set to null", not
    // "never registered".
    if (!this.mockResponses.has(key)) {
      throw new Error(`No mock response for ${key}`);
    }
    return this.mockResponses.get(key);
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

    it('installFromRegistry resolves the artifact URL and installs', async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        // Manifest is fetched by the CALLER's package@version...
        expect(String(input)).toBe(
          'https://registry.example.com/api/v2/bundles/com.acme.app/2.0.0',
        );
        // ...but resolves to the registry's canonical appVersion (here it
        // differs from the arg, so the asserts below prove the manifest value
        // — not the caller's arg — builds the artifact URL + install request).
        return {
          ok: true,
          status: 200,
          json: async () => ({ package: 'com.acme.app', appVersion: '2.0.1' }),
        } as Response;
      }) as typeof fetch;
      try {
        mock.setMockResponse('POST', '/admin-api/install-application', {
          data: { applicationId: 'app-9' },
        });
        const result = await client.installFromRegistry(
          'https://registry.example.com',
          'com.acme.app',
          '2.0.0',
        );
        expect(result.applicationId).toBe('app-9');
        const body = mock.getRequestBody('POST', '/admin-api/install-application') as {
          url: string;
          package?: string;
          version?: string;
        };
        expect(body.url).toBe(
          'https://registry.example.com/artifacts/com.acme.app/2.0.1/com.acme.app-2.0.1.mpk',
        );
        expect(body.package).toBe('com.acme.app');
        expect(body.version).toBe('2.0.1');
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('installFromRegistry throws on a registry error', async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = (async () =>
        ({ ok: false, status: 404, json: async () => ({}) }) as Response) as typeof fetch;
      try {
        await expect(
          client.installFromRegistry('https://registry.example.com', 'missing', '9.9.9'),
        ).rejects.toThrow(/registry manifest fetch failed \(404\)/);
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('getRegistryVersions returns versions newest-first by semver', async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        expect(String(input)).toBe(
          'https://registry.example.com/api/v2/bundles?package=com.acme.app',
        );
        return {
          ok: true,
          status: 200,
          json: async () => [
            { package: 'com.acme.app', appVersion: '1.9.0' },
            { package: 'com.acme.app', appVersion: '1.10.0' },
            { package: 'com.acme.app', appVersion: '1.2.0' },
          ],
        } as Response;
      }) as typeof fetch;
      try {
        const versions = await client.getRegistryVersions(
          'https://registry.example.com',
          'com.acme.app',
        );
        // 1.10.0 must sort ABOVE 1.9.0 — numeric, not lexical.
        expect(versions).toEqual(['1.10.0', '1.9.0', '1.2.0']);
      } finally {
        globalThis.fetch = origFetch;
      }
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

    it('listApplicationVersions unwraps the installed-blob inventory', async () => {
      const entries = [
        { version: '1.0.0', blobId: 'blob-1', size: 100, package: 'pkg-a' },
        { version: '2.0.0', blobId: 'blob-2', size: 200, package: 'pkg-a' },
      ];
      mock.setMockResponse('GET', '/admin-api/applications/app-1/versions', { data: entries });
      const result = await client.listApplicationVersions('app-1');
      expect(result).toEqual(entries);
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

    it('getContexts returns contexts with groupId and contextStateHash', async () => {
      const ctx = { id: 'ctx-1', applicationId: 'app-1', contextStateHash: 'abc', dagHeads: [], groupId: 'g-1' };
      mock.setMockResponse('GET', '/admin-api/contexts', { data: { contexts: [ctx] } });
      const result = await client.getContexts();
      expect(result.contexts).toHaveLength(1);
      expect(result.contexts[0].id).toBe('ctx-1');
      expect(result.contexts[0].groupId).toBe('g-1');
      expect(result.contexts[0].contextStateHash).toBe('abc');
    });

    it('getContext unwraps data and exposes contextStateHash (core wire key)', async () => {
      const ctx = { id: 'ctx-1', applicationId: 'app-1', contextStateHash: 'abc', dagHeads: [] };
      mock.setMockResponse('GET', '/admin-api/contexts/ctx-1', { data: ctx });
      const result = await client.getContext('ctx-1');
      expect(result.id).toBe('ctx-1');
      expect(result.contextStateHash).toBe('abc');
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

    it('resyncContext posts force and parses the flat (un-enveloped) payload', async () => {
      // Core's ResyncContextApiResponse is flat — no `data` envelope.
      mock.setMockResponse('POST', '/admin-api/contexts/ctx-1/resync', {
        contextId: 'ctx-1',
        resyncStarted: true,
      });
      const result = await client.resyncContext('ctx-1', { force: true });
      expect(result).toEqual({ contextId: 'ctx-1', resyncStarted: true });
      expect(mock.getRequestBody('POST', '/admin-api/contexts/ctx-1/resync')).toEqual({ force: true });
    });

    it('resyncContext defaults to an empty request body', async () => {
      mock.setMockResponse('POST', '/admin-api/contexts/ctx-1/resync', {
        contextId: 'ctx-1',
        resyncStarted: false,
      });
      const result = await client.resyncContext('ctx-1');
      expect(result.resyncStarted).toBe(false);
      expect(mock.getRequestBody('POST', '/admin-api/contexts/ctx-1/resync')).toEqual({});
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
      });
      expect(mock.getRequestBody('POST', '/admin-api/contexts/ctx-1/application')).toEqual({
        applicationId: 'app-2',
        executorPublicKey: 'pk-1',
      });
    });
  });

  describe('Blob Management', () => {
    it('uploadBlob streams raw bytes with snake_case query params and maps blob_id', async () => {
      mock.setMockResponse('PUT', '/admin-api/blobs?hash=h1&context_id=ctx-1', {
        data: { blob_id: 'blob-1', size: 3 },
      });
      const result = await client.uploadBlob({ data: new Uint8Array([1, 2, 3]), hash: 'h1', contextId: 'ctx-1' });
      expect(result).toEqual({ blobId: 'blob-1', size: 3 });
      // body must be the RAW bytes, not a JSON wrapper like {"data":{"0":1,...}}
      const body = mock.getRequestBody('PUT', '/admin-api/blobs?hash=h1&context_id=ctx-1');
      expect(Array.from(new Uint8Array(body as ArrayBuffer))).toEqual([1, 2, 3]);
    });

    it('uploadBlob omits the query string when no hash/contextId given', async () => {
      mock.setMockResponse('PUT', '/admin-api/blobs', { data: { blob_id: 'blob-2', size: 1 } });
      const result = await client.uploadBlob({ data: new Uint8Array([9]) });
      expect(result).toEqual({ blobId: 'blob-2', size: 1 });
    });

    it('deleteBlob parses the flat snake_case payload and maps to camelCase', async () => {
      // Core's BlobDeleteResponse is flat AND snake_case (`{ blob_id, deleted }`).
      mock.setMockResponse('DELETE', '/admin-api/blobs/blob-1', { blob_id: 'blob-1', deleted: true });
      const result = await client.deleteBlob('blob-1');
      expect(result).toEqual({ blobId: 'blob-1', deleted: true });
    });

    it('listBlobs maps snake_case blob_id to blobId', async () => {
      mock.setMockResponse('GET', '/admin-api/blobs', { data: { blobs: [{ blob_id: 'blob-1', size: 100 }] } });
      const result = await client.listBlobs();
      expect(result).toEqual({ blobs: [{ blobId: 'blob-1', size: 100 }] });
    });

    it('getBlob maps snake_case blob_id to blobId', async () => {
      mock.setMockResponse('GET', '/admin-api/blobs/blob-1', { data: { blob_id: 'blob-1', size: 100 } });
      const result = await client.getBlob('blob-1');
      expect(result).toEqual({ blobId: 'blob-1', size: 100 });
    });
  });

  describe('Alias Management', () => {
    it('createContextAlias sends { alias, contextId }', async () => {
      mock.setMockResponse('POST', '/admin-api/alias/create/context', { data: {} });
      const result = await client.createContextAlias({ alias: 'my-ctx', contextId: 'ctx-1' });
      expect(result).toEqual({});
      expect(mock.getRequestBody('POST', '/admin-api/alias/create/context')).toEqual({
        alias: 'my-ctx',
        contextId: 'ctx-1',
      });
    });

    it('createApplicationAlias sends { alias, applicationId }', async () => {
      mock.setMockResponse('POST', '/admin-api/alias/create/application', { data: {} });
      const result = await client.createApplicationAlias({ alias: 'my-app', applicationId: 'app-1' });
      expect(result).toEqual({});
      expect(mock.getRequestBody('POST', '/admin-api/alias/create/application')).toEqual({
        alias: 'my-app',
        applicationId: 'app-1',
      });
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

    it('createContextIdentityAlias sends { alias, identity } with context in the path', async () => {
      mock.setMockResponse('POST', '/admin-api/alias/create/identity/ctx-1', { data: {} });
      const result = await client.createContextIdentityAlias('ctx-1', { alias: 'alice', identity: 'pk-1' });
      expect(result).toEqual({});
      expect(mock.getRequestBody('POST', '/admin-api/alias/create/identity/ctx-1')).toEqual({
        alias: 'alice',
        identity: 'pk-1',
      });
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
      const result = await client.createNamespace({ applicationId: 'app-1', upgradePolicy: 'manual', name: 'My NS' });
      expect(result).toEqual({ namespaceId: 'ns-1' });
      expect(mock.getRequestBody('POST', '/admin-api/namespaces')).toEqual({
        applicationId: 'app-1',
        upgradePolicy: 'manual',
        name: 'My NS',
      });
    });

    it('createNamespace forwards the appKey version pin', async () => {
      mock.setMockResponse('POST', '/admin-api/namespaces', { data: { namespaceId: 'ns-1' } });
      await client.createNamespace({ applicationId: 'app-1', upgradePolicy: 'manual', appKey: 'deadbeef' });
      expect(mock.getRequestBody('POST', '/admin-api/namespaces')).toEqual({
        applicationId: 'app-1',
        upgradePolicy: 'manual',
        appKey: 'deadbeef',
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
      mock.setMockResponse('POST', '/admin-api/namespaces/ns-1/invite', { data: { invitation, groupName: 'NS' } });
      const result = await client.createNamespaceInvitation('ns-1', { expirationTimestamp: 999 });
      expect(result).toEqual({ invitation, groupName: 'NS' });
    });

    it('joinNamespace sends structured invitation', async () => {
      const invitation = {
        invitation: { inviterIdentity: [1], groupId: [2], expirationTimestamp: 999, secretSalt: [3] },
        inviterSignature: 'sig-1',
      };
      mock.setMockResponse('POST', '/admin-api/namespaces/ns-1/join', {
        data: { groupId: 'g-1', memberIdentity: 'pk-1', governanceOp: 'op-hex' },
      });
      const result = await client.joinNamespace('ns-1', { invitation, groupName: 'My NS' });
      expect(result).toEqual({ groupId: 'g-1', memberIdentity: 'pk-1', governanceOp: 'op-hex' });
      expect(mock.getRequestBody('POST', '/admin-api/namespaces/ns-1/join')).toEqual({ invitation, groupName: 'My NS' });
    });

    it('createGroupInNamespace sends request', async () => {
      mock.setMockResponse('POST', '/admin-api/namespaces/ns-1/groups', { data: { groupId: 'g-1' } });
      const result = await client.createGroupInNamespace('ns-1', { name: 'Sub' });
      expect(result).toEqual({ groupId: 'g-1' });
    });

    it('listNamespaceGroups unwraps data', async () => {
      mock.setMockResponse('GET', '/admin-api/namespaces/ns-1/groups', { data: [{ groupId: 'g-1', name: 'Sub' }] });
      const result = await client.listNamespaceGroups('ns-1');
      expect(result).toEqual([{ groupId: 'g-1', name: 'Sub' }]);
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
        metadata: null,
        activeUpgrade: null,
      };
      mock.setMockResponse('GET', '/admin-api/groups/g-1', { data: info });
      const result = await client.getGroupInfo('g-1');
      expect(result.memberCount).toBe(3);
      expect(result.defaultCapabilities).toBe(7);
      expect(result.subgroupVisibility).toBe('open');
    });

    it('getDefaultCapabilities returns the bitmask from getGroupInfo', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/g-1', {
        data: {
          groupId: 'g-1',
          appKey: 'key',
          targetApplicationId: 'app-1',
          upgradePolicy: 'manual',
          memberCount: 1,
          contextCount: 0,
          defaultCapabilities: 37,
          subgroupVisibility: 'open',
        },
      });
      expect(await client.getDefaultCapabilities('g-1')).toBe(37);
    });

    it('getSubgroupVisibility returns the value from getGroupInfo', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/g-1', {
        data: {
          groupId: 'g-1',
          appKey: 'key',
          targetApplicationId: 'app-1',
          upgradePolicy: 'manual',
          memberCount: 1,
          contextCount: 0,
          defaultCapabilities: 0,
          subgroupVisibility: 'open',
        },
      });
      expect(await client.getSubgroupVisibility('g-1')).toBe('open');
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

    it('listGroupMembers rejects with an explicit error when the response omits members', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/g-1/members', {
        selfIdentity: 'self-1',
      });
      await expect(client.listGroupMembers('g-1')).rejects.toThrow(
        /missing or non-array `members` field/,
      );
    });

    it('listGroupMembers accepts an empty group', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/g-1/members', {
        members: [],
        selfIdentity: 'self-1',
      });
      const result = await client.listGroupMembers('g-1');
      expect(result.members).toEqual([]);
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
  });

  describe('Group / member / context metadata', () => {
    const record = { name: 'Reports', data: { color: '#f80' }, updatedAt: 123, updatedBy: 'abc' };

    it('setGroupMetadata sends PUT with the request body', async () => {
      mock.setMockResponse('PUT', '/admin-api/groups/g1/metadata', {});
      await client.setGroupMetadata('g1', { name: 'Reports', data: { color: '#f80' } });
      expect(mock.getRequestBody('PUT', '/admin-api/groups/g1/metadata')).toEqual({
        name: 'Reports',
        data: { color: '#f80' },
      });
    });

    it('getGroupMetadata returns the inner MetadataRecord', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/g1/metadata', { data: { data: record } });
      expect(await client.getGroupMetadata('g1')).toEqual(record);
    });

    it('getGroupMetadata returns null when no metadata has been set', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/g1/metadata', { data: { data: null } });
      expect(await client.getGroupMetadata('g1')).toBeNull();
    });

    // Server omits the inner envelope entirely (`{ data: null }`) when no
    // metadata row exists — the unwrapped payload is then null, so reading
    // `.data` off it used to throw "Cannot read properties of null".
    it('getGroupMetadata returns null (not throws) when the payload itself is null', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/g1/metadata', { data: null });
      expect(await client.getGroupMetadata('g1')).toBeNull();
    });

    // Third observed "no record" shape: a bare `null` body, no envelope at all.
    it('getGroupMetadata returns null (not throws) when the body is bare null', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/g1/metadata', null);
      expect(await client.getGroupMetadata('g1')).toBeNull();
    });

    it('setMemberMetadata sends PUT to the member path', async () => {
      mock.setMockResponse('PUT', '/admin-api/groups/g1/members/pk-1/metadata', {});
      await client.setMemberMetadata('g1', 'pk-1', { name: 'Alice' });
      expect(mock.getRequestBody('PUT', '/admin-api/groups/g1/members/pk-1/metadata')).toEqual({ name: 'Alice' });
    });

    it('getMemberMetadata returns the inner MetadataRecord', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/g1/members/pk-1/metadata', { data: { data: record } });
      expect(await client.getMemberMetadata('g1', 'pk-1')).toEqual(record);
    });

    // The display-name lookup that surfaced the crash: a member with no name
    // set yields `{ data: null }`, which must read back as null, not throw.
    it('getMemberMetadata returns null (not throws) when the payload itself is null', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/g1/members/pk-1/metadata', { data: null });
      expect(await client.getMemberMetadata('g1', 'pk-1')).toBeNull();
    });

    it('getMemberMetadata returns null (not throws) when the body is bare null', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/g1/members/pk-1/metadata', null);
      expect(await client.getMemberMetadata('g1', 'pk-1')).toBeNull();
    });

    it('setContextMetadata sends PUT to the context path', async () => {
      mock.setMockResponse('PUT', '/admin-api/groups/g1/contexts/ctx-1/metadata', {});
      await client.setContextMetadata('g1', 'ctx-1', { data: { region: 'eu' } });
      expect(mock.getRequestBody('PUT', '/admin-api/groups/g1/contexts/ctx-1/metadata')).toEqual({
        data: { region: 'eu' },
      });
    });

    it('getContextMetadata returns the inner MetadataRecord', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/g1/contexts/ctx-1/metadata', { data: { data: record } });
      expect(await client.getContextMetadata('g1', 'ctx-1')).toEqual(record);
    });

    it('getContextMetadata returns null (not throws) when the payload itself is null', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/g1/contexts/ctx-1/metadata', { data: null });
      expect(await client.getContextMetadata('g1', 'ctx-1')).toBeNull();
    });

    it('getContextMetadata returns null (not throws) when the body is bare null', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/g1/contexts/ctx-1/metadata', null);
      expect(await client.getContextMetadata('g1', 'ctx-1')).toBeNull();
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
    it('upgradeGroup sends request and unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/groups/g-1/upgrade', {
        data: { groupId: 'g-1', status: 'in_progress', total: 3, completed: 0, failed: 0 },
      });
      const result = await client.upgradeGroup('g-1', {
        targetApplicationId: 'app-2',
      });
      expect(result.status).toBe('in_progress');
      expect(mock.getRequestBody('POST', '/admin-api/groups/g-1/upgrade')).toEqual({
        targetApplicationId: 'app-2',
      });
    });

    it('upgradeGroup forwards cascade so the upgrade fans out to subgroups', async () => {
      mock.setMockResponse('POST', '/admin-api/groups/g-1/upgrade', {
        data: { groupId: 'g-1', status: 'in_progress', total: 3, completed: 0, failed: 0 },
      });
      await client.upgradeGroup('g-1', {
        targetApplicationId: 'app-2',
        cascade: true,
      });
      expect(mock.getRequestBody('POST', '/admin-api/groups/g-1/upgrade')).toEqual({
        targetApplicationId: 'app-2',
        cascade: true,
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

  describe('Migration status', () => {
    it('getMigrationStatus reads the top-level rollup (no data envelope)', async () => {
      const body = {
        targetVersion: 2,
        expectedMembers: 3,
        rollup: {
          migrated: 2,
          inProgress: 0,
          unknown: 1,
          total: 3,
          allMigrated: false,
          membersPendingSignature: 1,
        },
        members: [
          {
            peer: 'aa',
            report: {
              schemaVersion: 2,
              residueAuto: 0,
              residueIdentity: 0,
              syncedUpToHlc: 0,
              reportedAt: 0,
              authoredRemaining: 0,
            },
            state: 'migrated',
          },
          {
            peer: 'bb',
            report: {
              schemaVersion: 1,
              residueAuto: 0,
              residueIdentity: 0,
              syncedUpToHlc: 0,
              reportedAt: 0,
              authoredRemaining: 2,
            },
            state: 'in_progress',
          },
          { peer: 'cc', report: null, state: 'unknown' },
        ],
      };
      mock.setMockResponse('GET', '/admin-api/groups/ns1/migration-status', body);
      const res = await client.getMigrationStatus('ns1');
      expect(res.rollup.membersPendingSignature).toBe(1);
      expect(res.members[1].report?.authoredRemaining).toBe(2);
      expect(res.members[2].report).toBeNull();
    });

    it('getCascadeStatus unwraps the data array', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/ns1/cascade-status', {
        data: [
          {
            groupId: 'g1',
            upgrade: {
              fromVersion: '1.0.0',
              toVersion: '2.0.0',
              initiatedAt: 1,
              initiatedBy: 'x',
              status: 'completed',
            },
            cascadeHlc: 'h1',
          },
        ],
      });
      const res = await client.getCascadeStatus('ns1');
      expect(res).toHaveLength(1);
      expect(res[0].cascadeHlc).toBe('h1');
      expect(res[0].upgrade.toVersion).toBe('2.0.0');
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

    it('listSubgroups reads the `subgroups` field (current server shape)', async () => {
      // merod returns `{ subgroups: [...] }` for this endpoint
      // (see ListSubgroupsApiResponse in core/crates/server/primitives/src/admin/mod.rs).
      mock.setMockResponse('GET', '/admin-api/groups/g-1/subgroups', { subgroups: [{ groupId: 'sub-1', name: 'Sub' }] });
      const result = await client.listSubgroups('g-1');
      expect(result).toEqual([{ groupId: 'sub-1', name: 'Sub' }]);
    });

    it('listSubgroups falls back to `data` if the server normalizes the wrapper', async () => {
      // Forward-compat: if core ever standardizes this endpoint to the common
      // `{ data: [...] }` wrapper used by the rest of the admin API, the SDK
      // keeps working without a coordinated release.
      mock.setMockResponse('GET', '/admin-api/groups/g-1/subgroups', { data: [{ groupId: 'sub-1', name: 'Sub' }] });
      const result = await client.listSubgroups('g-1');
      expect(result).toEqual([{ groupId: 'sub-1', name: 'Sub' }]);
    });

    it('listSubgroups returns [] when neither wrapper field is present', async () => {
      mock.setMockResponse('GET', '/admin-api/groups/g-1/subgroups', {});
      const result = await client.listSubgroups('g-1');
      expect(result).toEqual([]);
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
        data: { invitation: mockInvitation, groupName: 'Lobby' },
      });
      const result = await client.createGroupInvitation('g-1', { expirationTimestamp: 999 });
      expect(result).toEqual({ invitation: mockInvitation, groupName: 'Lobby' });
    });

    it('createGroupInvitation with recursive returns list', async () => {
      mock.setMockResponse('POST', '/admin-api/groups/g-1/invite', {
        data: { invitations: [{ groupId: 'g-1', invitation: mockInvitation, groupName: 'Lobby' }] },
      });
      const result = await client.createGroupInvitation('g-1', { recursive: true });
      expect('invitations' in result).toBe(true);
    });

    it('joinGroup sends invitation and unwraps response', async () => {
      mock.setMockResponse('POST', '/admin-api/groups/join', {
        data: { groupId: 'g-1', memberIdentity: 'pk-1', governanceOp: 'op-hex' },
      });
      const result = await client.joinGroup({ invitation: mockInvitation, groupName: 'Lobby' });
      expect(result).toEqual({ groupId: 'g-1', memberIdentity: 'pk-1', governanceOp: 'op-hex' });
      expect(mock.getRequestBody('POST', '/admin-api/groups/join')).toEqual({
        invitation: mockInvitation,
        groupName: 'Lobby',
      });
    });

    it('joinSubgroupInheritance posts to groups/:id/join-via-inheritance and unwraps data', async () => {
      mock.setMockResponse('POST', '/admin-api/groups/g-1/join-via-inheritance', {
        data: { groupId: 'g-1', memberPublicKey: 'pk-1', wasInherited: true },
      });
      const result = await client.joinSubgroupInheritance('g-1');
      expect(result).toEqual({ groupId: 'g-1', memberPublicKey: 'pk-1', wasInherited: true });
      expect(mock.getRequestBody('POST', '/admin-api/groups/g-1/join-via-inheritance')).toEqual({});
    });

    it('joinSubgroupInheritance returns wasInherited=false on direct-member no-op', async () => {
      mock.setMockResponse('POST', '/admin-api/groups/g-2/join-via-inheritance', {
        data: { groupId: 'g-2', memberPublicKey: 'pk-2', wasInherited: false },
      });
      const result = await client.joinSubgroupInheritance('g-2');
      expect(result.wasInherited).toBe(false);
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

describe('compareSemver', () => {
  it('orders numerically, not lexically', () => {
    expect(compareSemver('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareSemver('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareSemver('1.9.0', '1.10.0')).toBeLessThan(0);
  });

  it('treats equal and zero-padded versions as equal', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('1.2', '1.2.0')).toBe(0);
  });
});
