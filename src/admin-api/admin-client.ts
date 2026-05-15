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
  ListPackagesResponseData,
  ListVersionsResponseData,
  CreateContextRequest,
  CreateContextResponseData,
  DeleteContextRequest,
  DeleteContextResponseData,
  GetContextsResponseData,
  Context,
  GenerateContextIdentityResponseData,
  GetContextIdentitiesResponseData,
  JoinContextResponseData,
  JoinSubgroupInheritanceResponseData,
  ContextGroupResponseData,
  ContextStorageResponseData,
  InviteSpecializedNodeRequest,
  InviteSpecializedNodeResponseData,
  UpdateContextApplicationRequest,
  ContextsWithExecutorsResponseData,
  UploadBlobRequest,
  UploadBlobResponseData,
  DeleteBlobResponseData,
  ListBlobsResponseData,
  GetBlobResponseData,
  CreateAliasRequest,
  CreateAliasResponseData,
  LookupAliasResponseData,
  DeleteAliasResponseData,
  ListAliasesResponseData,
  ListContextIdentityAliasesResponseData,
  CreateContextIdentityAliasResponseData,
  LookupContextIdentityAliasResponseData,
  DeleteContextIdentityAliasResponseData,
  ListNamespacesResponseData,
  CreateNamespaceRequest,
  CreateNamespaceResponseData,
  DeleteNamespaceRequest,
  DeleteNamespaceResponseData,
  CreateNamespaceInvitationRequest,
  CreateNamespaceInvitationResponseData,
  CreateRecursiveInvitationResponseData,
  JoinNamespaceRequest,
  JoinNamespaceResponseData,
  CreateGroupInNamespaceRequest,
  CreateGroupInNamespaceResponseData,
  SubgroupEntry,
  Namespace,
  NamespaceIdentity,
  GroupInfoResponseData,
  DeleteGroupRequest,
  DeleteGroupResponseData,
  ListGroupMembersResponseData,
  ListGroupContextsResponseData,
  AddGroupMembersRequest,
  RemoveGroupMembersRequest,
  UpdateMemberRoleRequest,
  MemberCapabilities,
  SetMemberCapabilitiesRequest,
  SetDefaultCapabilitiesRequest,
  SetSubgroupVisibilityRequest,
  SetTeeAdmissionPolicyRequest,
  UpdateGroupSettingsRequest,
  SetGroupMetadataRequest,
  SetMemberMetadataRequest,
  SetContextMetadataRequest,
  MetadataRecord,
  GetMetadataResponseData,
  SyncGroupRequest,
  SyncGroupResponseData,
  RegisterGroupSigningKeyRequest,
  RegisterGroupSigningKeyResponseData,
  UpgradeGroupRequest,
  UpgradeGroupResponseData,
  GroupUpgradeStatusResponseData,
  RetryGroupUpgradeRequest,
  RetryGroupUpgradeResponseData,
  NestGroupRequest,
  UnnestGroupRequest,
  DetachContextFromGroupRequest,
  CreateGroupInvitationRequest,
  CreateGroupInvitationResponseData,
  CreateRecursiveGroupInvitationResponseData,
  JoinGroupRequest,
  JoinGroupResponseData,
  TeeInfoResponseData,
  TeeAttestRequest,
  TeeAttestResponseData,
  TeeVerifyQuoteRequest,
  TeeVerifyQuoteResponseData,
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

  async listPackages(): Promise<ListPackagesResponseData> {
    return unwrap(await this.httpClient.get<{ data: ListPackagesResponseData }>('/admin-api/packages'));
  }

  async listPackageVersions(packageName: string): Promise<ListVersionsResponseData> {
    return unwrap(
      await this.httpClient.get<{ data: ListVersionsResponseData }>(
        `/admin-api/packages/${encodeURIComponent(packageName)}/versions`,
      ),
    );
  }

  async getLatestPackageVersion(packageName: string): Promise<GetLatestVersionResponseData> {
    return this.httpClient.get<GetLatestVersionResponseData>(
      `/admin-api/packages/${encodeURIComponent(packageName)}/latest`,
    );
  }

  // ---- Context Management ----

  async createContext(request: CreateContextRequest): Promise<CreateContextResponseData> {
    return unwrap(await this.httpClient.post<{ data: CreateContextResponseData }>('/admin-api/contexts', request));
  }

  async deleteContext(contextId: string, request?: DeleteContextRequest): Promise<DeleteContextResponseData> {
    if (request) {
      return unwrap(
        await this.httpClient.request<{ data: DeleteContextResponseData }>(`/admin-api/contexts/${contextId}`, {
          method: 'DELETE',
          body: JSON.stringify(request),
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
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

  // ---- Context group / storage / sync ----

  async getContextGroup(contextId: string): Promise<ContextGroupResponseData> {
    return unwrap(await this.httpClient.get<{ data: ContextGroupResponseData }>(`/admin-api/contexts/${contextId}/group`));
  }

  async getContextStorage(contextId: string): Promise<ContextStorageResponseData> {
    return unwrap(await this.httpClient.get<{ data: ContextStorageResponseData }>(`/admin-api/contexts/${contextId}/storage`));
  }

  async syncContext(contextId?: string): Promise<void> {
    await this.httpClient.post(`/admin-api/contexts/sync/${contextId ?? ''}`, {});
  }

  async inviteSpecializedNode(request: InviteSpecializedNodeRequest): Promise<InviteSpecializedNodeResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: InviteSpecializedNodeResponseData }>(
        '/admin-api/contexts/invite-specialized-node',
        request,
      ),
    );
  }

  async updateContextApplication(
    contextId: string,
    request: UpdateContextApplicationRequest,
  ): Promise<void> {
    await this.httpClient.post(`/admin-api/contexts/${contextId}/application`, request);
  }

  async getContextsWithExecutorsForApplication(applicationId: string): Promise<ContextsWithExecutorsResponseData> {
    return unwrap(
      await this.httpClient.get<{ data: ContextsWithExecutorsResponseData }>(
        `/admin-api/contexts/with-executors/for-application/${applicationId}`,
      ),
    );
  }

  // ---- Blob Management ----

  async uploadBlob(data: UploadBlobRequest): Promise<UploadBlobResponseData> {
    return unwrap(await this.httpClient.put<{ data: UploadBlobResponseData }>('/admin-api/blobs', data));
  }

  async deleteBlob(blobId: string): Promise<DeleteBlobResponseData> {
    return unwrap(await this.httpClient.delete<{ data: DeleteBlobResponseData }>(`/admin-api/blobs/${blobId}`));
  }

  async listBlobs(): Promise<ListBlobsResponseData> {
    return unwrap(await this.httpClient.get<{ data: ListBlobsResponseData }>('/admin-api/blobs'));
  }

  async getBlob(blobId: string): Promise<GetBlobResponseData> {
    return unwrap(await this.httpClient.get<{ data: GetBlobResponseData }>(`/admin-api/blobs/${blobId}`));
  }

  // ---- Alias Management ----

  async createContextAlias(request: CreateAliasRequest): Promise<CreateAliasResponseData> {
    return unwrap(await this.httpClient.post<{ data: CreateAliasResponseData }>('/admin-api/alias/create/context', request));
  }

  async createApplicationAlias(request: CreateAliasRequest): Promise<CreateAliasResponseData> {
    return unwrap(await this.httpClient.post<{ data: CreateAliasResponseData }>('/admin-api/alias/create/application', request));
  }

  async lookupContextAlias(name: string): Promise<LookupAliasResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: LookupAliasResponseData }>(
        `/admin-api/alias/lookup/context/${encodeURIComponent(name)}`,
        {},
      ),
    );
  }

  async lookupApplicationAlias(name: string): Promise<LookupAliasResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: LookupAliasResponseData }>(
        `/admin-api/alias/lookup/application/${encodeURIComponent(name)}`,
        {},
      ),
    );
  }

  async deleteContextAlias(name: string): Promise<DeleteAliasResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: DeleteAliasResponseData }>(
        `/admin-api/alias/delete/context/${encodeURIComponent(name)}`,
        {},
      ),
    );
  }

  async deleteApplicationAlias(name: string): Promise<DeleteAliasResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: DeleteAliasResponseData }>(
        `/admin-api/alias/delete/application/${encodeURIComponent(name)}`,
        {},
      ),
    );
  }

  async listContextAliases(): Promise<ListAliasesResponseData> {
    return unwrap(await this.httpClient.get<{ data: ListAliasesResponseData }>('/admin-api/alias/list/context'));
  }

  async listApplicationAliases(): Promise<ListAliasesResponseData> {
    return unwrap(await this.httpClient.get<{ data: ListAliasesResponseData }>('/admin-api/alias/list/application'));
  }

  // ---- Context Identity Aliases ----

  async listContextIdentityAliases(contextId: string): Promise<ListContextIdentityAliasesResponseData> {
    return unwrap(
      await this.httpClient.get<{ data: ListContextIdentityAliasesResponseData }>(
        `/admin-api/alias/list/identity/${contextId}`,
      ),
    );
  }

  async createContextIdentityAlias(
    contextId: string,
    request: CreateAliasRequest,
  ): Promise<CreateContextIdentityAliasResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: CreateContextIdentityAliasResponseData }>(
        `/admin-api/alias/create/identity/${contextId}`,
        request,
      ),
    );
  }

  async lookupContextIdentityAlias(
    contextId: string,
    name: string,
  ): Promise<LookupContextIdentityAliasResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: LookupContextIdentityAliasResponseData }>(
        `/admin-api/alias/lookup/identity/${contextId}/${encodeURIComponent(name)}`,
        {},
      ),
    );
  }

  async deleteContextIdentityAlias(
    contextId: string,
    name: string,
  ): Promise<DeleteContextIdentityAliasResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: DeleteContextIdentityAliasResponseData }>(
        `/admin-api/alias/delete/identity/${contextId}/${encodeURIComponent(name)}`,
        {},
      ),
    );
  }

  // ---- Namespace Management ----

  async listNamespaces(): Promise<ListNamespacesResponseData> {
    return unwrap(await this.httpClient.get<{ data: ListNamespacesResponseData }>('/admin-api/namespaces'));
  }

  async getNamespace(namespaceId: string): Promise<Namespace> {
    return unwrap(await this.httpClient.get<{ data: Namespace }>(`/admin-api/namespaces/${namespaceId}`));
  }

  async getNamespaceIdentity(namespaceId: string): Promise<NamespaceIdentity> {
    return unwrap(await this.httpClient.get<{ data: NamespaceIdentity }>(`/admin-api/namespaces/${namespaceId}/identity`));
  }

  async listNamespacesForApplication(applicationId: string): Promise<ListNamespacesResponseData> {
    return unwrap(await this.httpClient.get<{ data: ListNamespacesResponseData }>(`/admin-api/namespaces/for-application/${applicationId}`));
  }

  async createNamespace(request: CreateNamespaceRequest): Promise<CreateNamespaceResponseData> {
    return unwrap(await this.httpClient.post<{ data: CreateNamespaceResponseData }>('/admin-api/namespaces', request));
  }

  async deleteNamespace(
    namespaceId: string,
    request?: DeleteNamespaceRequest,
  ): Promise<DeleteNamespaceResponseData> {
    return unwrap(
      await this.httpClient.request<{ data: DeleteNamespaceResponseData }>(`/admin-api/namespaces/${namespaceId}`, {
        method: 'DELETE',
        body: request ? JSON.stringify(request) : undefined,
        headers: request ? { 'Content-Type': 'application/json' } : undefined,
      }),
    );
  }

  async createNamespaceInvitation(
    namespaceId: string,
    request?: CreateNamespaceInvitationRequest,
  ): Promise<CreateNamespaceInvitationResponseData | CreateRecursiveInvitationResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: CreateNamespaceInvitationResponseData | CreateRecursiveInvitationResponseData }>(
        `/admin-api/namespaces/${namespaceId}/invite`,
        request ?? {},
      ),
    );
  }

  async joinNamespace(
    namespaceId: string,
    request: JoinNamespaceRequest,
  ): Promise<JoinNamespaceResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: JoinNamespaceResponseData }>(
        `/admin-api/namespaces/${namespaceId}/join`,
        request,
        { timeoutMs: 65000 },
      ),
    );
  }

  async createGroupInNamespace(
    namespaceId: string,
    request?: CreateGroupInNamespaceRequest,
  ): Promise<CreateGroupInNamespaceResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: CreateGroupInNamespaceResponseData }>(
        `/admin-api/namespaces/${namespaceId}/groups`,
        request ?? {},
      ),
    );
  }

  async listNamespaceGroups(namespaceId: string): Promise<SubgroupEntry[]> {
    return unwrap(await this.httpClient.get<{ data: SubgroupEntry[] }>(`/admin-api/namespaces/${namespaceId}/groups`));
  }

  // ---- Group Management ----

  async getGroupInfo(groupId: string): Promise<GroupInfoResponseData> {
    return unwrap(await this.httpClient.get<{ data: GroupInfoResponseData }>(`/admin-api/groups/${groupId}`));
  }

  /** Thin wrapper over {@link getGroupInfo}: returns the group's `defaultCapabilities` bitmask. */
  async getDefaultCapabilities(groupId: string): Promise<number> {
    return (await this.getGroupInfo(groupId)).defaultCapabilities;
  }

  /** Thin wrapper over {@link getGroupInfo}: returns the group's `subgroupVisibility`. */
  async getSubgroupVisibility(groupId: string): Promise<string> {
    return (await this.getGroupInfo(groupId)).subgroupVisibility;
  }

  async deleteGroup(groupId: string, request?: DeleteGroupRequest): Promise<DeleteGroupResponseData> {
    if (request) {
      return unwrap(
        await this.httpClient.request<{ data: DeleteGroupResponseData }>(`/admin-api/groups/${groupId}`, {
          method: 'DELETE',
          body: JSON.stringify(request),
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    return unwrap(await this.httpClient.delete<{ data: DeleteGroupResponseData }>(`/admin-api/groups/${groupId}`));
  }

  async listGroupMembers(groupId: string): Promise<ListGroupMembersResponseData> {
    const response = await this.httpClient.get<ListGroupMembersResponseData>(
      `/admin-api/groups/${groupId}/members`,
    );
    // Validate the field we declare as non-optional in the type so a
    // contract-violating response (proxy error body, future API drift,
    // etc.) surfaces as a clear error rather than silently producing an
    // empty list. Empty groups still satisfy this — merod returns
    // `members: []`, not an omitted field.
    if (!Array.isArray(response?.members)) {
      // Sanitize before interpolation: groupId reaches us from caller code,
      // not parsed input, but defending the message keeps untrusted bytes
      // out of error logs and downstream UIs.
      const safeId = String(groupId).replace(/[\r\n\t\s]/g, '').slice(0, 64);
      throw new Error(
        `Invalid listGroupMembers response for group ${safeId}: missing or non-array \`members\` field`,
      );
    }
    return response;
  }

  async listGroupContexts(groupId: string): Promise<ListGroupContextsResponseData> {
    return unwrap(await this.httpClient.get<{ data: ListGroupContextsResponseData }>(`/admin-api/groups/${groupId}/contexts`));
  }

  async addGroupMembers(groupId: string, request: AddGroupMembersRequest): Promise<void> {
    await this.httpClient.post(`/admin-api/groups/${groupId}/members`, request);
  }

  async removeGroupMembers(groupId: string, request: RemoveGroupMembersRequest): Promise<void> {
    await this.httpClient.post(`/admin-api/groups/${groupId}/members/remove`, request);
  }

  async updateMemberRole(
    groupId: string,
    identity: string,
    request: UpdateMemberRoleRequest,
  ): Promise<void> {
    await this.httpClient.put(`/admin-api/groups/${groupId}/members/${identity}/role`, request);
  }

  async getMemberCapabilities(groupId: string, identity: string): Promise<MemberCapabilities> {
    return unwrap(
      await this.httpClient.get<{ data: MemberCapabilities }>(
        `/admin-api/groups/${groupId}/members/${identity}/capabilities`,
      ),
    );
  }

  async setMemberCapabilities(
    groupId: string,
    identity: string,
    request: SetMemberCapabilitiesRequest,
  ): Promise<void> {
    await this.httpClient.put(`/admin-api/groups/${groupId}/members/${identity}/capabilities`, request);
  }

  async setDefaultCapabilities(
    groupId: string,
    request: SetDefaultCapabilitiesRequest,
  ): Promise<void> {
    await this.httpClient.put(`/admin-api/groups/${groupId}/settings/default-capabilities`, request);
  }

  async setSubgroupVisibility(
    groupId: string,
    request: SetSubgroupVisibilityRequest,
  ): Promise<void> {
    await this.httpClient.put(`/admin-api/groups/${groupId}/settings/subgroup-visibility`, request);
  }

  async setTeeAdmissionPolicy(
    groupId: string,
    request: SetTeeAdmissionPolicyRequest,
  ): Promise<void> {
    await this.httpClient.put(`/admin-api/groups/${groupId}/settings/tee-admission-policy`, request);
  }

  async updateGroupSettings(
    groupId: string,
    request: UpdateGroupSettingsRequest,
  ): Promise<void> {
    await this.httpClient.patch(`/admin-api/groups/${groupId}`, request);
  }

  // ---- Group / member / context metadata ----

  async setGroupMetadata(groupId: string, request: SetGroupMetadataRequest): Promise<void> {
    await this.httpClient.put(`/admin-api/groups/${groupId}/metadata`, request);
  }

  async getGroupMetadata(groupId: string): Promise<MetadataRecord | null> {
    return unwrap(await this.httpClient.get<{ data: GetMetadataResponseData }>(`/admin-api/groups/${groupId}/metadata`)).data;
  }

  async setMemberMetadata(
    groupId: string,
    identity: string,
    request: SetMemberMetadataRequest,
  ): Promise<void> {
    await this.httpClient.put(`/admin-api/groups/${groupId}/members/${identity}/metadata`, request);
  }

  async getMemberMetadata(groupId: string, identity: string): Promise<MetadataRecord | null> {
    return unwrap(
      await this.httpClient.get<{ data: GetMetadataResponseData }>(`/admin-api/groups/${groupId}/members/${identity}/metadata`),
    ).data;
  }

  async setContextMetadata(
    groupId: string,
    contextId: string,
    request: SetContextMetadataRequest,
  ): Promise<void> {
    await this.httpClient.put(`/admin-api/groups/${groupId}/contexts/${contextId}/metadata`, request);
  }

  async getContextMetadata(groupId: string, contextId: string): Promise<MetadataRecord | null> {
    return unwrap(
      await this.httpClient.get<{ data: GetMetadataResponseData }>(`/admin-api/groups/${groupId}/contexts/${contextId}/metadata`),
    ).data;
  }

  async syncGroup(groupId: string, request?: SyncGroupRequest): Promise<SyncGroupResponseData> {
    return unwrap(await this.httpClient.post<{ data: SyncGroupResponseData }>(`/admin-api/groups/${groupId}/sync`, request ?? {}));
  }

  async registerGroupSigningKey(
    groupId: string,
    request: RegisterGroupSigningKeyRequest,
  ): Promise<RegisterGroupSigningKeyResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: RegisterGroupSigningKeyResponseData }>(
        `/admin-api/groups/${groupId}/signing-key`,
        request,
      ),
    );
  }

  async upgradeGroup(groupId: string, request: UpgradeGroupRequest): Promise<UpgradeGroupResponseData> {
    return unwrap(await this.httpClient.post<{ data: UpgradeGroupResponseData }>(`/admin-api/groups/${groupId}/upgrade`, request));
  }

  async getGroupUpgradeStatus(groupId: string): Promise<GroupUpgradeStatusResponseData> {
    return unwrap(
      await this.httpClient.get<{ data: GroupUpgradeStatusResponseData }>(`/admin-api/groups/${groupId}/upgrade/status`),
    );
  }

  async retryGroupUpgrade(
    groupId: string,
    request?: RetryGroupUpgradeRequest,
  ): Promise<RetryGroupUpgradeResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: RetryGroupUpgradeResponseData }>(
        `/admin-api/groups/${groupId}/upgrade/retry`,
        request ?? {},
      ),
    );
  }

  async nestGroup(parentGroupId: string, request: NestGroupRequest): Promise<void> {
    await this.httpClient.post(`/admin-api/groups/${parentGroupId}/nest`, request);
  }

  async unnestGroup(parentGroupId: string, request: UnnestGroupRequest): Promise<void> {
    await this.httpClient.post(`/admin-api/groups/${parentGroupId}/unnest`, request);
  }

  async listSubgroups(groupId: string): Promise<SubgroupEntry[]> {
    return unwrap(await this.httpClient.get<{ data: SubgroupEntry[] }>(`/admin-api/groups/${groupId}/subgroups`));
  }

  async detachContextFromGroup(
    groupId: string,
    contextId: string,
    request?: DetachContextFromGroupRequest,
  ): Promise<void> {
    await this.httpClient.post(`/admin-api/groups/${groupId}/contexts/${contextId}/remove`, request ?? {});
  }

  // ---- Group Invitation & Join ----

  async createGroupInvitation(
    groupId: string,
    request?: CreateGroupInvitationRequest,
  ): Promise<CreateGroupInvitationResponseData | CreateRecursiveGroupInvitationResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: CreateGroupInvitationResponseData | CreateRecursiveGroupInvitationResponseData }>(
        `/admin-api/groups/${groupId}/invite`,
        request ?? {},
      ),
    );
  }

  async joinGroup(request: JoinGroupRequest): Promise<JoinGroupResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: JoinGroupResponseData }>('/admin-api/groups/join', request),
    );
  }

  async joinSubgroupInheritance(groupId: string): Promise<JoinSubgroupInheritanceResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: JoinSubgroupInheritanceResponseData }>(
        `/admin-api/groups/${groupId}/join-via-inheritance`,
        {},
      ),
    );
  }

  // ---- TEE ----

  async getTeeInfo(): Promise<TeeInfoResponseData> {
    return unwrap(await this.httpClient.get<{ data: TeeInfoResponseData }>('/admin-api/tee/info'));
  }

  async teeAttest(request: TeeAttestRequest): Promise<TeeAttestResponseData> {
    return unwrap(await this.httpClient.post<{ data: TeeAttestResponseData }>('/admin-api/tee/attest', request));
  }

  async teeVerifyQuote(request: TeeVerifyQuoteRequest): Promise<TeeVerifyQuoteResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: TeeVerifyQuoteResponseData }>('/admin-api/tee/verify-quote', request),
    );
  }

  // ---- Network ----

  async getPeersCount(): Promise<{ count: number }> {
    return this.httpClient.get<{ count: number }>('/admin-api/peers');
  }
}
