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

export interface InviteToContextRequest {
  contextId: string;
  inviterId: string;
  validForSeconds: number;
}

export interface JoinContextRequest {
  invitation: unknown;
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

// ---- Client Configuration ----

export interface AdminApiClientConfig {
  baseUrl: string;
  getAuthToken?: () => Promise<string | undefined>;
  timeoutMs?: number;
}
