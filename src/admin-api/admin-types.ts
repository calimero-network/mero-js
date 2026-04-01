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

export interface ListNamespacesResponseData {
  data: Namespace[];
}

export interface NamespaceIdentity {
  namespaceId: string;
  publicKey: string;
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

export interface ListGroupsResponseData {
  data: GroupSummary[];
}

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

export interface GroupInfoResponseData {
  data: GroupInfo;
}

export interface GroupMember {
  identity: string;
  role: string;
  alias?: string;
}

export interface ListGroupMembersResponseData {
  data: { members: GroupMember[] };
}

export interface GroupContextEntry {
  contextId: string;
  alias?: string;
}

export interface ListGroupContextsResponseData {
  data: GroupContextEntry[];
}

export interface CreateGroupInvitationRequest {
  validForSeconds?: number;
}

export interface JoinGroupRequest {
  invitation: unknown;
  groupAlias?: string;
}

export interface JoinGroupContextRequest {
  contextId: string;
}

export interface JoinGroupContextResponseData {
  contextId: string;
  memberPublicKey: string;
}

// ---- Client Configuration ----

export interface AdminApiClientConfig {
  baseUrl: string;
  getAuthToken?: () => Promise<string | undefined>;
  timeoutMs?: number;
}
