// Admin API Types — aligned with merod server routes

// Re-export shared types
export { ApiResponse } from '../http-client';

// ---- Health and Status ----

export interface HealthStatus {
  status: string;
}

export interface AdminAuthStatus {
  data: { status: string };
}

// ---- Applications ----

export interface InstallApplicationRequest {
  url: string;
  hash?: string;
  metadata: number[];
}

export interface InstallDevApplicationRequest {
  path: string;
  metadata: unknown[];
}

export interface InstallApplicationResponseData {
  applicationId: string;
}

export interface UninstallApplicationResponseData {
  applicationId: string;
}

export interface Application {
  id: string;
  blob: { bytecode: string; compiled: string };
  size: number;
  source: string;
  metadata: number[];
  signer_id: string;
  package: string;
  version: string;
}

export interface ListApplicationsResponseData {
  apps: Application[];
}

export interface GetApplicationResponseData {
  application: Application | null;
}

// ---- Packages ----

export interface GetLatestVersionResponseData {
  applicationId: string | null;
  version: string | null;
}

// ---- Contexts ----

export interface CreateContextRequest {
  applicationId: string;
  groupId: string;
  serviceName?: string;
  contextSeed?: string;
  initializationParams?: number[];
  protocol?: string;
}

export interface CreateContextResponseData {
  contextId: string;
  memberPublicKey: string;
}

export interface DeleteContextResponseData {
  isDeleted: boolean;
}

export interface Context {
  id: string;
  applicationId: string;
  serviceName?: string;
  rootHash: string;
  dagHeads: number[][];
}

export interface GetContextsResponseData {
  contexts: Context[];
}

// ---- Context Identity ----

export interface GenerateContextIdentityResponseData {
  publicKey: string;
}

export interface GetContextIdentitiesResponseData {
  identities: string[];
}

// ---- Context join (group membership; POST /contexts/:id/join) ----

export interface JoinContextResponseData {
  contextId: string;
  memberPublicKey: string;
}

// ---- Blobs ----

export interface UploadBlobRequest {
  data: Uint8Array | ArrayBuffer;
}

export interface UploadBlobResponseData {
  blobId?: string;
  hash?: string;
  size?: number;
}

export interface DeleteBlobResponseData {
  success: boolean;
}

export interface BlobEntry {
  blobId?: string;
  hash?: string;
  size?: number;
  createdAt?: number;
}

export type ListBlobsResponseData = BlobEntry[];

export type GetBlobResponseData = BlobEntry;

// ---- Aliases ----

export interface CreateAliasRequest {
  name: string;
  value: string;
}

export interface AliasEntry {
  name: string;
  value: string;
}

export interface ListAliasesResponseData {
  aliases: AliasEntry[];
}

export interface CreateAliasResponseData {
  success?: boolean;
  name?: string;
  value?: string;
}

export interface LookupAliasResponseData {
  name?: string;
  value?: string;
}

export interface DeleteAliasResponseData {
  success?: boolean;
  name?: string;
}

// ---- Namespaces ----

export interface Namespace {
  namespaceId: string;
  appKey: string;
  targetApplicationId: string;
  upgradePolicy: string;
  createdAt: number;
  alias?: string;
  memberCount: number;
  contextCount: number;
  subgroupCount: number;
}

export type ListNamespacesResponseData = Namespace[];

export interface NamespaceIdentity {
  namespaceId: string;
  publicKey: string;
}

export interface CreateNamespaceRequest {
  applicationId: string;
  namespaceId?: string;
  appKey?: string;
  upgradePolicy?: string;
  alias?: string;
}

export interface CreateNamespaceResponseData {
  namespaceId: string;
}

export interface DeleteNamespaceRequest {
  force?: boolean;
}

export interface DeleteNamespaceResponseData {
  isDeleted: boolean;
}

export interface CreateNamespaceInvitationRequest {
  validForSeconds?: number;
}

export interface CreateNamespaceInvitationResponseData {
  invitation: string;
}

export interface JoinNamespaceRequest {
  invitation: string;
  namespaceAlias?: string;
}

export interface JoinNamespaceResponseData {
  namespaceId: string;
}

export interface CreateGroupInNamespaceRequest {
  groupId?: string;
  alias?: string;
}

export interface CreateGroupInNamespaceResponseData {
  groupId: string;
}

export interface SubgroupEntry {
  groupId: string;
  alias?: string;
}

export interface SubscribeNamespaceResponseData {
  namespaceId: string;
  subscribed: boolean;
}

// ---- Groups ----

export interface CreateGroupRequest {
  applicationId: string;
  groupId?: string;
  appKey?: string;
  upgradePolicy?: string;
  alias?: string;
  parentGroupId?: string;
}

export interface CreateGroupResponseData {
  groupId: string;
}

export interface GroupSummary {
  groupId: string;
  appKey: string;
  targetApplicationId: string;
  upgradePolicy: string;
  createdAt: number;
  alias?: string;
}

export type ListGroupsResponseData = GroupSummary[];

export interface GroupInfo {
  groupId: string;
  appKey: string;
  targetApplicationId: string;
  upgradePolicy: string;
  createdAt: number;
  alias?: string;
  memberCount: number;
  contextCount: number;
}

export type GroupInfoResponseData = GroupInfo;

export interface GroupMember {
  identity: string;
  role: string;
  alias?: string;
}

export interface ListGroupMembersResponseData {
  data: GroupMember[];
  selfIdentity?: string;
}

export interface GroupContextEntry {
  contextId: string;
  alias?: string;
}

export type ListGroupContextsResponseData = GroupContextEntry[];

export interface CreateGroupInvitationRequest {
  validForSeconds?: number;
}

export interface JoinGroupRequest {
  invitation: unknown;
  groupAlias?: string;
}

export interface DeleteGroupResponseData {
  isDeleted: boolean;
}

// ---- Group Members ----

export interface AddGroupMembersRequest {
  identities: string[];
  role?: string;
}

export interface AddGroupMembersResponseData {
  added: string[];
}

export interface RemoveGroupMembersRequest {
  identities: string[];
}

export interface RemoveGroupMembersResponseData {
  removed: string[];
}

export interface UpdateMemberRoleRequest {
  role: string;
}

export interface UpdateMemberRoleResponseData {
  identity: string;
  role: string;
}

// ---- Group Capabilities & Settings ----

export interface MemberCapabilities {
  identity: string;
  capabilities: string[];
}

export interface SetMemberCapabilitiesRequest {
  capabilities: string[];
}

export interface SetMemberCapabilitiesResponseData {
  identity: string;
  capabilities: string[];
}

export interface SetDefaultCapabilitiesRequest {
  capabilities: string[];
}

export interface SetDefaultCapabilitiesResponseData {
  capabilities: string[];
}

export interface SetDefaultVisibilityRequest {
  visibility: string;
}

export interface SetDefaultVisibilityResponseData {
  visibility: string;
}

export interface SetTeeAdmissionPolicyRequest {
  policy: string;
}

export interface SetTeeAdmissionPolicyResponseData {
  policy: string;
}

export interface UpdateGroupSettingsRequest {
  alias?: string;
  upgradePolicy?: string;
}

export interface UpdateGroupSettingsResponseData {
  groupId: string;
}

export interface SetGroupAliasRequest {
  alias: string;
}

export interface SetGroupAliasResponseData {
  alias: string;
}

export interface SetMemberAliasRequest {
  alias: string;
}

export interface SetMemberAliasResponseData {
  identity: string;
  alias: string;
}

// ---- Group Sync, Signing & Upgrades ----

export interface SyncGroupRequest {
  force?: boolean;
}

export interface SyncGroupResponseData {
  groupId: string;
  synced: boolean;
}

export interface RegisterGroupSigningKeyRequest {
  key: string;
}

export interface RegisterGroupSigningKeyResponseData {
  keyId?: string;
  registered: boolean;
}

export interface UpgradeGroupRequest {
  targetVersion?: string;
}

export interface UpgradeGroupResponseData {
  operationId?: string;
  started: boolean;
}

export interface GroupUpgradeStatusResponseData {
  status: string;
  error?: string;
}

export interface RetryGroupUpgradeRequest {
  force?: boolean;
}

export interface RetryGroupUpgradeResponseData {
  operationId?: string;
  started: boolean;
}

// ---- Group Nesting & Context Attachments ----

export interface NestGroupRequest {
  childGroupId: string;
}

export interface NestGroupResponseData {
  parentGroupId: string;
  childGroupId: string;
}

export interface UnnestGroupRequest {
  childGroupId: string;
}

export interface UnnestGroupResponseData {
  parentGroupId: string;
  childGroupId: string;
}

export interface DetachContextFromGroupRequest {
  reason?: string;
}

export interface DetachContextFromGroupResponseData {
  contextId: string;
  removed: boolean;
}

// ---- Additional Context Routes ----

export interface ContextGroupResponseData {
  groupId: string;
  alias?: string;
}

export interface ContextStorageResponseData {
  usageBytes: number;
  limitBytes?: number;
}

export interface SyncContextResponseData {
  contextId?: string;
  synced: boolean;
}

export interface InviteSpecializedNodeRequest {
  contextId: string;
  nodePublicKey: string;
}

export interface InviteSpecializedNodeResponseData {
  invited: boolean;
}

export interface UpdateContextApplicationRequest {
  applicationId: string;
}

export interface UpdateContextApplicationResponseData {
  contextId: string;
  applicationId: string;
}

export interface ContextWithExecutors {
  contextId: string;
  executors: string[];
}

export type ContextsWithExecutorsResponseData = ContextWithExecutors[];

// ---- Context identity aliases ----

export type ListContextIdentityAliasesResponseData = ListAliasesResponseData;

export interface CreateContextIdentityAliasResponseData {
  success?: boolean;
  name?: string;
  value?: string;
}

export interface LookupContextIdentityAliasResponseData {
  name?: string;
  value?: string;
}

export interface DeleteContextIdentityAliasResponseData {
  success?: boolean;
  name?: string;
}

// ---- TEE ----

export interface TeeInfoResponseData {
  enabled: boolean;
  mode?: string;
}

export interface TeeAttestRequest {
  payload: string;
}

export interface TeeAttestResponseData {
  quote: string;
}

export interface TeeVerifyQuoteRequest {
  quote: string;
  payload?: string;
}

export interface TeeVerifyQuoteResponseData {
  valid: boolean;
}

// ---- Client Configuration ----

export interface AdminApiClientConfig {
  baseUrl: string;
  getAuthToken?: () => Promise<string | undefined>;
  timeoutMs?: number;
}
