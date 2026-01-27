import { describe, it, expect, beforeEach } from 'vitest';
import { NetworkApiClient } from '../network';
import { MockHttpClient } from './mock-http-client';

describe('NetworkApiClient', () => {
  let client: NetworkApiClient;
  let mockHttp: MockHttpClient;

  beforeEach(() => {
    mockHttp = new MockHttpClient();
    client = new NetworkApiClient(mockHttp);
  });

  describe('getPeersCount', () => {
    it('should get peers count', async () => {
      mockHttp.setMockResponse('GET', '/admin-api/peers', {
        count: 13,
      });

      const result = await client.getPeersCount();

      expect(result).toBeDefined();
      expect(result.count).toBe(13);
      expect(typeof result.count).toBe('number');
    });

    it('should handle zero peers', async () => {
      mockHttp.setMockResponse('GET', '/admin-api/peers', {
        count: 0,
      });

      const result = await client.getPeersCount();

      expect(result.count).toBe(0);
    });

    it('should handle HTTP errors', async () => {
      const error = new Error('Network error');
      mockHttp.setMockResponse('GET', '/admin-api/peers', error);

      await expect(client.getPeersCount()).rejects.toThrow('Network error');
    });
  });
});
