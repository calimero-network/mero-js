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
