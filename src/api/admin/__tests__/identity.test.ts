import { describe, it, expect, beforeEach } from 'vitest';
import { IdentityApiClient } from '../identity';
import { MockHttpClient } from './mock-http-client';

describe('IdentityApiClient', () => {
  let client: IdentityApiClient;
  let mockHttp: MockHttpClient;

  beforeEach(() => {
    mockHttp = new MockHttpClient();
    client = new IdentityApiClient(mockHttp);
  });

  describe('generateContextIdentity', () => {
    it('should generate context identity', async () => {
      mockHttp.setMockResponse('POST', '/admin-api/identity/context', {
        data: {
          publicKey: 'ed25519:abc123...',
        },
      });

      const result = await client.generateContextIdentity();

      expect(result).toBeDefined();
      expect(result.publicKey).toBe('ed25519:abc123...');
      expect(typeof result.publicKey).toBe('string');
    });

    it('should throw error if response data is null', async () => {
      mockHttp.setMockResponse('POST', '/admin-api/identity/context', {
        data: null,
      });

      await expect(client.generateContextIdentity()).rejects.toThrow(
        'Response data is null',
      );
    });

    it('should handle HTTP errors', async () => {
      const error = new Error('Failed to generate identity');
      mockHttp.setMockResponse('POST', '/admin-api/identity/context', error);

      await expect(client.generateContextIdentity()).rejects.toThrow(
        'Failed to generate identity',
      );
    });
  });
});
