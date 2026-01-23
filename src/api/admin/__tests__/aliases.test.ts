import { describe, it, expect, beforeEach } from 'vitest';
import { AliasesApiClient } from '../aliases';
import { MockHttpClient } from './mock-http-client';

describe('AliasesApiClient', () => {
  let client: AliasesApiClient;
  let mockHttp: MockHttpClient;

  beforeEach(() => {
    mockHttp = new MockHttpClient();
    client = new AliasesApiClient(mockHttp);
  });

  describe('createContextAlias', () => {
    it('should create context alias', async () => {
      const request = { alias: 'my-context', contextId: 'ctx-1' };

      mockHttp.setMockResponse('POST', '/admin-api/alias/create/context', {
        data: { success: true },
      });

      const result = await client.createContextAlias(request);

      expect(result).toBeDefined();
    });
  });

  describe('lookupContextAlias', () => {
    it('should lookup context alias', async () => {
      mockHttp.setMockResponse('POST', '/admin-api/alias/lookup/context/my-alias', {
        data: { value: 'ctx-1' },
      });

      const result = await client.lookupContextAlias('my-alias');

      expect(result.value).toBe('ctx-1');
    });
  });

  describe('listContextAliases', () => {
    it('should list context aliases', async () => {
      mockHttp.setMockResponse('GET', '/admin-api/alias/list/context', {
        data: { 'alias1': 'ctx-1', 'alias2': 'ctx-2' },
      });

      const result = await client.listContextAliases();

      expect(result['alias1']).toBe('ctx-1');
    });
  });

  describe('deleteContextAlias', () => {
    it('should delete context alias', async () => {
      mockHttp.setMockResponse(
        'POST',
        '/admin-api/alias/delete/context/my-alias',
        {
          data: { success: true },
        },
      );

      const result = await client.deleteContextAlias('my-alias');

      expect(result).toBeDefined();
    });
  });

  describe('createApplicationAlias', () => {
    it('should create application alias', async () => {
      const request = { alias: 'my-app', applicationId: 'app-1' };

      mockHttp.setMockResponse(
        'POST',
        '/admin-api/alias/create/application',
        {
          data: { success: true },
        },
      );

      const result = await client.createApplicationAlias(request);

      expect(result).toBeDefined();
    });
  });

  describe('createIdentityAlias', () => {
    it('should create identity alias', async () => {
      const request = { alias: 'my-identity', identity: 'identity-1' };

      mockHttp.setMockResponse(
        'POST',
        '/admin-api/alias/create/identity/ctx-1',
        {
          data: { success: true },
        },
      );

      const result = await client.createIdentityAlias('ctx-1', request);

      expect(result).toBeDefined();
    });
  });

  describe('lookupApplicationAlias', () => {
    it('should lookup application alias', async () => {
      mockHttp.setMockResponse(
        'POST',
        '/admin-api/alias/lookup/application/my-app',
        {
          data: { value: 'app-1' },
        },
      );

      const result = await client.lookupApplicationAlias('my-app');

      expect(result.value).toBe('app-1');
    });

    it('should handle null lookup result', async () => {
      mockHttp.setMockResponse(
        'POST',
        '/admin-api/alias/lookup/application/nonexistent',
        {
          data: { value: null },
        },
      );

      const result = await client.lookupApplicationAlias('nonexistent');

      expect(result.value).toBeNull();
    });
  });

  describe('lookupIdentityAlias', () => {
    it('should lookup identity alias', async () => {
      mockHttp.setMockResponse(
        'POST',
        '/admin-api/alias/lookup/identity/ctx-1/my-identity',
        {
          data: { value: 'identity-1' },
        },
      );

      const result = await client.lookupIdentityAlias('ctx-1', 'my-identity');

      expect(result.value).toBe('identity-1');
    });
  });

  describe('listApplicationAliases', () => {
    it('should list application aliases', async () => {
      mockHttp.setMockResponse(
        'GET',
        '/admin-api/alias/list/application',
        {
          data: { 'alias1': 'app-1', 'alias2': 'app-2' },
        },
      );

      const result = await client.listApplicationAliases();

      expect(result['alias1']).toBe('app-1');
      expect(result['alias2']).toBe('app-2');
    });
  });

  describe('listIdentityAliases', () => {
    it('should list identity aliases', async () => {
      mockHttp.setMockResponse(
        'GET',
        '/admin-api/alias/list/identity/ctx-1',
        {
          data: { 'alias1': 'id-1', 'alias2': 'id-2' },
        },
      );

      const result = await client.listIdentityAliases('ctx-1');

      expect(result['alias1']).toBe('id-1');
    });
  });

  describe('deleteApplicationAlias', () => {
    it('should delete application alias', async () => {
      mockHttp.setMockResponse(
        'POST',
        '/admin-api/alias/delete/application/my-app',
        {
          data: { success: true },
        },
      );

      const result = await client.deleteApplicationAlias('my-app');

      expect(result).toBeDefined();
    });
  });

  describe('deleteIdentityAlias', () => {
    it('should delete identity alias', async () => {
      mockHttp.setMockResponse(
        'POST',
        '/admin-api/alias/delete/identity/ctx-1/my-identity',
        {
          data: { success: true },
        },
      );

      const result = await client.deleteIdentityAlias('ctx-1', 'my-identity');

      expect(result).toBeDefined();
    });
  });
});
