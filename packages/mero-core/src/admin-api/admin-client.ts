import { HttpClient } from '../http-client/http-types';
import {
  // Common types
  ApiResponse,
  // Health and Status
  HealthStatus,
  AdminAuthStatus,

  // Applications
  InstallApplicationRequest,
  InstallDevApplicationRequest,
  InstallApplicationResponse,
  UninstallApplicationResponse,
  ListApplicationsResponse,
  GetApplicationResponse,

  // Contexts
  CreateContextRequest,
  CreateContextResponse,
  DeleteContextResponse,
  ListContextsResponse,
  GetContextResponse,

  // Blobs
  UploadBlobRequest,
  UploadBlobResponse,
  DeleteBlobResponse,
  ListBlobsResponse,
  GetBlobResponse,

  // Aliases
  CreateAliasRequest,
  CreateAliasResponse,
  DeleteAliasResponse,
  ListAliasesResponse,
  GetAliasResponse,
} from './admin-types';

export class AdminApiClient {
  constructor(private httpClient: HttpClient) {}

  // Health and Status Endpoints
  async healthCheck(): Promise<HealthStatus> {
    const response =
      await this.httpClient.get<ApiResponse<HealthStatus>>('/admin-api/health');
    if (!response.data) {
      throw new Error('Health response data is null');
    }
    return response.data;
  }

  async isAuthed(): Promise<AdminAuthStatus> {
    return this.httpClient.get<AdminAuthStatus>('/admin-api/is-authed');
  }

  // Application Management Endpoints
  async installApplication(
    request: InstallApplicationRequest
  ): Promise<InstallApplicationResponse> {
    return this.httpClient.post<InstallApplicationResponse>(
      '/admin-api/install-application',
      request
    );
  }

  async installDevApplication(
    request: InstallDevApplicationRequest
  ): Promise<InstallApplicationResponse> {
    return this.httpClient.post<InstallApplicationResponse>(
      '/admin-api/install-dev-application',
      request
    );
  }

  async uninstallApplication(
    appId: string
  ): Promise<UninstallApplicationResponse> {
    return this.httpClient.delete<UninstallApplicationResponse>(
      `/admin-api/applications/${appId}`
    );
  }

  async listApplications(): Promise<ListApplicationsResponse> {
    return this.httpClient.get<ListApplicationsResponse>(
      '/admin-api/applications'
    );
  }

  async getApplication(appId: string): Promise<GetApplicationResponse> {
    return this.httpClient.get<GetApplicationResponse>(
      `/admin-api/applications/${appId}`
    );
  }

  // Context Management Endpoints
  async createContext(
    request: CreateContextRequest
  ): Promise<CreateContextResponse> {
    return this.httpClient.post<CreateContextResponse>(
      '/admin-api/contexts',
      request
    );
  }

  async deleteContext(contextId: string): Promise<DeleteContextResponse> {
    return this.httpClient.delete<DeleteContextResponse>(
      `/admin-api/contexts/${contextId}`
    );
  }

  async getContexts(): Promise<ListContextsResponse> {
    return this.httpClient.get<ListContextsResponse>('/admin-api/contexts');
  }

  async getContext(contextId: string): Promise<GetContextResponse> {
    return this.httpClient.get<GetContextResponse>(
      `/admin-api/contexts/${contextId}`
    );
  }

  // Blob Management Endpoints
  async uploadBlob(request: UploadBlobRequest): Promise<UploadBlobResponse> {
    return this.httpClient.put<UploadBlobResponse>('/admin-api/blobs', request);
  }

  async deleteBlob(blobId: string): Promise<DeleteBlobResponse> {
    return this.httpClient.delete<DeleteBlobResponse>(
      `/admin-api/blobs/${blobId}`
    );
  }

  async listBlobs(): Promise<ListBlobsResponse> {
    return this.httpClient.get<ListBlobsResponse>('/admin-api/blobs');
  }

  async getBlob(blobId: string): Promise<GetBlobResponse> {
    return this.httpClient.get<GetBlobResponse>(`/admin-api/blobs/${blobId}`);
  }

  async getBlobInfo(
    blobId: string
  ): Promise<{ headers: Record<string, string>; status: number }> {
    return this.httpClient.head(`/admin-api/blobs/${blobId}`);
  }

  // Alias Management Endpoints
  async createAlias(request: CreateAliasRequest): Promise<CreateAliasResponse> {
    return this.httpClient.post<CreateAliasResponse>(
      '/admin-api/alias',
      request
    );
  }

  async deleteAlias(aliasId: string): Promise<DeleteAliasResponse> {
    return this.httpClient.delete<DeleteAliasResponse>(
      `/admin-api/alias/${aliasId}`
    );
  }

  async listAliases(): Promise<ListAliasesResponse> {
    return this.httpClient.get<ListAliasesResponse>('/admin-api/alias');
  }

  async getAlias(aliasId: string): Promise<GetAliasResponse> {
    return this.httpClient.get<GetAliasResponse>(`/admin-api/alias/${aliasId}`);
  }

  // Network Management Endpoints
  async getPeersCount(): Promise<{ payload: number }> {
    return this.httpClient.get<{ payload: number }>('/admin-api/peers');
  }

  // Context Invitation and Management
  async inviteToContext(request: {
    contextId: string;
    publicKey: string;
  }): Promise<void> {
    return this.httpClient.post<void>('/admin-api/contexts/invite', request);
  }

  async joinContext(request: { invitationPayload: string }): Promise<void> {
    return this.httpClient.post<void>('/admin-api/contexts/join', request);
  }

  async updateContextApplication(
    contextId: string,
    request: { applicationId: string }
  ): Promise<void> {
    return this.httpClient.post<void>(
      `/admin-api/contexts/${contextId}/application`,
      request
    );
  }

  async getContextStorage(contextId: string): Promise<Record<string, unknown>> {
    return this.httpClient.get<Record<string, unknown>>(
      `/admin-api/contexts/${contextId}/storage`
    );
  }

  async getContextIdentities(
    contextId: string
  ): Promise<Record<string, unknown>> {
    return this.httpClient.get<Record<string, unknown>>(
      `/admin-api/contexts/${contextId}/identities`
    );
  }

  async getOwnedContextIdentities(
    contextId: string
  ): Promise<Record<string, unknown>> {
    return this.httpClient.get<Record<string, unknown>>(
      `/admin-api/contexts/${contextId}/identities-owned`
    );
  }

  async grantCapabilities(
    contextId: string,
    request: { publicKey: string; capabilities: string[] }
  ): Promise<void> {
    return this.httpClient.post<void>(
      `/admin-api/contexts/${contextId}/capabilities/grant`,
      request
    );
  }

  async revokeCapabilities(
    contextId: string,
    request: { publicKey: string; capabilities: string[] }
  ): Promise<void> {
    return this.httpClient.post<void>(
      `/admin-api/contexts/${contextId}/capabilities/revoke`,
      request
    );
  }

  // Identity Management
  async generateContextIdentity(request: {
    contextId?: string;
  }): Promise<{ payload: { publicKey: string; privateKey: string } }> {
    return this.httpClient.post<{
      payload: { publicKey: string; privateKey: string };
    }>('/admin-api/identity/context', request);
  }

  // Context Sync
  async syncContext(request: { contextId?: string }): Promise<void> {
    return this.httpClient.post<void>('/admin-api/contexts/sync', request);
  }

  async syncSpecificContext(
    contextId: string,
    request: { contextId?: string }
  ): Promise<void> {
    return this.httpClient.post<void>(
      `/admin-api/contexts/sync/${contextId}`,
      request
    );
  }

  // Certificate
  async getCertificate(): Promise<{
    payload: { certificate: string; publicKey: string };
  }> {
    return this.httpClient.get<{
      payload: { certificate: string; publicKey: string };
    }>('/admin-api/certificate');
  }
}
