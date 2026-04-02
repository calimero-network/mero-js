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
  contextSeed?: string;
  initializationParams?: number[];
  protocol?: string;
  groupId?: string;
  identitySecret?: string;
  alias?: string;
}

export interface CreateContextResponseData {
  contextId: string;
  memberPublicKey: string;
  groupId?: string;
  groupCreated?: boolean;
}

export interface DeleteContextResponseData {
  isDeleted: boolean;
}

export interface Context {
  id: string;
  applicationId: string;
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

// ---- Context Invite / Join ----

export interface InvitationFromMember {
  inviter_identity: string;
  context_id: string;
  expiration_timestamp: number;
  secret_salt: number[];
}

export interface SignedOpenInvitation {
  invitation: InvitationFromMember;
  inviter_signature: string;
  application_id?: number[];
  blob_id?: number[];
  source?: string;
  group_id?: number[];
}

export interface InviteToContextRequest {
  contextId: string;
  inviterId: string;
  validForSeconds: number;
}

export interface JoinContextRequest {
  invitation: SignedOpenInvitation;
  newMemberPublicKey: string;
}

export interface JoinContextResponseData {
  contextId: string;
  memberPublicKey: string;
}

// ---- Groups ----

export type GroupMemberRole = 'Admin' | 'Member' | 'ReadOnly';

export interface GroupInvitationFromAdmin {
  inviter_identity: number[] | string;
  group_id: number[] | string;
  expiration_timestamp: number;
  secret_salt?: number[] | Uint8Array;
}

export interface SignedGroupOpenInvitation {
  invitation: GroupInvitationFromAdmin;
  inviter_signature: string;
}

export interface GroupSummary {
  groupId: string;
  appKey: string;
  targetApplicationId: string;
  upgradePolicy: string;
  createdAt: number;
  alias?: string;
}

export interface GroupUpgradeStatus {
  fromVersion: string;
  toVersion: string;
  initiatedAt: number;
  initiatedBy: string;
  status: string;
  total?: number;
  completed?: number;
  failed?: number;
  completedAt?: number;
}

export interface GroupInfo extends Omit<GroupSummary, 'createdAt'> {
  memberCount: number;
  contextCount: number;
  activeUpgrade?: GroupUpgradeStatus;
  defaultCapabilities: number;
  defaultVisibility: string;
  alias?: string;
}

export interface GroupMember {
  identity: string;
  role: GroupMemberRole;
  alias?: string;
}

export interface GroupContext {
  contextId: string;
  alias?: string;
}

export interface CreateGroupRequest {
  groupId?: string;
  appKey?: string;
  applicationId: string;
  upgradePolicy: string;
  parentGroupId?: string;
  alias?: string;
}

export interface CreateGroupResponseData {
  groupId: string;
}

export interface DeleteGroupRequest {
  requester?: string;
}

export interface DeleteGroupResponseData {
  isDeleted: boolean;
}

export interface AddGroupMembersRequest {
  members: Array<{ identity: string; role: GroupMemberRole }>;
  requester?: string;
}

export interface RemoveGroupMembersRequest {
  members: string[];
  requester?: string;
}

export interface ListGroupMembersResponseData {
  data: GroupMember[];
  selfIdentity?: string;
}

export interface CreateGroupInvitationRequest {
  requester?: string;
  expirationTimestamp?: number;
}

export interface CreateGroupInvitationResponseData {
  invitation: SignedGroupOpenInvitation;
  groupAlias?: string;
}

export interface JoinGroupRequest {
  invitation: SignedGroupOpenInvitation;
  groupAlias?: string;
}

export interface JoinGroupResponseData {
  groupId: string;
  memberIdentity: string;
}

export interface MemberCapabilities {
  capabilities: number;
}

export interface SyncGroupRequest {
  requester?: string;
}

export interface SyncGroupResponseData {
  groupId: string;
  appKey: string;
  targetApplicationId: string;
  memberCount: number;
  contextCount: number;
}

// ---- Blobs ----

export interface UploadBlobRequest {
  data: Uint8Array | ArrayBuffer;
}

export interface DeleteBlobResponseData {
  success: boolean;
}

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

// ---- Group Governance / Settings ----

export type ContextVisibilityMode = 'open' | 'restricted';

export interface SetDefaultCapabilitiesRequest {
  defaultCapabilities: number;
  requester?: string;
}

export interface SetDefaultVisibilityRequest {
  defaultVisibility: ContextVisibilityMode;
  requester?: string;
}

export interface ContextVisibilityData {
  mode: string;
  creator: string;
}

export interface SetContextVisibilityRequest {
  mode: ContextVisibilityMode;
  requester?: string;
}

export interface ManageContextAllowlistRequest {
  add?: string[];
  remove?: string[];
  requester?: string;
}

export interface UpdateMemberRoleRequest {
  role: GroupMemberRole;
  requester?: string;
}

// ---- Group Upgrade ----

export interface UpgradeGroupRequest {
  targetApplicationId: string;
  requester?: string;
  migrateMethod?: string;
}

export interface UpgradeGroupResponseData {
  groupId: string;
  status: string;
  total?: number;
  completed?: number;
  failed?: number;
}

export interface RetryGroupUpgradeRequest {
  requester?: string;
}

// ---- Group / Member Alias ----

export interface SetGroupAliasRequest {
  alias: string;
  requester?: string;
}

export interface SetMemberAliasRequest {
  alias: string;
  requester?: string;
}

// ---- Group Update ----

export interface UpdateGroupRequest {
  requester?: string;
  upgradePolicy: string;
}

// ---- Remove Context from Group ----

export interface RemoveContextFromGroupRequest {
  requester?: string;
}

// ---- Signing Key ----

export interface RegisterSigningKeyRequest {
  signingKey: string;
}

export interface RegisterSigningKeyResponseData {
  publicKey: string;
}

// ---- Context Storage ----

export interface GetContextStorageResponseData {
  sizeInBytes: number;
}

// ---- Client Configuration ----

export interface AdminApiClientConfig {
  baseUrl: string;
  getAuthToken?: () => Promise<string | undefined>;
  timeoutMs?: number;
}
