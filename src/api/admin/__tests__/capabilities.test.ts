import { describe, it, expect, beforeEach } from 'vitest';
import { CapabilitiesApiClient } from '../capabilities';
import { MockHttpClient } from './mock-http-client';

describe('CapabilitiesApiClient', () => {
  let client: CapabilitiesApiClient;
  let mockHttp: MockHttpClient;

  beforeEach(() => {
    mockHttp = new MockHttpClient();
    client = new CapabilitiesApiClient(mockHttp);
  });

  describe('grantPermission', () => {
    it('should grant permission', async () => {
      const request = {
        contextId: 'ctx-1',
        granterId: 'granter-id',
        granteeId: 'grantee-id',
        capability: 'read',
      };

      mockHttp.setMockResponse(
        'POST',
        '/admin-api/contexts/ctx-1/capabilities/grant',
        {
          data: { success: true },
        },
      );

      const result = await client.grantPermission('ctx-1', request);

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should throw error if response data is null', async () => {
      const request = {
        contextId: 'ctx-1',
        granterId: 'granter-id',
        granteeId: 'grantee-id',
        capability: 'read',
      };

      mockHttp.setMockResponse(
        'POST',
        '/admin-api/contexts/ctx-1/capabilities/grant',
        { data: null },
      );

      await expect(
        client.grantPermission('ctx-1', request),
      ).rejects.toThrow('Response data is null');
    });

    it('should handle HTTP errors', async () => {
      const request = {
        contextId: 'ctx-1',
        granterId: 'granter-id',
        granteeId: 'grantee-id',
        capability: 'read',
      };

      const error = new Error('Permission denied');
      mockHttp.setMockResponse(
        'POST',
        '/admin-api/contexts/ctx-1/capabilities/grant',
        error,
      );

      await expect(
        client.grantPermission('ctx-1', request),
      ).rejects.toThrow('Permission denied');
    });
  });

  describe('revokePermission', () => {
    it('should revoke permission', async () => {
      const request = {
        contextId: 'ctx-1',
        revokerId: 'revoker-id',
        revokeeId: 'revokee-id',
        capability: 'read',
      };

      mockHttp.setMockResponse(
        'POST',
        '/admin-api/contexts/ctx-1/capabilities/revoke',
        {
          data: { success: true },
        },
      );

      const result = await client.revokePermission('ctx-1', request);

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should throw error if response data is null', async () => {
      const request = {
        contextId: 'ctx-1',
        revokerId: 'revoker-id',
        revokeeId: 'revokee-id',
        capability: 'read',
      };

      mockHttp.setMockResponse(
        'POST',
        '/admin-api/contexts/ctx-1/capabilities/revoke',
        { data: null },
      );

      await expect(
        client.revokePermission('ctx-1', request),
      ).rejects.toThrow('Response data is null');
    });
  });
});
