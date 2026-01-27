import { HttpClient } from '../../http-client';
import { unwrap, type ApiResponseWrapper } from '../utils';

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
      this.httpClient.post<ApiResponseWrapper<GrantPermissionResponse>>(
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
      this.httpClient.post<ApiResponseWrapper<RevokePermissionResponse>>(
        `/admin-api/contexts/${contextId}/capabilities/revoke`,
        request,
      ),
    );
  }
}
