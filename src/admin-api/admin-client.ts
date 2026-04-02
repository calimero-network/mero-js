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
  JoinContextResponseData,
  UploadBlobRequest,
  CreateAliasRequest,
  ListAliasesResponseData,
  ListNamespacesResponseData,
  NamespaceIdentity,
  CreateGroupRequest,
  CreateGroupResponseData,
  ListGroupsResponseData,
  GroupInfoResponseData,
  ListGroupMembersResponseData,
  ListGroupContextsResponseData,
  CreateGroupInvitationRequest,
  JoinGroupRequest,
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

  // ---- Package Management ----

  async getLatestPackageVersion(packageName: string): Promise<GetLatestVersionResponseData> {
    return this.httpClient.get<GetLatestVersionResponseData>(
      `/admin-api/packages/${encodeURIComponent(packageName)}/latest`,
    );
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

  // ---- Context join (group membership) ----

  async joinContext(contextId: string): Promise<JoinContextResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: JoinContextResponseData }>(`/admin-api/contexts/${contextId}/join`, {}),
    );
  }

  // ---- Blob Management ----

  async uploadBlob(data: UploadBlobRequest): Promise<unknown> {
    return unwrap(await this.httpClient.put<{ data: unknown }>('/admin-api/blobs', data));
  }

  async deleteBlob(blobId: string): Promise<unknown> {
    return unwrap(await this.httpClient.delete<{ data: unknown }>(`/admin-api/blobs/${blobId}`));
  }

  async listBlobs(): Promise<unknown> {
    return unwrap(await this.httpClient.get<{ data: unknown }>('/admin-api/blobs'));
  }

  async getBlob(blobId: string): Promise<unknown> {
    return unwrap(await this.httpClient.get<{ data: unknown }>(`/admin-api/blobs/${blobId}`));
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

  // ---- Namespace Management ----

  async listNamespaces(): Promise<ListNamespacesResponseData> {
    return unwrap(await this.httpClient.get<{ data: ListNamespacesResponseData }>('/admin-api/namespaces'));
  }

  async getNamespaceIdentity(namespaceId: string): Promise<NamespaceIdentity> {
    return this.httpClient.get<NamespaceIdentity>(`/admin-api/namespaces/${namespaceId}/identity`);
  }

  async listNamespacesForApplication(applicationId: string): Promise<ListNamespacesResponseData> {
    return unwrap(await this.httpClient.get<{ data: ListNamespacesResponseData }>(`/admin-api/namespaces/for-application/${applicationId}`));
  }

  // ---- Group Management ----

  async listGroups(): Promise<ListGroupsResponseData> {
    return unwrap(await this.httpClient.get<{ data: ListGroupsResponseData }>('/admin-api/groups'));
  }

  async createGroup(request: CreateGroupRequest): Promise<CreateGroupResponseData> {
    return unwrap(await this.httpClient.post<{ data: CreateGroupResponseData }>('/admin-api/groups', request));
  }

  async getGroupInfo(groupId: string): Promise<GroupInfoResponseData> {
    return unwrap(await this.httpClient.get<{ data: GroupInfoResponseData }>(`/admin-api/groups/${groupId}`));
  }

  async deleteGroup(groupId: string): Promise<unknown> {
    return unwrap(await this.httpClient.delete<{ data: unknown }>(`/admin-api/groups/${groupId}`));
  }

  async listGroupMembers(groupId: string): Promise<ListGroupMembersResponseData> {
    return this.httpClient.get<ListGroupMembersResponseData>(`/admin-api/groups/${groupId}/members`);
  }

  async listGroupContexts(groupId: string): Promise<ListGroupContextsResponseData> {
    return unwrap(await this.httpClient.get<{ data: ListGroupContextsResponseData }>(`/admin-api/groups/${groupId}/contexts`));
  }

  async createGroupInvitation(groupId: string, request?: CreateGroupInvitationRequest): Promise<unknown> {
    return unwrap(await this.httpClient.post<{ data: unknown }>(`/admin-api/groups/${groupId}/invite`, request ?? {}));
  }

  async joinGroup(request: JoinGroupRequest): Promise<unknown> {
    return unwrap(await this.httpClient.post<{ data: unknown }>('/admin-api/groups/join', request));
  }

  // ---- Network ----

  async getPeersCount(): Promise<{ count: number }> {
    return this.httpClient.get<{ count: number }>('/admin-api/peers');
  }
}
