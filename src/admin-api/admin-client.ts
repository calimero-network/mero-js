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
  SignedOpenInvitation,
  JoinContextRequest,
  JoinContextResponseData,
  GroupInfo,
  GroupSummary,
  CreateGroupRequest,
  CreateGroupResponseData,
  DeleteGroupRequest,
  DeleteGroupResponseData,
  AddGroupMembersRequest,
  RemoveGroupMembersRequest,
  GroupContext,
  CreateGroupInvitationRequest,
  CreateGroupInvitationResponseData,
  JoinGroupRequest,
  JoinGroupResponseData,
  MemberCapabilities,
  SyncGroupRequest,
  SyncGroupResponseData,
  ListGroupMembersResponseData,
  UploadBlobRequest,
  CreateAliasRequest,
  ListAliasesResponseData,
  SetDefaultCapabilitiesRequest,
  SetDefaultVisibilityRequest,
  ContextVisibilityData,
  SetContextVisibilityRequest,
  ManageContextAllowlistRequest,
  UpdateMemberRoleRequest,
  UpgradeGroupRequest,
  UpgradeGroupResponseData,
  RetryGroupUpgradeRequest,
  SetGroupAliasRequest,
  SetMemberAliasRequest,
  UpdateGroupRequest,
  RemoveContextFromGroupRequest,
  RegisterSigningKeyRequest,
  RegisterSigningKeyResponseData,
  GetContextStorageResponseData,
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

  // ---- Context Invite / Join ----

  async inviteToContext(request: InviteToContextRequest): Promise<SignedOpenInvitation | null> {
    return unwrap(await this.httpClient.post<{ data: SignedOpenInvitation | null }>('/admin-api/contexts/invite', request));
  }

  async joinContext(request: JoinContextRequest): Promise<JoinContextResponseData | null> {
    return unwrap(await this.httpClient.post<{ data: JoinContextResponseData | null }>('/admin-api/contexts/join', request));
  }

  async getContextGroup(contextId: string): Promise<string | null> {
    return unwrap(await this.httpClient.get<{ data: string | null }>(`/admin-api/contexts/${contextId}/group`));
  }

  async getContextStorageSize(contextId: string): Promise<GetContextStorageResponseData> {
    return unwrap(await this.httpClient.get<{ data: GetContextStorageResponseData }>(`/admin-api/contexts/${contextId}/storage`));
  }

  async syncContext(contextId: string): Promise<void> {
    unwrap(await this.httpClient.post<{ data: null }>(`/admin-api/contexts/sync/${contextId}`, {}));
  }

  async syncAllContexts(): Promise<void> {
    unwrap(await this.httpClient.post<{ data: null }>('/admin-api/contexts/sync', {}));
  }

  // ---- Group Management ----

  async listGroups(): Promise<GroupSummary[]> {
    return unwrap(await this.httpClient.get<{ data: GroupSummary[] }>('/admin-api/groups'));
  }

  async createGroup(request: CreateGroupRequest): Promise<CreateGroupResponseData> {
    return unwrap(await this.httpClient.post<{ data: CreateGroupResponseData }>('/admin-api/groups', request));
  }

  async getGroupInfo(groupId: string): Promise<GroupInfo> {
    return unwrap(await this.httpClient.get<{ data: GroupInfo }>(`/admin-api/groups/${groupId}`));
  }

  async deleteGroup(groupId: string, request: DeleteGroupRequest = {}): Promise<DeleteGroupResponseData> {
    return unwrap(
      await this.httpClient.request<{ data: DeleteGroupResponseData }>(`/admin-api/groups/${groupId}`, {
        method: 'DELETE',
        body: JSON.stringify(request),
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );
  }

  async listGroupMembers(groupId: string): Promise<ListGroupMembersResponseData> {
    return this.httpClient.get<ListGroupMembersResponseData>(`/admin-api/groups/${groupId}/members`);
  }

  async addGroupMembers(groupId: string, request: AddGroupMembersRequest): Promise<void> {
    return unwrap(await this.httpClient.post<{ data: null }>(`/admin-api/groups/${groupId}/members`, request));
  }

  async removeGroupMembers(groupId: string, request: RemoveGroupMembersRequest): Promise<void> {
    return unwrap(await this.httpClient.post<{ data: null }>(`/admin-api/groups/${groupId}/members/remove`, request));
  }

  async listGroupContexts(groupId: string): Promise<GroupContext[]> {
    return unwrap(await this.httpClient.get<{ data: GroupContext[] }>(`/admin-api/groups/${groupId}/contexts`));
  }

  async joinGroupContext(groupId: string, contextId: string): Promise<JoinContextResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: JoinContextResponseData }>(
        `/admin-api/groups/${groupId}/join-context`,
        { contextId },
      ),
    );
  }

  async createGroupInvitation(
    groupId: string,
    request: CreateGroupInvitationRequest = {},
  ): Promise<CreateGroupInvitationResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: CreateGroupInvitationResponseData }>(
        `/admin-api/groups/${groupId}/invite`,
        request,
      ),
    );
  }

  async syncGroup(groupId: string, request?: SyncGroupRequest): Promise<SyncGroupResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: SyncGroupResponseData }>(
        `/admin-api/groups/${groupId}/sync`,
        request ?? {},
      ),
    );
  }

  async joinGroup(request: JoinGroupRequest): Promise<JoinGroupResponseData> {
    return unwrap(await this.httpClient.post<{ data: JoinGroupResponseData }>('/admin-api/groups/join', request));
  }

  async setMemberCapabilities(groupId: string, memberId: string, capabilities: number): Promise<void> {
    return unwrap(
      await this.httpClient.put<{ data: null }>(
        `/admin-api/groups/${groupId}/members/${memberId}/capabilities`,
        { capabilities },
      ),
    );
  }

  async getMemberCapabilities(groupId: string, memberId: string): Promise<MemberCapabilities> {
    return unwrap(
      await this.httpClient.get<{ data: MemberCapabilities }>(
        `/admin-api/groups/${groupId}/members/${memberId}/capabilities`,
      ),
    );
  }

  // ---- Group Governance / Settings ----

  async setDefaultCapabilities(groupId: string, request: SetDefaultCapabilitiesRequest): Promise<void> {
    unwrap(await this.httpClient.put<{ data: null }>(`/admin-api/groups/${groupId}/settings/default-capabilities`, request));
  }

  async setDefaultVisibility(groupId: string, request: SetDefaultVisibilityRequest): Promise<void> {
    unwrap(await this.httpClient.put<{ data: null }>(`/admin-api/groups/${groupId}/settings/default-visibility`, request));
  }

  async getContextVisibility(groupId: string, contextId: string): Promise<ContextVisibilityData> {
    return unwrap(
      await this.httpClient.get<{ data: ContextVisibilityData }>(
        `/admin-api/groups/${groupId}/contexts/${contextId}/visibility`,
      ),
    );
  }

  async setContextVisibility(groupId: string, contextId: string, request: SetContextVisibilityRequest): Promise<void> {
    unwrap(
      await this.httpClient.put<{ data: null }>(
        `/admin-api/groups/${groupId}/contexts/${contextId}/visibility`,
        request,
      ),
    );
  }

  async getContextAllowlist(groupId: string, contextId: string): Promise<string[]> {
    return unwrap(
      await this.httpClient.get<{ data: string[] }>(
        `/admin-api/groups/${groupId}/contexts/${contextId}/allowlist`,
      ),
    );
  }

  async updateContextAllowlist(groupId: string, contextId: string, request: ManageContextAllowlistRequest): Promise<void> {
    unwrap(
      await this.httpClient.post<{ data: null }>(
        `/admin-api/groups/${groupId}/contexts/${contextId}/allowlist`,
        request,
      ),
    );
  }

  async updateMemberRole(groupId: string, identity: string, request: UpdateMemberRoleRequest): Promise<void> {
    unwrap(
      await this.httpClient.put<{ data: null }>(
        `/admin-api/groups/${groupId}/members/${identity}/role`,
        request,
      ),
    );
  }

  // ---- Group Upgrade ----

  async upgradeGroup(groupId: string, request: UpgradeGroupRequest): Promise<UpgradeGroupResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: UpgradeGroupResponseData }>(`/admin-api/groups/${groupId}/upgrade`, request),
    );
  }

  async getGroupUpgradeStatus(groupId: string): Promise<UpgradeGroupResponseData | null> {
    return unwrap(
      await this.httpClient.get<{ data: UpgradeGroupResponseData | null }>(`/admin-api/groups/${groupId}/upgrade/status`),
    );
  }

  async retryGroupUpgrade(groupId: string, request: RetryGroupUpgradeRequest = {}): Promise<UpgradeGroupResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: UpgradeGroupResponseData }>(`/admin-api/groups/${groupId}/upgrade/retry`, request),
    );
  }

  // ---- Group / Member Alias ----

  async setGroupAlias(groupId: string, request: SetGroupAliasRequest): Promise<void> {
    unwrap(await this.httpClient.put<{ data: null }>(`/admin-api/groups/${groupId}/alias`, request));
  }

  async setMemberAlias(groupId: string, identity: string, request: SetMemberAliasRequest): Promise<void> {
    unwrap(
      await this.httpClient.put<{ data: null }>(
        `/admin-api/groups/${groupId}/members/${identity}/alias`,
        request,
      ),
    );
  }

  // ---- Group Update / Context Removal ----

  async updateGroup(groupId: string, request: UpdateGroupRequest): Promise<void> {
    unwrap(await this.httpClient.patch<{ data: null }>(`/admin-api/groups/${groupId}`, request));
  }

  async removeContextFromGroup(groupId: string, contextId: string, request: RemoveContextFromGroupRequest = {}): Promise<void> {
    unwrap(
      await this.httpClient.post<{ data: null }>(
        `/admin-api/groups/${groupId}/contexts/${contextId}/remove`,
        request,
      ),
    );
  }

  // ---- Signing Key ----

  async registerSigningKey(groupId: string, request: RegisterSigningKeyRequest): Promise<RegisterSigningKeyResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: RegisterSigningKeyResponseData }>(
        `/admin-api/groups/${groupId}/signing-key`,
        request,
      ),
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

  // ---- Network ----

  async getPeersCount(): Promise<{ count: number }> {
    return this.httpClient.get<{ count: number }>('/admin-api/peers');
  }
}
