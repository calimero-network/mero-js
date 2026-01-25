import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../../../tests/mocks/server';
import { ApplicationsApiClient } from '../applications';
import { createBrowserHttpClient } from '../../../http-client';
import {
  createErrorHandler,
  createEmptyResponseHandler,
  createMalformedJsonHandler,
} from '../../../../tests/mocks/helpers';

describe('ApplicationsApiClient - MSW Integration Tests', () => {
  let client: ApplicationsApiClient;

  beforeEach(() => {
    const httpClient = createBrowserHttpClient({
      baseUrl: 'http://localhost:8080',
      timeoutMs: 5000, // 5 second timeout
    });
    client = new ApplicationsApiClient(httpClient);
  });

  describe('Success Scenarios', () => {
    it('should list applications', async () => {
      const result = await client.listApplications();
      expect(result).toBeDefined();
      expect(result.apps).toBeDefined();
      expect(Array.isArray(result.apps)).toBe(true);
    });

    it('should get application by id', async () => {
      server.use(
        http.get('*/admin-api/applications/app1', () => {
          return HttpResponse.json({
            data: { id: 'app1', name: 'Test App', version: '1.0.0' },
          });
        }),
      );

      const result = await client.getApplication('app1');
      expect(result.id).toBe('app1');
    });

    it('should install application', async () => {
      server.use(
        http.post('*/admin-api/install-application', async ({ request }) => {
          const body = await request.json();
          return HttpResponse.json({
            data: { applicationId: 'app-installed-123' },
          });
        }),
      );

      const result = await client.installApplication({
        url: 'https://example.com/app.wasm',
        metadata: Buffer.from('test').toString('base64'),
      });

      expect(result.applicationId).toBe('app-installed-123');
    });
  });

  describe('Error Scenarios', () => {
    it('should handle 404 Not Found', async () => {
      server.use(
        http.get('*/admin-api/applications/nonexistent', () => {
          return HttpResponse.json(
            { error: 'Application not found' },
            { status: 404 },
          );
        }),
      );

      await expect(client.getApplication('nonexistent')).rejects.toThrow();
    });

    it('should handle 401 Unauthorized', async () => {
      server.use(
        createErrorHandler('*/admin-api/applications', 401, 'Unauthorized'),
      );

      await expect(client.listApplications()).rejects.toThrow();
    });

    it('should handle 500 Internal Server Error', async () => {
      server.use(
        createErrorHandler(
          '*/admin-api/applications',
          500,
          'Internal server error',
        ),
      );

      await expect(client.listApplications()).rejects.toThrow();
    });

    it('should handle 400 Bad Request', async () => {
      server.use(
        http.post('*/admin-api/install-application', () => {
          return HttpResponse.json(
            { error: 'Invalid request' },
            { status: 400 },
          );
        }),
      );

      await expect(
        client.installApplication({
          url: 'invalid-url',
          metadata: '',
        }),
      ).rejects.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty response array', async () => {
      server.use(createEmptyResponseHandler('*/admin-api/applications'));

      const result = await client.listApplications();
      expect(result).toEqual([]);
    });

    it('should handle network timeout', async () => {
      server.use(
        http.get('*/admin-api/applications', async () => {
          // Delay longer than httpClient timeout (5s)
          await new Promise((resolve) => setTimeout(resolve, 6000));
          return HttpResponse.json({ data: [] });
        }),
      );

      // Should timeout based on httpClient timeout
      await expect(client.listApplications()).rejects.toThrow();
    }, 10000);

    it('should handle malformed JSON response', async () => {
      server.use(createMalformedJsonHandler('*/admin-api/applications'));

      await expect(client.listApplications()).rejects.toThrow();
    });

    it('should handle very large responses', async () => {
      const largeArray = Array(1000).fill({
        id: 'item',
        name: 'x'.repeat(1000),
        version: '1.0.0',
      });

      server.use(
        http.get('*/admin-api/applications', () => {
          return HttpResponse.json({ data: largeArray });
        }),
      );

      const result = await client.listApplications();
      expect(result).toHaveLength(1000);
    });
  });

  describe('Package Management', () => {
    it('should list packages', async () => {
      server.use(
        http.get('*/admin-api/packages', () => {
          return HttpResponse.json({
            data: [{ name: 'package1', version: '1.0.0' }],
          });
        }),
      );

      const result = await client.listPackages();
      expect(result).toBeDefined();
    });

    it('should list versions for package', async () => {
      server.use(
        http.get('*/admin-api/packages/:name/versions', ({ params }) => {
          return HttpResponse.json({
            data: [
              { version: '1.0.0' },
              { version: '1.1.0' },
            ],
          });
        }),
      );

      const result = await client.listVersions('package1');
      expect(result).toBeDefined();
    });

    it('should get latest version', async () => {
      server.use(
        http.get('*/admin-api/packages/:name/latest', () => {
          return HttpResponse.json({ data: { version: '2.0.0' } });
        }),
      );

      const result = await client.getLatestVersion('package1');
      expect(result.version).toBe('2.0.0');
    });
  });
});
