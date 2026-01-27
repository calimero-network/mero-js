import { describe, it, expect, beforeEach } from 'vitest';
import { BlobsApiClient } from '../blobs';
import { MockHttpClient } from './mock-http-client';

describe('BlobsApiClient', () => {
  let client: BlobsApiClient;
  let mockHttp: MockHttpClient;

  beforeEach(() => {
    mockHttp = new MockHttpClient();
    client = new BlobsApiClient(mockHttp);
  });

  describe('uploadBlob', () => {
    it('should upload blob', async () => {
      const blob = new Blob(['test data']);

      // Server returns snake_case, SDK transforms to camelCase
      mockHttp.setMockResponse('PUT', '/admin-api/blobs', {
        data: {
          blob_id: 'blob-123',
          size: 9,
          hash: 'hash123',
        },
      });

      const result = await client.uploadBlob(blob);

      expect(result.blobId).toBe('blob-123');
      expect(result.size).toBe(9);
    });
  });

  describe('listBlobs', () => {
    it('should list blobs', async () => {
      // Server returns snake_case, SDK transforms to camelCase
      mockHttp.setMockResponse('GET', '/admin-api/blobs', {
        data: {
          blobs: [
            { blob_id: 'blob-1', size: 100, hash: 'hash1' },
            { blob_id: 'blob-2', size: 200, hash: 'hash2' },
          ],
        },
      });

      const result = await client.listBlobs();

      expect(result.blobs).toHaveLength(2);
    });
  });

  describe('getBlob', () => {
    it('should get blob by id', async () => {
      const blobData = new Blob(['test']);
      mockHttp.setMockResponse('GET', '/admin-api/blobs/blob-123', blobData);

      const result = await client.getBlob('blob-123');

      expect(result).toBeInstanceOf(Blob);
    });
  });

  describe('deleteBlob', () => {
    it('should delete blob', async () => {
      mockHttp.setMockResponse('DELETE', '/admin-api/blobs/blob-123', {
        data: { blobId: 'blob-123', deleted: true },
      });

      const result = await client.deleteBlob('blob-123');

      expect(result.deleted).toBe(true);
    });
  });
});
