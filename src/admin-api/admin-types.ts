// Admin API Types — aligned with core server routes
// All types use camelCase to match core's #[serde(rename_all = "camelCase")]

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
  package?: string;
  version?: string;
}

export interface InstallDevApplicationRequest {
  path: string;
  metadata: number[];
  package?: string;
  version?: string;
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

/** One installed blob for an application (distinct from the package registry). */
export interface ApplicationVersionEntry {
  version: string;
  blobId: string;
  size: number;
  package: string;
}

export interface ListApplicationVersionsResponseData {
  data: ApplicationVersionEntry[];
}

// ---- Packages ----

export interface GetLatestVersionResponseData {
  applicationId: string | null;
  version: string | null;
}

export interface ListPackagesResponseData {
  packages: string[];
}

export interface ListVersionsResponseData {
  versions: string[];
}

// ---- Bundle migration metadata ----

/**
 * Per-service migration descriptor carried in a multi-service bundle manifest,
 * emitted from the app's `#[app::migrate]` declaration. `toSchemaVersion` is the
 * CRDT schema version the migrate targets (the engine's gate); `toVersion` is
 * the user-facing bundle semver an admin matches on; `method` is the migrate
 * entrypoint.
 */
export interface BundleMigration {
  method: string;
  toSchemaVersion: number;
  toVersion?: string;
}

/**
 * The subset of a registry bundle manifest that `installFromRegistry` consumes
 * to resolve an artifact URL. The registry serves it at
 * `GET {registry}/api/v2/bundles/{package}/{version}`.
 */
export interface RegistryBundleManifest {
  package: string;
  appVersion: string;
  /** Present when this bundle's app declares a migration. */
  migration?: BundleMigration;
}

// ---- Contexts ----

export interface CreateContextRequest {
  applicationId: string;
  groupId: string;
  serviceName?: string;
  contextSeed?: string;
  initializationParams?: number[];
  identitySecret?: string;
  /**
   * Optional human-readable label for the context. Core's `CreateContextRequest`
   * field is `name` (camelCase wire key) — there is no `groupName`/`alias` field,
   * so any other key is silently dropped by the node.
   */
  name?: string;
}

export interface CreateContextResponseData {
  contextId: string;
  memberPublicKey: string;
  groupId?: string;
  groupCreated?: boolean;
}

export interface DeleteContextRequest {
  requester?: string;
}

export interface DeleteContextResponseData {
  isDeleted: boolean;
}

export interface Context {
  id: string;
  applicationId: string;
  serviceName?: string;
  /**
   * Context state/root hash. Core's wire key is `contextStateHash` (part of the
   * cross-DAG auth three-level naming: contextStateHash / groupStateHash /
   * namespaceStateHash). Renamed from `rootHash`, which never populated.
   */
  contextStateHash: string;
  dagHeads: number[][];
  /** Bundle semver of the installed application (skew #2). Absent on older nodes. */
  applicationVersion?: string;
}

export interface ContextWithGroup extends Context {
  groupId?: string;
}

export interface GetContextsResponseData {
  contexts: ContextWithGroup[];
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

// ---- Open subgroup join via inheritance (POST /groups/:group_id/join-via-inheritance) ----

export interface JoinSubgroupInheritanceResponseData {
  groupId: string;
  memberPublicKey: string;
  // `true` if the call had to publish a `MemberJoinedOpen` op to materialise
  // inherited membership; `false` if the caller was already a direct member
  // and the call was a no-op.
  wasInherited: boolean;
}

// ---- Context group / storage / sync ----

export type ContextGroupResponseData = string | null;

export interface ContextStorageResponseData {
  sizeInBytes: number;
}

// Sync context returns empty
export type SyncContextResponseData = null;

// ---- Specialized Node Invite ----

export interface InviteSpecializedNodeRequest {
  contextId: string;
  inviterId?: string;
}

export interface InviteSpecializedNodeResponseData {
  nonce: string;
}

// ---- Update Context Application ----

export interface UpdateContextApplicationRequest {
  applicationId: string;
  executorPublicKey: string;
}

// Update context application returns empty
export type UpdateContextApplicationResponseData = Record<string, never>;

// ---- Resync Context ----

export interface ResyncContextRequest {
  /** Force a full re-pull even if the context is not detected as stranded. */
  force?: boolean;
}

export interface ResyncContextResponseData {
  contextId: string;
  resyncStarted: boolean;
}

// ---- Contexts With Executors ----

export interface ContextWithExecutors {
  contextId: string;
  executors: string[];
}

export type ContextsWithExecutorsResponseData = ContextWithExecutors[];

// ---- Blobs ----

export interface UploadBlobRequest {
  /** Raw blob bytes; streamed verbatim as the request body (octet-stream). */
  data: Uint8Array | ArrayBuffer | Blob;
  /** Optional expected blob hash; sent as the `hash` query param for server-side verification. */
  hash?: string;
  /** Optional context to announce the blob to; sent as the `context_id` query param. */
  contextId?: string;
}

export interface BlobInfo {
  blobId: string;
  size: number;
}

export type UploadBlobResponseData = BlobInfo;

export interface DeleteBlobResponseData {
  blobId: string;
  deleted: boolean;
}

export interface ListBlobsResponseData {
  blobs: BlobInfo[];
}

export type GetBlobResponseData = BlobInfo;

// ---- Aliases ----

// Core's CreateAliasRequest is `{ alias, #[serde(flatten)] value }`, so each
// alias kind flattens a different id field at the top level of the body.
export interface CreateContextAliasRequest {
  alias: string;
  contextId: string;
}

export interface CreateApplicationAliasRequest {
  alias: string;
  applicationId: string;
}

export interface CreateContextIdentityAliasRequest {
  alias: string;
  identity: string;
}

export interface AliasEntry {
  name: string;
  value: string;
}

export interface ListAliasesResponseData {
  aliases: AliasEntry[];
}

// Create/delete alias returns empty
export type CreateAliasResponseData = Record<string, never>;
export type DeleteAliasResponseData = Record<string, never>;

export interface LookupAliasResponseData {
  value?: string;
}

// ---- Context identity aliases ----

export type ListContextIdentityAliasesResponseData = ListAliasesResponseData;
export type CreateContextIdentityAliasResponseData = Record<string, never>;

export interface LookupContextIdentityAliasResponseData {
  value?: string;
}

export type DeleteContextIdentityAliasResponseData = Record<string, never>;

// ---- Shared invitation types ----

export interface GroupInvitationFromAdmin {
  inviterIdentity: number[];
  groupId: number[];
  expirationTimestamp: number;
  secretSalt: number[];
  invitedRole?: number;
}

export interface SignedGroupOpenInvitation {
  invitation: GroupInvitationFromAdmin;
  inviterSignature: string;
}

export interface RecursiveInvitationEntry {
  groupId: string;
  invitation: SignedGroupOpenInvitation;
  groupName?: string;
}

// ---- Namespaces ----

export interface Namespace {
  namespaceId: string;
  appKey: string;
  targetApplicationId: string;
  upgradePolicy: string;
  createdAt: number;
  name?: string;
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
  upgradePolicy: string;
  name?: string;
  /** Hex 32-byte blob id; pins the namespace to a specific installed version. */
  appKey?: string;
}

export interface CreateNamespaceResponseData {
  namespaceId: string;
}

export interface DeleteNamespaceRequest {
  requester?: string;
}

export interface DeleteNamespaceResponseData {
  isDeleted: boolean;
}

export interface CreateNamespaceInvitationRequest {
  requester?: string;
  expirationTimestamp?: number;
  recursive?: boolean;
}

export interface CreateNamespaceInvitationResponseData {
  invitation: SignedGroupOpenInvitation;
  groupName?: string;
}

export interface CreateRecursiveInvitationResponseData {
  invitations: RecursiveInvitationEntry[];
}

export interface JoinNamespaceRequest {
  invitation: SignedGroupOpenInvitation;
  groupName?: string;
}

export interface JoinNamespaceResponseData {
  groupId: string;
  memberIdentity: string;
  governanceOp: string;
}

export interface CreateGroupInNamespaceRequest {
  groupId?: string;
  name?: string;
}

export interface CreateGroupInNamespaceResponseData {
  groupId: string;
}

export interface SubgroupEntry {
  groupId: string;
  name?: string;
}

// ---- Groups ----

export interface CreateGroupRequest {
  applicationId: string;
  upgradePolicy: string;
  groupId?: string;
  appKey?: string;
  name?: string;
  parentGroupId?: string;
}

export interface CreateGroupResponseData {
  groupId: string;
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

// ---- Migration status (migration-UX core surfaces) ----

export type MemberMigrationState =
  | 'migrated'
  | 'in_progress'
  | 'unknown'
  | 'failed';

/** Why a member's migration did not complete. */
export type MigrationFailureReason =
  | 'check_aborted'
  | 'apply_failed'
  | 'no_migration_path';

export interface MemberMigrationReport {
  schemaVersion: number;
  residueAuto: number;
  residueIdentity: number;
  syncedUpToHlc: number;
  reportedAt: number;
  /** Member's self-reported pending-authored count (best-effort; skew #1). */
  authoredRemaining: number;
  /**
   * Set when the member's migrate did not complete (its migration-check
   * aborted, or the apply errored). Absent otherwise.
   */
  migrationFailed?: MigrationFailureReason;
}

export interface MemberMigrationStatusEntry {
  peer: string;
  /** Freshest reported facts, or `null` when the member's state is `unknown`. */
  report: MemberMigrationReport | null;
  state: MemberMigrationState;
}

export interface MigrationStatusRollup {
  migrated: number;
  inProgress: number;
  unknown: number;
  /** Members whose migrate aborted (migration-check failed or apply errored). */
  failed: number;
  total: number;
  allMigrated: boolean;
  /** Count of members with authoredRemaining > 0 (owners still to re-sign). */
  membersPendingSignature: number;
}

export interface MigrationStatus {
  targetVersion: number;
  expectedMembers: number;
  cohortPinnedAtHlc?: string;
  rollup: MigrationStatusRollup;
  members: MemberMigrationStatusEntry[];
}

// ---- Cascade status ----

export interface CascadeStatusEntry {
  groupId: string;
  upgrade: GroupUpgradeStatus;
  cascadeHlc?: string;
}

export interface GroupInfo {
  groupId: string;
  appKey: string;
  targetApplicationId: string;
  upgradePolicy: string;
  memberCount: number;
  contextCount: number;
  activeUpgrade?: GroupUpgradeStatus;
  defaultCapabilities: number;
  subgroupVisibility: string;
  /**
   * The group's generic metadata record (replaces the old `alias` field).
   * `null` if no metadata has ever been set for this group.
   */
  metadata?: MetadataRecord | null;
}

export type GroupInfoResponseData = GroupInfo;

export interface GroupMember {
  identity: string;
  role: string;
  name?: string;
}

export interface ListGroupMembersResponseData {
  members: GroupMember[];
  selfIdentity?: string;
  /**
   * @deprecated The server response uses `members`, not `data`. This alias
   * is retained so existing callers compile during the upgrade window; it
   * is never populated by the client and will be removed in the next
   * major. Switch reads to `response.members`.
   */
  data?: GroupMember[];
}

export interface GroupContextEntry {
  contextId: string;
  name?: string;
}

export type ListGroupContextsResponseData = GroupContextEntry[];

export interface DeleteGroupRequest {
  requester?: string;
}

export interface DeleteGroupResponseData {
  isDeleted: boolean;
}

// ---- Group Members ----

export interface GroupMemberInput {
  identity: string;
  role: string;
}

export interface AddGroupMembersRequest {
  members: GroupMemberInput[];
  requester?: string;
}

// Returns empty
export type AddGroupMembersResponseData = Record<string, never>;

export interface RemoveGroupMembersRequest {
  members: string[];
  requester?: string;
}

// Returns empty
export type RemoveGroupMembersResponseData = Record<string, never>;

export interface UpdateMemberRoleRequest {
  role: string;
  requester?: string;
}

// Returns empty
export type UpdateMemberRoleResponseData = Record<string, never>;

// ---- Group Capabilities & Settings ----

export interface MemberCapabilities {
  capabilities: number;
}

export interface SetMemberCapabilitiesRequest {
  capabilities: number;
  requester?: string;
}

// Returns empty
export type SetMemberCapabilitiesResponseData = Record<string, never>;

export interface SetDefaultCapabilitiesRequest {
  defaultCapabilities: number;
  requester?: string;
}

// Returns empty
export type SetDefaultCapabilitiesResponseData = Record<string, never>;

export interface SetSubgroupVisibilityRequest {
  subgroupVisibility: string;
  requester?: string;
}

// Returns empty
export type SetSubgroupVisibilityResponseData = Record<string, never>;

export interface SetTeeAdmissionPolicyRequest {
  allowedMrtd: string[];
  allowedRtmr0: string[];
  allowedRtmr1: string[];
  allowedRtmr2: string[];
  allowedRtmr3: string[];
  allowedTcbStatuses: string[];
  acceptMock: boolean;
  requester?: string;
}

// Returns empty
export type SetTeeAdmissionPolicyResponseData = Record<string, never>;

export interface UpdateGroupSettingsRequest {
  upgradePolicy: string;
  requester?: string;
}

// Returns empty
export type UpdateGroupSettingsResponseData = Record<string, never>;

// ---- Group / member / context metadata ----

/**
 * Generic metadata record attached to a group, group member, or
 * context-registered-in-a-group (core `calimero_primitives::metadata::MetadataRecord`).
 *
 * `data` is application-defined and opaque to core — it is stored verbatim.
 * Server-enforced size limits: `name` <= 64 bytes; at most 64 entries in
 * `data`; each key <= 64 bytes; each value <= 4096 bytes. Clients do not need
 * to enforce these — the server validates.
 */
export interface MetadataRecord {
  name: string | null;
  data: Record<string, string>;
  updatedAt: number;
  /** Public key (hex) of the member that last updated the record. */
  updatedBy: string;
}

/**
 * Request body for setting a metadata record. **This wholly replaces the
 * record**: `data` defaults to `{}` server-side and replaces the stored map,
 * while omitting `name` keeps the current name. To change `name` while
 * preserving existing `data`, GET the record first and pass its `data` back.
 */
export interface SetMetadataRequest {
  name?: string;
  data?: Record<string, string>;
  requester?: string;
}

export type SetGroupMetadataRequest = SetMetadataRequest;
export type SetMemberMetadataRequest = SetMetadataRequest;
export type SetContextMetadataRequest = SetMetadataRequest;

// Set-metadata returns empty
export type SetMetadataResponseData = Record<string, never>;

/**
 * Inner payload of a GET metadata response. `data` is `null` if no metadata
 * has ever been set for the target group/member/context.
 */
export interface GetMetadataResponseData {
  data: MetadataRecord | null;
}

// ---- Group Sync, Signing & Upgrades ----

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

export interface RegisterGroupSigningKeyRequest {
  signingKey: string;
}

export interface RegisterGroupSigningKeyResponseData {
  publicKey: string;
}

export interface UpgradeGroupRequest {
  targetApplicationId: string;
  requester?: string;
  /** Fan the upgrade out to every descendant subgroup running the same app
   *  (one atomic cascade op). Without it the upgrade applies to the target
   *  group only — members' subgroups never learn the migration. Server
   *  default: false. */
  cascade?: boolean;
}

export interface UpgradeGroupResponseData {
  groupId: string;
  status: string;
  total?: number;
  completed?: number;
  failed?: number;
}

export type GroupUpgradeStatusResponseData = GroupUpgradeStatus | null;

export interface RetryGroupUpgradeRequest {
  requester?: string;
}

// Retry returns same shape as upgrade
export type RetryGroupUpgradeResponseData = UpgradeGroupResponseData;

// ---- Group Reparent & Context Attachments ----

/**
 * Atomically move a group under a new parent. Replaces the old nest/unnest pair
 * (core `ReparentGroupApiRequest`): the child being moved is passed in the URL
 * path, and `newParentId` is the destination parent. Orphan state is structurally
 * impossible. `newParentId` must be a 64-char group id.
 */
export interface ReparentGroupRequest {
  newParentId: string;
  /** Optional explicit requester; the authenticated identity takes precedence. */
  requester?: string;
}

export interface ReparentGroupResponseData {
  /** False when the group was already under `newParentId` (the op was a no-op). */
  reparented: boolean;
}

export interface DetachContextFromGroupRequest {
  requester?: string;
}

// Returns empty
export type DetachContextFromGroupResponseData = Record<string, never>;

// ---- Group Invitation & Join ----

export interface CreateGroupInvitationRequest {
  requester?: string;
  expirationTimestamp?: number;
  recursive?: boolean;
}

export interface CreateGroupInvitationResponseData {
  invitation: SignedGroupOpenInvitation;
  groupName?: string;
}

export interface CreateRecursiveGroupInvitationResponseData {
  invitations: RecursiveInvitationEntry[];
}

export interface JoinGroupRequest {
  invitation: SignedGroupOpenInvitation;
  groupName?: string;
}

export interface JoinGroupResponseData {
  groupId: string;
  memberIdentity: string;
  governanceOp: string;
}

// ---- TEE ----

export interface TeeInfoResponseData {
  cloudProvider: string;
  osImage: string;
  mrtd: string;
}

export interface TeeAttestRequest {
  nonce: string;
  applicationId?: string;
}

export interface QuoteHeader {
  version: number;
  attestationKeyType: number;
  teeType: number;
  qeVendorId: string;
  userData: string;
}

export interface QuoteBody {
  tdxVersion: string;
  teeTcbSvn: string;
  mrseam: string;
  mrsignerseam: string;
  seamattributes: string;
  tdattributes: string;
  xfam: string;
  mrtd: string;
  mrconfigid: string;
  mrowner: string;
  mrownerconfig: string;
  rtmr0: string;
  rtmr1: string;
  rtmr2: string;
  rtmr3: string;
  reportdata: string;
  teeTcbSvn2?: string;
  mrservicetd?: string;
}

export interface Quote {
  header: QuoteHeader;
  body: QuoteBody;
  signature: string;
  attestationKey: string;
  certificationData: unknown;
}

export interface TeeAttestResponseData {
  quoteB64: string;
  quote: Quote;
}

export interface TeeVerifyQuoteRequest {
  quoteB64: string;
  nonce: string;
  expectedApplicationHash?: string;
}

export interface TeeVerifyQuoteResponseData {
  quoteVerified: boolean;
  nonceVerified: boolean;
  applicationHashVerified?: boolean;
  quote: Quote;
}

// ---- Client Configuration ----

export interface AdminApiClientConfig {
  baseUrl: string;
  getAuthToken?: () => Promise<string | undefined>;
  timeoutMs?: number;
}
