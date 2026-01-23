import { describe, it, expect, beforeEach } from 'vitest';
import { AdminApiClient } from '../client';
import { MockHttpClient } from './mock-http-client';

describe('Error Handling - Admin API', () => {
  let client: AdminApiClient;
  let mockHttp: MockHttpClient;

  beforeEach(() => {
    mockHttp = new MockHttpClient();
    client = new AdminApiClient(mockHttp);
  });

  describe('HTTP Error Responses', () => {
    it('should handle 400 Bad Request', async () => {
      const error = new Error('Bad Request');
      (error as any).status = 400;
      mockHttp.setMockResponse('POST', '/admin-api/contexts', error);

      await expect(
        client.contexts.createContext({
          protocol: 'invalid',
          applicationId: 'app-1',
          initializationParams: 'invalid',
        }),
      ).rejects.toThrow('Bad Request');
    });

    it('should handle 401 Unauthorized', async () => {
      const error = new Error('Unauthorized');
      (error as any).status = 401;
      mockHttp.setMockResponse('GET', '/admin-api/contexts', error);

      await expect(client.contexts.listContexts()).rejects.toThrow('Unauthorized');
    });

    it('should handle 404 Not Found', async () => {
      const error = new Error('Not Found');
      (error as any).status = 404;
      mockHttp.setMockResponse('GET', '/admin-api/contexts/nonexistent', error);

      await expect(client.contexts.getContext('nonexistent')).rejects.toThrow(
        'Not Found',
      );
    });

    it('should handle 500 Internal Server Error', async () => {
      const error = new Error('Internal Server Error');
      (error as any).status = 500;
      mockHttp.setMockResponse('GET', '/admin-api/applications', error);

      await expect(client.applications.listApplications()).rejects.toThrow(
        'Internal Server Error',
      );
    });
  });

  describe('Null Response Data', () => {
    it('should throw error when response data is null', async () => {
      mockHttp.setMockResponse('GET', '/admin-api/contexts', { data: null });

      await expect(client.contexts.listContexts()).rejects.toThrow(
        'Response data is null',
      );
    });

    it('should throw error when response data is undefined', async () => {
      mockHttp.setMockResponse('GET', '/admin-api/applications', {
        data: undefined,
      });

      await expect(client.applications.listApplications()).rejects.toThrow(
        'Response data is null',
      );
    });
  });

  describe('Network Errors', () => {
    it('should handle network timeout', async () => {
      const error = new Error('Network timeout');
      (error as any).status = 0;
      mockHttp.setMockResponse('GET', '/admin-api/contexts', error);

      await expect(client.contexts.listContexts()).rejects.toThrow('Network timeout');
    });

    it('should handle connection refused', async () => {
      const error = new Error('Connection refused');
      (error as any).status = 0;
      mockHttp.setMockResponse('GET', '/admin-api/health', error);

      await expect(client.public.health()).rejects.toThrow('Connection refused');
    });
  });

  describe('Invalid Response Format', () => {
    it('should handle missing required fields', async () => {
      mockHttp.setMockResponse('GET', '/admin-api/contexts/ctx-1', {
        data: {
          // Missing required fields
          contextId: 'ctx-1',
          // Missing applicationId and protocol
        },
      });

      // This should succeed but the response might be incomplete
      const result = await client.contexts.getContext('ctx-1');
      expect(result.contextId).toBe('ctx-1');
      // Note: TypeScript won't catch missing fields at runtime
    });

    it('should handle unexpected response structure', async () => {
      mockHttp.setMockResponse('GET', '/admin-api/applications', {
        data: {
          // Unexpected structure - missing 'apps' field
          items: [{ id: 'app-1' }],
        },
      });

      // This will succeed but the response won't have the expected structure
      // TypeScript won't catch this at runtime, but the response will be incomplete
      const result = await client.applications.listApplications();
      // The result might be undefined or have wrong structure
      expect(result).toBeDefined();
      // Note: This test verifies the client doesn't crash on unexpected structure
    });
  });

  describe('Empty Responses', () => {
    it('should handle empty array responses', async () => {
      mockHttp.setMockResponse('GET', '/admin-api/contexts', {
        data: {
          contexts: [],
        },
      });

      const result = await client.contexts.listContexts();
      expect(result.contexts).toEqual([]);
      expect(Array.isArray(result.contexts)).toBe(true);
    });

    it('should handle empty object responses', async () => {
      mockHttp.setMockResponse('GET', '/admin-api/alias/list/context', {
        data: {},
      });

      const result = await client.aliases.listContextAliases();
      expect(result).toEqual({});
      expect(typeof result).toBe('object');
    });
  });

  describe('Large Response Handling', () => {
    it('should handle large list responses', async () => {
      const largeContexts = Array.from({ length: 1000 }, (_, i) => ({
        contextId: `ctx-${i}`,
        applicationId: 'app-1',
        protocol: 'near',
      }));

      mockHttp.setMockResponse('GET', '/admin-api/contexts', {
        data: {
          contexts: largeContexts,
        },
      });

      const result = await client.contexts.listContexts();
      expect(result.contexts).toHaveLength(1000);
    });
  });

  describe('Concurrent Requests', () => {
    it('should handle concurrent requests', async () => {
      mockHttp.setMockResponse('GET', '/admin-api/contexts', {
        data: { contexts: [] },
      });
      mockHttp.setMockResponse('GET', '/admin-api/applications', {
        data: { apps: [] },
      });

      const [contexts, applications] = await Promise.all([
        client.contexts.listContexts(),
        client.applications.listApplications(),
      ]);

      expect(contexts).toBeDefined();
      expect(applications).toBeDefined();
    });
  });

  describe('Invalid Input Parameters', () => {
    it('should handle empty context ID', async () => {
      const error = new Error('Invalid context ID');
      mockHttp.setMockResponse('GET', '/admin-api/contexts/', error);

      // Empty string might be handled differently
      await expect(client.contexts.getContext('')).rejects.toThrow();
    });

    it('should handle special characters in IDs', async () => {
      const error = new Error('Invalid ID format');
      mockHttp.setMockResponse('GET', '/admin-api/contexts/ctx%2F1', error);

      await expect(client.contexts.getContext('ctx/1')).rejects.toThrow();
    });
  });
});
