// Admin API Types — aligned with core server routes
// All types use camelCase to match core's #[serde(rename_all = "camelCase")]

// Re-export shared types
export { ApiResponse } from '../http-client/index.js';

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

export interface ApplicationBlob {
  bytecode: string;
  compiled: string;
}

export interface Application {
  id: string;
  blob: ApplicationBlob;
  size: number;
  source: string;
  metadata: number[];
  /** Absent for a raw-wasm install (no signed bundle) and for bootstrap stubs. */
  signer_id?: string;
  /** Absent on a bootstrap stub row, written before the app's blob arrives. */
  package?: string;
  /** Absent when the stored version is empty or not valid semver. */
  version?: string;
  /** Named services of a multi-service bundle; absent for single-service apps. */
  services?: Record<string, ApplicationBlob>;
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

/** The application's `wasm-abi/1` manifest, returned verbatim by the node. */
export type GetApplicationAbiResponseData = Record<string, unknown>;

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
 * ABI state version the migrate targets (from `#[app::state(version = N)]`,
 * the engine's gate) — NOT the bundle semver, which is `toVersion`, the
 * user-facing string an admin matches on; `method` is the migrate entrypoint.
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
  /** Optional human-readable label for the context. */
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
  /** Absent while the context has no deltas yet (core omits an empty list). */
  dagHeads?: number[][];
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

export interface GetBlobInfoResponseData extends BlobInfo {
  hash?: string;
  mimeType?: string;
}

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

/**
 * Core's `ListAliasesResponse` is `{ data: BTreeMap<Alias<T>, T> }`, so once the
 * `data` envelope is stripped the payload is a flat `{ alias: id }` map — not a
 * list of entries. Applies to context and application aliases.
 */
export type ListAliasesResponseData = Record<string, string>;

// Create/delete alias returns empty
export type CreateAliasResponseData = Record<string, never>;
export type DeleteAliasResponseData = Record<string, never>;

export interface LookupAliasResponseData {
  value?: string;
}

// ---- Shared invitation types ----

/**
 * The signed half of an invitation. Wire keys are snake_case: this type mirrors
 * a core primitive (`calimero_context_config::types`), which carries no
 * camelCase rename — unlike the admin DTOs that wrap it.
 */
export interface GroupInvitationFromAdmin {
  readonly inviter_identity: number[];
  readonly group_id: number[];
  readonly expiration_timestamp: number;
  /** Per-invitation nonce; core keeps the legacy `secret_salt` wire name. */
  readonly secret_salt: number[];
  readonly invited_role: number;
}

/**
 * An invitation blob the node signed. **Opaque: pass it through unchanged.**
 *
 * `inviter_signature` covers `invitation`, and the trailing bootstrap fields
 * (`application_id`, `app_key`) are needed by the joiner even though they sit
 * outside the signature — so a value that has been rebuilt field-by-field is
 * not the value the node signed. Rebuilding is what a schema derived from these
 * declarations does: an object schema drops the keys it wasn't told about, and
 * core may add more (both trailing fields were added this way). Carry the value
 * verbatim from the call that produced it to {@link JoinGroupRequest}, and treat
 * the fields below as read-only detail for display.
 *
 * The `never`-typed brand makes that structural: an object literal or a schema
 * result cannot satisfy this type, while a value the SDK returned — or one
 * recovered with `JSON.parse` after transport — still does.
 */
export interface SignedGroupOpenInvitation {
  readonly invitation: GroupInvitationFromAdmin;
  readonly inviter_signature: string;
  /**
   * The account the inviter acts as, as 64 hex characters — not the bs58 the
   * `inviter_identity` key inside the signed body is written in. Governance
   * rows name accounts, and a joiner cannot derive this one: an account is a
   * hash of a root it has never seen.
   *
   * Unsigned bootstrap field, and outside the signature deliberately — a
   * client that round-trips an invitation through its own typed model would
   * drop an unknown field and invalidate the signature with it. Absent on
   * invitations from older nodes.
   */
  readonly inviter_account?: string;
  /** Unsigned bootstrap field; absent on invitations from older nodes. */
  readonly application_id?: number[];
  /** Unsigned bootstrap field; absent on invitations from older nodes. */
  readonly app_key?: number[];
  /** @internal Brand — never present at runtime, never write it. */
  readonly __nodeSigned: never;
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
  /**
   * Absent from nodes that have dropped the concept, always `"LazyOnAccess"` on
   * every released one. Optional because this SDK talks to both; it carries no
   * information either way. Delete once no supported release still sends it.
   */
  upgradePolicy?: string;
  createdAt: number;
  name?: string;
  memberCount: number;
  contextCount: number;
  subgroupCount: number;
  /**
   * Bundle version of this namespace's `appKey` blob — the per-namespace truth,
   * where the application row only says "latest fetched". Absent when core
   * cannot resolve it (raw-wasm app, legacy key, blob not retained locally).
   */
  appVersion?: string;
}

export type ListNamespacesResponseData = Namespace[];

/**
 * Who this node is: the account it writes as, the device it is, and the key it
 * signs with.
 *
 * Every field is node-level. One root key means one account, everywhere, and a
 * node signs with one key — so none of this varies by namespace, which is why
 * the endpoint behind it takes none.
 */
export interface NodeIdentity {
  /**
   * The account this node writes as, 64 hex characters. This — not
   * `publicKey` — is what member-addressing endpoints take, and what
   * `listGroupMembers` entries are keyed by, so it is how a caller locates
   * itself in a member list.
   */
  accountId: string;
  /**
   * The device this node is, 64 hex characters, or `null` before it has
   * enrolled anywhere.
   *
   * `null` is a real answer rather than a missing one: the account id above
   * exists as soon as the node has a root, and enrolment — which a join
   * performs — is what adds the device that speaks for it.
   */
  deviceId: string | null;
  /**
   * The key this node signs ops with, base58.
   *
   * The device's signing key, not the account root: the root signs
   * certificates and never an op, so a signature on the wire verifies against
   * this one.
   */
  publicKey: string;
  /**
   * The epoch-0 root **public** key of this node's account, 64 hex characters.
   *
   * What a second device needs to pair into this account, and public by
   * construction — it is hashed into `accountId` and travels in every genesis.
   * The private root never leaves the node over HTTP.
   *
   * Optional because a node at or below `0.11.0-rc.22` does not send it: the
   * field landed after that release. Required in the type would make this SDK
   * claim something the node the caller chose may not report.
   */
  accountRootPublicKey?: string;
}

/**
 * @deprecated Use {@link AdminApiClient.getNodeIdentity} instead. Nothing here
 * varies by namespace, so the parameter could only ever be decoration.
 */
export interface NamespaceIdentity {
  /** Echoed back from the argument; it does not describe the identity. */
  namespaceId: string;
  /** The key this node signs with, base58. */
  publicKey: string;
  /**
   * The account this node writes as, 64 hex characters. This — not
   * `publicKey` — is what member-addressing endpoints take, and what
   * `listGroupMembers` entries are keyed by, so it is how a caller locates
   * itself in a member list.
   */
  account: string;
}

export interface CreateNamespaceRequest {
  applicationId: string;
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
  /**
   * The namespace that was joined.
   *
   * core `0.11.0-rc.25` renamed this field on the wire from `groupId`
   * (core#3598). The endpoint had been sharing a response DTO with
   * `POST /admin-api/groups/join`, which leaked the internal "a namespace is a
   * root group" detail into the namespace API and meant a caller could not use
   * one spelling across the family.
   *
   * {@link AdminClient.joinNamespace} fills this in from whichever spelling the
   * node sent, so it is populated against nodes on either side of that release.
   */
  namespaceId: string;
  /**
   * @deprecated The pre-`0.11.0-rc.25` spelling of {@link namespaceId}. Present
   * only when the node predates that release — read `namespaceId` instead,
   * which is always set.
   */
  groupId?: string;
  /** The key the joiner signs with, base58. */
  memberIdentity: string;
  /**
   * The account that key joined as, 64 hex characters. This — not
   * `memberIdentity` — is what every member-addressing endpoint takes, so it
   * is how the caller addresses the member it just became.
   */
  memberAccount: string;
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
  /** Contexts THIS NODE enumerated for the upgrade. Node-local; fleet progress
   * is the `getMigrationStatus` rollup. */
  localContextsTotal?: number;
  localContextsSwapped?: number;
  /** Contexts whose swap failed on this node; a non-zero value is what
   * `retryGroupUpgrade` picks up. */
  localContextsFailed?: number;
  /** Unix seconds at which THIS NODE finished its own context swaps. Not fleet
   * convergence - that is `MigrationStatus.fleetCompletedAt`. */
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
  /** ABI state version the member has loaded, from `#[app::state(version = N)]` -
   * the engine's migration gate, not the bundle semver and not a CRDT concept.
   * The wrong reading here is how the core rollup defect (comparing bundle-semver
   * majors instead of state versions) went unnoticed. */
  schemaVersion: number;
  residueAuto: number;
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
  /** Governance HLC the cohort was pinned at, as an opaque display string.
   * Absent when there is no migration record. */
  cohortPinnedAtHlc?: string;
  /** Unix seconds at which this node watched the FLEET converge, absent while it
   * has not. Distinct from `GroupUpgradeStatus.completedAt`, which is this node's
   * own local swap completion. Durable, unlike `rollup.allMigrated`, which is
   * recomputed from in-TTL heartbeats and lapses when a member goes quiet. */
  fleetCompletedAt?: number;
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
  /**
   * Absent from nodes that have dropped the concept, always `"LazyOnAccess"` on
   * every released one. Optional because this SDK talks to both; it carries no
   * information either way. Delete once no supported release still sends it.
   */
  upgradePolicy?: string;
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
  /**
   * The member's ACCOUNT: 64 hex characters.
   *
   * Not a signing key, which renders as bs58 — a person may hold several keys
   * and governance rows name the person. Both are 32 bytes, so nothing here or
   * on the server will object if you pass the wrong one; it will simply name a
   * principal that exists nowhere. Feed this value to
   * {@link RemoveGroupMembersRequest} and {@link UpdateMemberRoleRequest}, not
   * to {@link GroupMemberInput}.
   */
  identity: string;
  role: string;
  name?: string;
}

export interface ListGroupMembersResponseData {
  members: GroupMember[];
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
  /**
   * The invitee's signing KEY, in bs58 — NOT an account.
   *
   * Adding is the one member-facing call that names a key: the node binds the
   * key to an account as it admits it, so before that there is no account to
   * name. Every call that names an EXISTING member takes the account instead.
   */
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
  /**
   * The members to remove, as ACCOUNTS (64 hex) — the same ids
   * {@link GroupMember.identity} returns, and not the keys
   * {@link GroupMemberInput.identity} took to add them.
   */
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

export interface GetTeeAdmissionPolicyResponseData {
  allowedMrtd: string[];
  allowedRtmr0: string[];
  allowedRtmr1: string[];
  allowedRtmr2: string[];
  allowedRtmr3: string[];
  allowedTcbStatuses: string[];
  acceptMock: boolean;
}

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

export interface UpgradeGroupRequest {
  targetApplicationId: string;
  requester?: string;
  /** Fan the upgrade out to every descendant subgroup running the same app
   *  (one atomic cascade op). Without it the upgrade applies to the target
   *  group only - members' subgroups never learn the migration. Server
   *  default: false. */
  cascade?: boolean;
  /** Proceed code-only when the target build embeds no ABI. Core refuses such an
   *  upgrade by default; setting this asserts the new code is layout-compatible
   *  with the running state so the upgrade goes ahead. It never bypasses a
   *  declared-migration or downgrade refusal. Wire name is camelCase passthrough;
   *  older nodes ignore the unknown field. Server default: false. */
  forceCodeOnly?: boolean;
}

export interface UpgradeGroupResponseData {
  groupId: string;
  status: string;
  localContextsTotal?: number;
  localContextsSwapped?: number;
  localContextsFailed?: number;
}

export type GroupUpgradeStatusResponseData = GroupUpgradeStatus | null;

export interface RetryGroupUpgradeRequest {
  requester?: string;
}

// Retry returns same shape as upgrade
export type RetryGroupUpgradeResponseData = UpgradeGroupResponseData;

// ---- Group Reparent & Context Attachments ----

export interface ReparentGroupRequest {
  /** 64-char id of the destination parent group. */
  newParentId: string;
  requester?: string;
}

export interface ReparentGroupResponseData {
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
  /** The key the joiner signs with, base58. */
  memberIdentity: string;
  /**
   * The account that key joined as, 64 hex characters. This — not
   * `memberIdentity` — is what every member-addressing endpoint takes, so it
   * is how the caller addresses the member it just became.
   */
  memberAccount: string;
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
