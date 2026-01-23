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

export interface GrantPermissionRequest {
  contextId: string;
  granterId: string;
  granteeId: string;
  capability: string;
}

export interface GrantPermissionResponse {
  [key: string]: unknown;
}

export interface RevokePermissionRequest {
  contextId: string;
  revokerId: string;
  revokeeId: string;
  capability: string;
}

export interface RevokePermissionResponse {
  [key: string]: unknown;
}

export class CapabilitiesApiClient {
  constructor(private httpClient: HttpClient) {}

  async grantPermission(
    contextId: string,
    request: GrantPermissionRequest,
  ): Promise<GrantPermissionResponse> {
    return unwrap(
      this.httpClient.post<ApiResponse<GrantPermissionResponse>>(
        `/admin-api/contexts/${contextId}/capabilities/grant`,
        request,
      ),
    );
  }

  async revokePermission(
    contextId: string,
    request: RevokePermissionRequest,
  ): Promise<RevokePermissionResponse> {
    return unwrap(
      this.httpClient.post<ApiResponse<RevokePermissionResponse>>(
        `/admin-api/contexts/${contextId}/capabilities/revoke`,
        request,
      ),
    );
  }
}
