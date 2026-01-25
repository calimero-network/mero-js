import { HttpClient } from '../../http-client';
import { unwrap, type ApiResponseWrapper } from '../utils';

export interface BlobInfo {
  blobId: string;
  size: number;
  hash: string | null;
}

export type BlobUploadResponse = BlobInfo;

export interface BlobListResponse {
  blobs: BlobInfo[];
}

export interface BlobDeleteResponse {
  blobId: string;
  deleted: boolean;
}

export class BlobsApiClient {
  constructor(private httpClient: HttpClient) {}

  async uploadBlob(blob: Blob | File): Promise<BlobUploadResponse> {
    // Blob upload uses PUT method with binary data (application/octet-stream)
    // We need to use request() directly to pass the blob without JSON.stringify
    const response = await unwrap(
      this.httpClient.request<ApiResponseWrapper<{ blob_id: string; size: number; hash?: string | null }>>(
        '/admin-api/blobs',
        {
          method: 'PUT',
          body: blob,
          headers: {
            'Content-Type': 'application/octet-stream',
          },
        },
      ),
    );
    
    // Transform snake_case response to camelCase to match our interface
    return {
      blobId: response.blob_id,
      size: response.size,
      hash: response.hash ?? null,
    };
  }

  async listBlobs(): Promise<BlobListResponse> {
    const response = await unwrap(
      this.httpClient.get<ApiResponseWrapper<{ blobs: Array<{ blob_id: string; size: number; hash?: string | null }> }>>('/admin-api/blobs'),
    );
    
    // Transform snake_case response to camelCase to match our interface
    return {
      blobs: response.blobs.map((blob) => ({
        blobId: blob.blob_id,
        size: blob.size,
        hash: blob.hash ?? null,
      })),
    };
  }

  async getBlob(blobId: string): Promise<Blob> {
    return this.httpClient.get<Blob>(`/admin-api/blobs/${blobId}`, {
      parse: 'blob',
    });
  }

  async getBlobInfo(blobId: string): Promise<BlobInfo> {
    const response = await this.httpClient.head(`/admin-api/blobs/${blobId}`);
    // HEAD request returns headers with metadata
    // Note: This might need to be adjusted based on actual API response
    return {
      blobId,
      size: parseInt(response.headers['content-length'] || '0', 10),
      hash: response.headers['x-blob-hash'] || null,
    };
  }

  async deleteBlob(blobId: string): Promise<BlobDeleteResponse> {
    const response = await unwrap(
      this.httpClient.delete<ApiResponseWrapper<{ blob_id?: string; blobId?: string; deleted: boolean }>>(
        `/admin-api/blobs/${blobId}`,
      ),
    );
    
    // Transform snake_case response to camelCase to match our interface
    return {
      blobId: response.blob_id || response.blobId || blobId,
      deleted: response.deleted,
    };
  }
}
