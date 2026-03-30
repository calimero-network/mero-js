import { HttpClient } from '../http-client';
import type {
  HealthStatus,
  AdminAuthStatus,
  InstallApplicationRequest,
  InstallApplicationResponseData,
  InstallDevApplicationRequest,
  UninstallApplicationResponseData,
  ListApplicationsResponseData,
  GetApplicationResponseData,
  GetLatestVersionResponseData,
  CreateContextRequest,
  CreateContextResponseData,
  DeleteContextResponseData,
  GetContextsResponseData,
  Context,
  GenerateContextIdentityResponseData,
  GetContextIdentitiesResponseData,
  InviteToContextRequest,
  JoinContextRequest,
  JoinContextResponseData,
  UploadBlobRequest,
  CreateAliasRequest,

  ListAliasesResponseData,
} from './admin-types';

/**
 * Helper: server wraps most responses in `{ data: T }`.
 * This extracts `.data` so callers get the inner payload directly.
 */
function unwrap<T>(response: { data: T }): T {
  return response.data;
}

export class AdminApiClient {
  constructor(private httpClient: HttpClient) {}

  // ---- Health and Status (public, no auth) ----

  async healthCheck(): Promise<HealthStatus> {
    return unwrap(await this.httpClient.get<{ data: HealthStatus }>('/admin-api/health'));
  }

  async isAuthed(): Promise<AdminAuthStatus> {
    return this.httpClient.get<AdminAuthStatus>('/admin-api/is-authed');
  }

  // ---- Application Management ----

  async installApplication(request: InstallApplicationRequest): Promise<InstallApplicationResponseData> {
    return unwrap(await this.httpClient.post<{ data: InstallApplicationResponseData }>('/admin-api/install-application', request));
  }

  async installDevApplication(request: InstallDevApplicationRequest): Promise<InstallApplicationResponseData> {
    return unwrap(await this.httpClient.post<{ data: InstallApplicationResponseData }>('/admin-api/install-dev-application', request));
  }

  async uninstallApplication(appId: string): Promise<UninstallApplicationResponseData> {
    return unwrap(await this.httpClient.delete<{ data: UninstallApplicationResponseData }>(`/admin-api/applications/${appId}`));
  }

  async listApplications(): Promise<ListApplicationsResponseData> {
    return unwrap(await this.httpClient.get<{ data: ListApplicationsResponseData }>('/admin-api/applications'));
  }

  async getApplication(appId: string): Promise<GetApplicationResponseData> {
    return unwrap(await this.httpClient.get<{ data: GetApplicationResponseData }>(`/admin-api/applications/${appId}`));
  }

  // ---- Package Management (public, no auth) ----

  async getLatestPackageVersion(packageName: string): Promise<GetLatestVersionResponseData> {
    return unwrap(await this.httpClient.get<{ data: GetLatestVersionResponseData }>(
      `/admin-api/packages/${encodeURIComponent(packageName)}/latest`,
    ));
  }

  // ---- Context Management ----

  async createContext(request: CreateContextRequest): Promise<CreateContextResponseData> {
    return unwrap(await this.httpClient.post<{ data: CreateContextResponseData }>('/admin-api/contexts', request));
  }

  async deleteContext(contextId: string): Promise<DeleteContextResponseData> {
    return unwrap(await this.httpClient.delete<{ data: DeleteContextResponseData }>(`/admin-api/contexts/${contextId}`));
  }

  async getContexts(): Promise<GetContextsResponseData> {
    return unwrap(await this.httpClient.get<{ data: GetContextsResponseData }>('/admin-api/contexts'));
  }

  async getContext(contextId: string): Promise<Context> {
    return unwrap(await this.httpClient.get<{ data: Context }>(`/admin-api/contexts/${contextId}`));
  }

  async getContextsForApplication(applicationId: string): Promise<GetContextsResponseData> {
    return unwrap(await this.httpClient.get<{ data: GetContextsResponseData }>(`/admin-api/contexts/for-application/${applicationId}`));
  }

  // ---- Context Identity ----

  async generateContextIdentity(): Promise<GenerateContextIdentityResponseData> {
    return unwrap(await this.httpClient.post<{ data: GenerateContextIdentityResponseData }>('/admin-api/identity/context', {}));
  }

  async getContextIdentities(contextId: string): Promise<GetContextIdentitiesResponseData> {
    return unwrap(await this.httpClient.get<{ data: GetContextIdentitiesResponseData }>(`/admin-api/contexts/${contextId}/identities`));
  }

  async getContextIdentitiesOwned(contextId: string): Promise<GetContextIdentitiesResponseData> {
    return unwrap(await this.httpClient.get<{ data: GetContextIdentitiesResponseData }>(`/admin-api/contexts/${contextId}/identities-owned`));
  }

  // ---- Context Invite / Join ----

  async inviteToContext(request: InviteToContextRequest): Promise<unknown> {
    return unwrap(await this.httpClient.post<{ data: unknown }>('/admin-api/contexts/invite', request));
  }

  async joinContext(request: JoinContextRequest): Promise<JoinContextResponseData | null> {
    return unwrap(await this.httpClient.post<{ data: JoinContextResponseData | null }>('/admin-api/contexts/join', request));
  }

  // ---- Blob Management ----

  async uploadBlob(data: UploadBlobRequest): Promise<unknown> {
    return unwrap(await this.httpClient.put<{ data: unknown }>('/admin-api/blobs', data));
  }

  async deleteBlob(blobId: string): Promise<unknown> {
    return unwrap(await this.httpClient.delete<{ data: unknown }>(`/admin-api/blobs/${blobId}`));
  }

  async listBlobs(): Promise<unknown> {
    return this.httpClient.get('/admin-api/blobs');
  }

  async getBlob(blobId: string): Promise<unknown> {
    return this.httpClient.get(`/admin-api/blobs/${blobId}`);
  }

  // ---- Alias Management ----
  // Server uses type-specific alias routes: /admin-api/alias/{create,lookup,delete,list}/{context,application}

  async createContextAlias(request: CreateAliasRequest): Promise<unknown> {
    return this.httpClient.post('/admin-api/alias/create/context', request);
  }

  async createApplicationAlias(request: CreateAliasRequest): Promise<unknown> {
    return this.httpClient.post('/admin-api/alias/create/application', request);
  }

  async lookupContextAlias(name: string): Promise<unknown> {
    return this.httpClient.post(`/admin-api/alias/lookup/context/${encodeURIComponent(name)}`, {});
  }

  async lookupApplicationAlias(name: string): Promise<unknown> {
    return this.httpClient.post(`/admin-api/alias/lookup/application/${encodeURIComponent(name)}`, {});
  }

  async deleteContextAlias(name: string): Promise<unknown> {
    return this.httpClient.post(`/admin-api/alias/delete/context/${encodeURIComponent(name)}`, {});
  }

  async deleteApplicationAlias(name: string): Promise<unknown> {
    return this.httpClient.post(`/admin-api/alias/delete/application/${encodeURIComponent(name)}`, {});
  }

  async listContextAliases(): Promise<ListAliasesResponseData> {
    return unwrap(await this.httpClient.get<{ data: ListAliasesResponseData }>('/admin-api/alias/list/context'));
  }

  async listApplicationAliases(): Promise<ListAliasesResponseData> {
    return unwrap(await this.httpClient.get<{ data: ListAliasesResponseData }>('/admin-api/alias/list/application'));
  }

  // ---- Network ----

  async getPeersCount(): Promise<{ count: number }> {
    return unwrap(await this.httpClient.get<{ data: { count: number } }>('/admin-api/peers'));
  }
}
