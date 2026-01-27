import { describe, it, expect, beforeEach } from 'vitest';
import { PublicApiClient } from '../public';
import { MockHttpClient } from './mock-http-client';

describe('PublicApiClient', () => {
  let client: PublicApiClient;
  let mockHttp: MockHttpClient;

  beforeEach(() => {
    mockHttp = new MockHttpClient();
    client = new PublicApiClient(mockHttp);
  });

  describe('health', () => {
    it('should return health status', async () => {
      mockHttp.setMockResponse('GET', '/admin-api/health', {
        data: { status: 'alive' },
      });

      const result = await client.health();

      expect(result).toEqual({ status: 'alive' });
    });

    it('should throw error if response data is null', async () => {
      mockHttp.setMockResponse('GET', '/admin-api/health', { data: null });

      await expect(client.health()).rejects.toThrow('Response data is null');
    });
  });

  describe('isAuthed', () => {
    it('should return auth status', async () => {
      mockHttp.setMockResponse('GET', '/admin-api/is-authed', {
        data: { status: 'authenticated' },
      });

      const result = await client.isAuthed();

      expect(result).toEqual({ status: 'authenticated' });
    });
  });

  describe('getCertificate', () => {
    it('should return certificate as text', async () => {
      const cert = '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----';
      mockHttp.setMockResponse('GET', '/admin-api/certificate', cert);

      const result = await client.getCertificate();

      expect(result).toBe(cert);
    });
  });
});
