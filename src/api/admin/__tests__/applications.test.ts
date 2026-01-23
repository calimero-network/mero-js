import { describe, it, expect, beforeEach } from 'vitest';
import { ApplicationsApiClient } from '../applications';
import { MockHttpClient } from './mock-http-client';

describe('ApplicationsApiClient', () => {
  let client: ApplicationsApiClient;
  let mockHttp: MockHttpClient;

  beforeEach(() => {
    mockHttp = new MockHttpClient();
    client = new ApplicationsApiClient(mockHttp);
  });

  describe('installApplication', () => {
    it('should install application', async () => {
      const request = {
        url: 'https://example.com/app.wasm',
        metadata: Buffer.from('test').toString('base64'),
      };

      mockHttp.setMockResponse('POST', '/admin-api/install-application', {
        data: { applicationId: 'app-123' },
      });

      const result = await client.installApplication(request);

      expect(result).toEqual({ applicationId: 'app-123' });
    });
  });

  describe('installDevApplication', () => {
    it('should install dev application', async () => {
      const request = {
        path: '/local/path/app.wasm',
        metadata: Buffer.from('test').toString('base64'),
      };

      mockHttp.setMockResponse('POST', '/admin-api/install-dev-application', {
        data: { applicationId: 'app-dev-123' },
      });

      const result = await client.installDevApplication(request);

      expect(result).toEqual({ applicationId: 'app-dev-123' });
    });
  });

  describe('listApplications', () => {
    it('should list applications', async () => {
      mockHttp.setMockResponse('GET', '/admin-api/applications', {
        data: {
          apps: [
            { applicationId: 'app-1', metadata: 'meta1' },
            { applicationId: 'app-2', metadata: 'meta2' },
          ],
        },
      });

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
      mockHttp.setMockResponse('GET', '/admin-api/applications/app-123', {
        data: {
          application: { applicationId: 'app-123', metadata: 'meta' },
        },
      });

      const result = await client.getApplication('app-123');

      expect(result.application).toEqual({
        applicationId: 'app-123',
        metadata: 'meta',
      });
    });
  });

  describe('uninstallApplication', () => {
    it('should uninstall application', async () => {
      mockHttp.setMockResponse('DELETE', '/admin-api/applications/app-123', {
        data: { applicationId: 'app-123' },
      });

      const result = await client.uninstallApplication('app-123');

      expect(result).toEqual({ applicationId: 'app-123' });
    });
  });

  describe('listPackages', () => {
    it('should list packages', async () => {
      mockHttp.setMockResponse('GET', '/admin-api/packages', {
        data: { packages: ['pkg1', 'pkg2'] },
      });

      const result = await client.listPackages();

      expect(result.packages).toEqual(['pkg1', 'pkg2']);
    });
  });

  describe('listVersions', () => {
    it('should list versions for package', async () => {
      mockHttp.setMockResponse('GET', '/admin-api/packages/pkg1/versions', {
        data: { versions: ['1.0.0', '1.1.0'] },
      });

      const result = await client.listVersions('pkg1');

      expect(result.versions).toEqual(['1.0.0', '1.1.0']);
    });
  });

  describe('getLatestVersion', () => {
    it('should get latest version', async () => {
      mockHttp.setMockResponse('GET', '/admin-api/packages/pkg1/latest', {
        data: { applicationId: 'app-latest' },
      });

      const result = await client.getLatestVersion('pkg1');

      expect(result).toEqual({ applicationId: 'app-latest' });
    });

    it('should handle null latest version', async () => {
      mockHttp.setMockResponse('GET', '/admin-api/packages/pkg1/latest', {
        data: { applicationId: null },
      });

      const result = await client.getLatestVersion('pkg1');

      expect(result.applicationId).toBeNull();
    });
  });

  describe('installApplication with optional fields', () => {
    it('should install application with hash', async () => {
      const request = {
        url: 'https://example.com/app.wasm',
        hash: 'abc123',
        metadata: Buffer.from('test').toString('base64'),
      };

      mockHttp.setMockResponse('POST', '/admin-api/install-application', {
        data: { applicationId: 'app-123' },
      });

      const result = await client.installApplication(request);

      expect(result.applicationId).toBe('app-123');
    });

    it('should install application with package and version', async () => {
      const request = {
        url: 'https://example.com/app.wasm',
        metadata: Buffer.from('test').toString('base64'),
        package: 'my-package',
        version: '1.0.0',
      };

      mockHttp.setMockResponse('POST', '/admin-api/install-application', {
        data: { applicationId: 'app-123' },
      });

      const result = await client.installApplication(request);

      expect(result.applicationId).toBe('app-123');
    });
  });

  describe('installDevApplication with optional fields', () => {
    it('should install dev application with package and version', async () => {
      const request = {
        path: '/local/path/app.wasm',
        metadata: Buffer.from('test').toString('base64'),
        package: 'my-package',
        version: '1.0.0',
      };

      mockHttp.setMockResponse('POST', '/admin-api/install-dev-application', {
        data: { applicationId: 'app-dev-123' },
      });

      const result = await client.installDevApplication(request);

      expect(result.applicationId).toBe('app-dev-123');
    });
  });

  describe('error handling', () => {
    it('should throw error when response data is null', async () => {
      mockHttp.setMockResponse('GET', '/admin-api/applications', {
        data: null,
      });

      await expect(client.listApplications()).rejects.toThrow(
        'Response data is null',
      );
    });

    it('should handle HTTP errors', async () => {
      const error = new Error('Application not found');
      mockHttp.setMockResponse('GET', '/admin-api/applications/app-123', error);

      await expect(client.getApplication('app-123')).rejects.toThrow(
        'Application not found',
      );
    });
  });
});
