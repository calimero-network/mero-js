import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../../../tests/mocks/server';
import { ApplicationsApiClient } from '../applications';
import { createBrowserHttpClient } from '../../../http-client';

describe('ApplicationsApiClient', () => {
  let client: ApplicationsApiClient;

  beforeEach(() => {
    const httpClient = createBrowserHttpClient({
      baseUrl: 'http://localhost:8080',
      timeoutMs: 5000,
    });
    client = new ApplicationsApiClient(httpClient);
  });

  describe('installApplication', () => {
    it('should install application', async () => {
      server.use(
        http.post('*/admin-api/install-application', () => {
          return HttpResponse.json({ data: { applicationId: 'app-123' } });
        }),
      );

      const request = {
        url: 'https://example.com/app.wasm',
        metadata: Buffer.from('test').toString('base64'),
      };

      const result = await client.installApplication(request);

      expect(result).toEqual({ applicationId: 'app-123' });
    });
  });

  describe('installDevApplication', () => {
    it('should install dev application', async () => {
      server.use(
        http.post('*/admin-api/install-dev-application', () => {
          return HttpResponse.json({ data: { applicationId: 'app-dev-123' } });
        }),
      );

      const request = {
        path: '/local/path/app.wasm',
        metadata: Buffer.from('test').toString('base64'),
      };

      const result = await client.installDevApplication(request);

      expect(result).toEqual({ applicationId: 'app-dev-123' });
    });
  });

  describe('listApplications', () => {
    it('should list applications', async () => {
      server.use(
        http.get('*/admin-api/applications', () => {
          return HttpResponse.json({
            data: {
              apps: [
                { applicationId: 'app-1', metadata: 'meta1' },
                { applicationId: 'app-2', metadata: 'meta2' },
              ],
            },
          });
        }),
      );

      const result = await client.listApplications();

      expect(result.apps).toHaveLength(2);
      expect(result.apps[0]).toEqual({
        applicationId: 'app-1',
        metadata: 'meta1',
      });
    });
  });

  describe('getApplication', () => {
    it('should get application by id', async () => {
      server.use(
        http.get('*/admin-api/applications/app-123', () => {
          return HttpResponse.json({
            data: {
              application: { applicationId: 'app-123', metadata: 'meta' },
            },
          });
        }),
      );

      const result = await client.getApplication('app-123');

      expect(result.application).toEqual({
        applicationId: 'app-123',
        metadata: 'meta',
      });
    });
  });

  describe('uninstallApplication', () => {
    it('should uninstall application', async () => {
      server.use(
        http.delete('*/admin-api/applications/app-123', () => {
          return HttpResponse.json({ data: { applicationId: 'app-123' } });
        }),
      );

      const result = await client.uninstallApplication('app-123');

      expect(result).toEqual({ applicationId: 'app-123' });
    });
  });

  describe('listPackages', () => {
    it('should list packages', async () => {
      server.use(
        http.get('*/admin-api/packages', () => {
          return HttpResponse.json({ data: { packages: ['pkg1', 'pkg2'] } });
        }),
      );

      const result = await client.listPackages();

      expect(result.packages).toEqual(['pkg1', 'pkg2']);
    });
  });

  describe('listVersions', () => {
    it('should list versions for package', async () => {
      server.use(
        http.get('*/admin-api/packages/pkg1/versions', () => {
          return HttpResponse.json({
            data: { versions: ['1.0.0', '1.1.0'] },
          });
        }),
      );

      const result = await client.listVersions('pkg1');

      expect(result.versions).toEqual(['1.0.0', '1.1.0']);
    });
  });

  describe('getLatestVersion', () => {
    it('should get latest version', async () => {
      server.use(
        http.get('*/admin-api/packages/pkg1/latest', () => {
          return HttpResponse.json({ data: { applicationId: 'app-latest' } });
        }),
      );

      const result = await client.getLatestVersion('pkg1');

      expect(result).toEqual({ applicationId: 'app-latest' });
    });

    it('should handle null latest version', async () => {
      server.use(
        http.get('*/admin-api/packages/pkg1/latest', () => {
          return HttpResponse.json({ data: { applicationId: null } });
        }),
      );

      const result = await client.getLatestVersion('pkg1');

      expect(result.applicationId).toBeNull();
    });
  });

  describe('installApplication with optional fields', () => {
    it('should install application with hash', async () => {
      server.use(
        http.post('*/admin-api/install-application', () => {
          return HttpResponse.json({ data: { applicationId: 'app-123' } });
        }),
      );

      const request = {
        url: 'https://example.com/app.wasm',
        hash: 'abc123',
        metadata: Buffer.from('test').toString('base64'),
      };

      const result = await client.installApplication(request);

      expect(result.applicationId).toBe('app-123');
    });

    it('should install application with package and version', async () => {
      server.use(
        http.post('*/admin-api/install-application', () => {
          return HttpResponse.json({ data: { applicationId: 'app-123' } });
        }),
      );

      const request = {
        url: 'https://example.com/app.wasm',
        metadata: Buffer.from('test').toString('base64'),
        package: 'my-package',
        version: '1.0.0',
      };

      const result = await client.installApplication(request);

      expect(result.applicationId).toBe('app-123');
    });
  });

  describe('installDevApplication with optional fields', () => {
    it('should install dev application with package and version', async () => {
      server.use(
        http.post('*/admin-api/install-dev-application', () => {
          return HttpResponse.json({ data: { applicationId: 'app-dev-123' } });
        }),
      );

      const request = {
        path: '/local/path/app.wasm',
        metadata: Buffer.from('test').toString('base64'),
        package: 'my-package',
        version: '1.0.0',
      };

      const result = await client.installDevApplication(request);

      expect(result.applicationId).toBe('app-dev-123');
    });
  });

  describe('error handling', () => {
    it('should throw error when response data is null', async () => {
      server.use(
        http.get('*/admin-api/applications', () => {
          return HttpResponse.json({ data: null });
        }),
      );

      await expect(client.listApplications()).rejects.toThrow();
    });

    it('should handle HTTP errors', async () => {
      server.use(
        http.get('*/admin-api/applications/app-123', () => {
          return HttpResponse.json(
            { error: 'Application not found' },
            { status: 404 },
          );
        }),
      );

      await expect(client.getApplication('app-123')).rejects.toThrow();
    });
  });
});
