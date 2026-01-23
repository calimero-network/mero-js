import { HttpClient } from '../../http-client';

// Helper to unwrap { data: T } responses
type ApiResponse<T> = { data: T };

async function unwrap<T>(
  response: Promise<ApiResponse<T>>,
): Promise<T> {
  const result = await response;
  if (!result.data) {
    throw new Error('Response data is null');
  }
  return result.data;
}

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
    // Blob upload uses PUT method, not POST
    return unwrap(
      this.httpClient.put<ApiResponse<BlobUploadResponse>>(
        '/admin-api/blobs',
        blob,
      ),
    );
  }

  async listBlobs(): Promise<BlobListResponse> {
    return unwrap(
      this.httpClient.get<ApiResponse<BlobListResponse>>('/admin-api/blobs'),
    );
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
    return unwrap(
      this.httpClient.delete<ApiResponse<BlobDeleteResponse>>(
        `/admin-api/blobs/${blobId}`,
      ),
    );
  }
}
