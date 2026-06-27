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
  ApplicationVersionEntry,
  GetLatestVersionResponseData,
  ListPackagesResponseData,
  ListVersionsResponseData,
  RegistryBundleManifest,
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
  ResyncContextRequest,
  ResyncContextResponseData,
  ContextsWithExecutorsResponseData,
  UploadBlobRequest,
  UploadBlobResponseData,
  DeleteBlobResponseData,
  ListBlobsResponseData,
  GetBlobInfoResponseData,
  CreateContextAliasRequest,
  CreateApplicationAliasRequest,
  CreateContextIdentityAliasRequest,
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
  GetTeeAdmissionPolicyResponseData,
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
  MigrationStatus,
  CascadeStatusEntry,
  RetryGroupUpgradeRequest,
  RetryGroupUpgradeResponseData,
  ReparentGroupRequest,
  ReparentGroupResponseData,
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
 * This extracts `.data` so callers get the inner payload directly. Null-safe so an
 * empty 2xx body (parsed as null) yields undefined instead of throwing.
 */
function unwrap<T>(response: { data: T }): T {
  return response?.data as T;
}

/**
 * Compare two dotted version strings, ascending: negative if `a < b`, positive
 * if `a > b`, `0` if equal. Components are compared numerically when both parse
 * as integers (so `1.10.0 > 1.9.0`), else lexically; a missing component is `0`.
 * Minimal by design — sufficient for the `major.minor.patch` registry versions.
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const sa = pa[i] ?? '0';
    const sb = pb[i] ?? '0';
    const na = Number.parseInt(sa, 10);
    const nb = Number.parseInt(sb, 10);
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      const c = sa.localeCompare(sb);
      if (c !== 0) return c;
    } else if (na !== nb) {
      return na - nb;
    }
  }
  return 0;
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

  /**
   * Resolve a `package@version` to its registry artifact URL and install it.
   * Node install is URL-based (no node-side package+version resolution), so this
   * fetches the bundle manifest from the registry, derives the `.mpk` artifact
   * URL, then calls {@link installApplication}. `registryUrl` is the registry
   * origin. This is the discrete "download" step an Updates flow pairs with a
   * subsequent `upgradeGroup`.
   */
  async installFromRegistry(
    registryUrl: string,
    packageName: string,
    version: string,
  ): Promise<InstallApplicationResponseData> {
    const base = new URL(registryUrl).origin;
    const manifestUrl = new URL(
      `/api/v2/bundles/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`,
      base,
    ).toString();
    const resp = await fetch(manifestUrl);
    if (!resp.ok) {
      throw new Error(
        `registry manifest fetch failed (${resp.status}) for ${packageName}@${version}`,
      );
    }
    const bundle = (await resp.json()) as RegistryBundleManifest;
    // Encode the path segments — the package/version come from a (best-effort
    // trusted) registry response, so guard against odd characters breaking or
    // traversing the artifact path. For normal ids/semvers this is a no-op.
    const pkg = encodeURIComponent(bundle.package);
    const ver = encodeURIComponent(bundle.appVersion);
    const artifactUrl = `${base}/artifacts/${pkg}/${ver}/${pkg}-${ver}.mpk`;
    return this.installApplication({
      url: artifactUrl,
      package: bundle.package,
      version: bundle.appVersion,
      metadata: [],
    });
  }

  /**
   * List a package's published versions from the registry, newest-first by
   * semver. Reads the registry's V2 bundle listing
   * (`GET {registry}/api/v2/bundles?package={package}`), taking each bundle's
   * `appVersion`. Registry-side data — distinct from the node's
   * installed-version list — and the source an Updates view compares against
   * the running `Context.applicationVersion` to detect "a new version exists".
   */
  async getRegistryVersions(registryUrl: string, packageName: string): Promise<string[]> {
    const url = new URL('/api/v2/bundles', new URL(registryUrl).origin);
    url.searchParams.set('package', packageName);
    const resp = await fetch(url.toString());
    if (!resp.ok) {
      throw new Error(
        `registry versions fetch failed (${resp.status}) for ${packageName}`,
      );
    }
    const bundles = (await resp.json()) as RegistryBundleManifest[];
    return (Array.isArray(bundles) ? bundles : [])
      .map((b) => b.appVersion)
      .filter((v): v is string => typeof v === 'string')
      .sort((a, b) => compareSemver(b, a));
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

  /**
   * Installed-blob inventory for an application — one entry per locally installed
   * version. This is the *installed* inventory (source for a "pick a version to
   * pin" UI); the registry equivalent is `listPackageVersions`.
   */
  async listApplicationVersions(applicationId: string): Promise<ApplicationVersionEntry[]> {
    return unwrap(
      await this.httpClient.get<{ data: ApplicationVersionEntry[] }>(`/admin-api/applications/${applicationId}/versions`),
    );
  }

  // ---- Package Management ----

  async listPackages(): Promise<ListPackagesResponseData> {
    // Core returns this flat ({ packages: [...] }), not under `data`; tolerate both.
    const r = await this.httpClient.get<ListPackagesResponseData & { data?: ListPackagesResponseData }>(
      '/admin-api/packages',
    );
    return (r?.data ?? r) as ListPackagesResponseData;
  }

  async listPackageVersions(packageName: string): Promise<ListVersionsResponseData> {
    // Core returns this flat ({ versions: [...] }), not under `data`; tolerate both.
    const r = await this.httpClient.get<ListVersionsResponseData & { data?: ListVersionsResponseData }>(
      `/admin-api/packages/${encodeURIComponent(packageName)}/versions`,
    );
    return (r?.data ?? r) as ListVersionsResponseData;
  }

  async getLatestPackageVersion(packageName: string): Promise<GetLatestVersionResponseData> {
    return this.httpClient.get<GetLatestVersionResponseData>(
      `/admin-api/packages/${encodeURIComponent(packageName)}/latest`,
    );
  }

  // ---- Context Management ----

  async createContext(request: CreateContextRequest): Promise<CreateContextResponseData> {
    // Core requires `initializationParams` (no default); default it to an empty
    // byte array so callers that pass none don't get a 400.
    const body = { ...request, initializationParams: request.initializationParams ?? [] };
    return unwrap(await this.httpClient.post<{ data: CreateContextResponseData }>('/admin-api/contexts', body));
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

  /**
   * Kick off a full state re-pull for a context (operator recovery for a
   * stranded context). `force` re-pulls even when the node does not flag the
   * context as stranded.
   */
  async resyncContext(
    contextId: string,
    request: ResyncContextRequest = {},
  ): Promise<ResyncContextResponseData> {
    // Core's `ResyncContextApiResponse` is a flat payload (no inner `data`
    // field), so parse the body directly — do NOT `unwrap`, or `resyncStarted`
    // reads as undefined and the resync silently appears to never start.
    const r = await this.httpClient.post<ResyncContextResponseData | null>(
      `/admin-api/contexts/${contextId}/resync`,
      request,
    );
    // An empty 2xx body means the resync was accepted; synthesize the result so
    // callers always get a typed value instead of null.
    return r ?? { contextId, resyncStarted: true };
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
    // Core returns this flat as { contexts: [...] } (not a bare array under `data`).
    const r = await this.httpClient.get<
      | ContextsWithExecutorsResponseData
      | { contexts: ContextsWithExecutorsResponseData }
      | { data: ContextsWithExecutorsResponseData }
    >(`/admin-api/contexts/with-executors/for-application/${applicationId}`);
    if (Array.isArray(r)) return r;
    return (
      (r as { contexts?: ContextsWithExecutorsResponseData } | null)?.contexts ??
      (r as { data?: ContextsWithExecutorsResponseData } | null)?.data ??
      []
    );
  }

  // ---- Blob Management ----

  async uploadBlob(request: UploadBlobRequest): Promise<UploadBlobResponseData> {
    // Core streams the raw request body into blob storage (no JSON) and takes
    // its params from the query string (`hash`, `context_id` — snake_case).
    const params = new URLSearchParams();
    if (request.hash) params.set('hash', request.hash);
    if (request.contextId) params.set('context_id', request.contextId);
    const query = params.toString();
    const path = query ? `/admin-api/blobs?${query}` : '/admin-api/blobs';
    // request.data (Uint8Array view | ArrayBuffer | Blob) is a valid BodyInit and
    // is streamed verbatim — no JSON, no cast. fetch honors a Uint8Array view's
    // byteOffset/byteLength, so subarrays upload the correct region.
    // Core's BlobInfo is snake_case (`blob_id`); map to camelCase like deleteBlob.
    const res = unwrap(
      await this.httpClient.request<{ data: { blob_id: string; size: number } }>(path, {
        method: 'PUT',
        body: request.data,
        headers: { 'Content-Type': 'application/octet-stream' },
      }),
    );
    return { blobId: res.blob_id, size: res.size };
  }

  async deleteBlob(blobId: string): Promise<DeleteBlobResponseData> {
    // Core's `BlobDeleteResponse` is a flat, snake_case payload (`{ blob_id,
    // deleted }`) — the lone admin DTO without a camelCase rename and without an
    // inner `data` field. Parse directly (no `unwrap`) and map to camelCase.
    const body = await this.httpClient.delete<{ blob_id: string; deleted: boolean }>(
      `/admin-api/blobs/${blobId}`,
    );
    return { blobId: body.blob_id, deleted: body.deleted };
  }

  async listBlobs(): Promise<ListBlobsResponseData> {
    // Core's BlobInfo is snake_case (`blob_id`); map to camelCase.
    const res = unwrap(
      await this.httpClient.get<{ data: { blobs: Array<{ blob_id: string; size: number }> } }>(
        '/admin-api/blobs',
      ),
    );
    return { blobs: res.blobs.map((b) => ({ blobId: b.blob_id, size: b.size })) };
  }

  /**
   * Download a blob's raw bytes. `GET /admin-api/blobs/:id` streams the blob
   * content (e.g. `application/gzip`), NOT JSON — so fetch it as an ArrayBuffer.
   * Use {@link listBlobs} for `{ blobId, size }` metadata.
   */
  async getBlob(blobId: string): Promise<ArrayBuffer> {
    return this.httpClient.get<ArrayBuffer>(`/admin-api/blobs/${blobId}`, {
      parse: 'arrayBuffer',
    });
  }

  /**
   * Fetch a blob's metadata without downloading it. `HEAD /admin-api/blobs/:id`
   * returns the info in response headers (size via `content-length`, plus
   * `x-blob-id`/`x-blob-hash`/`x-blob-mime-type`).
   */
  async getBlobInfo(blobId: string): Promise<GetBlobInfoResponseData> {
    // HEAD throws (HttpError) on a non-2xx status, so we only reach here on success
    // — the x-blob-* headers are present. Guard size against a missing/non-numeric
    // content-length anyway (defaults to 0 rather than NaN).
    const { headers } = await this.httpClient.head(`/admin-api/blobs/${blobId}`);
    const size = Number(headers['content-length']);
    return {
      blobId: headers['x-blob-id'] ?? blobId,
      size: Number.isFinite(size) ? size : 0,
      hash: headers['x-blob-hash'],
      mimeType: headers['x-blob-mime-type'],
    };
  }

  // ---- Alias Management ----

  async createContextAlias(
    request: CreateContextAliasRequest,
  ): Promise<CreateAliasResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: CreateAliasResponseData }>(
        '/admin-api/alias/create/context',
        { alias: request.alias, contextId: request.contextId },
      ),
    );
  }

  async createApplicationAlias(
    request: CreateApplicationAliasRequest,
  ): Promise<CreateAliasResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: CreateAliasResponseData }>(
        '/admin-api/alias/create/application',
        { alias: request.alias, applicationId: request.applicationId },
      ),
    );
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
    request: CreateContextIdentityAliasRequest,
  ): Promise<CreateContextIdentityAliasResponseData> {
    return unwrap(
      await this.httpClient.post<{ data: CreateContextIdentityAliasResponseData }>(
        `/admin-api/alias/create/identity/${contextId}`,
        { alias: request.alias, identity: request.identity },
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
    // Core returns this endpoint flat ({ namespaceId, publicKey }), not under
    // `data`. Tolerate both so it works whether or not the envelope is present.
    const r = await this.httpClient.get<NamespaceIdentity & { data?: NamespaceIdentity }>(
      `/admin-api/namespaces/${namespaceId}/identity`,
    );
    return (r?.data ?? r) as NamespaceIdentity;
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
    // Core requires `Content-Type: application/json` on this DELETE even when the
    // body is empty, so always send the header and a (possibly empty) JSON body.
    return unwrap(
      await this.httpClient.request<{ data: DeleteNamespaceResponseData }>(`/admin-api/namespaces/${namespaceId}`, {
        method: 'DELETE',
        body: JSON.stringify(request ?? {}),
        headers: { 'Content-Type': 'application/json' },
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
    // Core requires `Content-Type: application/json` on this DELETE even with an
    // empty body, so always send the header and a (possibly empty) JSON body.
    return unwrap(
      await this.httpClient.request<{ data: DeleteGroupResponseData }>(`/admin-api/groups/${groupId}`, {
        method: 'DELETE',
        body: JSON.stringify(request ?? {}),
        headers: { 'Content-Type': 'application/json' },
      }),
    );
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

  async getTeeAdmissionPolicy(groupId: string): Promise<GetTeeAdmissionPolicyResponseData> {
    // Intersection (not union) so the type is unambiguous: `data` is optional, so
    // `?? response` cleanly falls back to a flat (un-enveloped) response.
    const response = await this.httpClient.get<
      GetTeeAdmissionPolicyResponseData & { data?: GetTeeAdmissionPolicyResponseData }
    >(`/admin-api/groups/${groupId}/settings/tee-admission-policy`);
    return response.data ?? response;
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
    // The "no record yet" wire shape varies across server versions:
    // `{data:{data:null}}`, `{data:null}`, and a bare `null` body have all
    // been observed. Optional-chain the whole path so every flavour collapses
    // to a clean `null`.
    const response = await this.httpClient.get<{ data: GetMetadataResponseData | null } | null>(
      `/admin-api/groups/${groupId}/metadata`,
    );
    return response?.data?.data ?? null;
  }

  async setMemberMetadata(
    groupId: string,
    identity: string,
    request: SetMemberMetadataRequest,
  ): Promise<void> {
    await this.httpClient.put(`/admin-api/groups/${groupId}/members/${identity}/metadata`, request);
  }

  async getMemberMetadata(groupId: string, identity: string): Promise<MetadataRecord | null> {
    // Tolerates every observed "no record yet" shape (see getGroupMetadata).
    const response = await this.httpClient.get<{ data: GetMetadataResponseData | null } | null>(
      `/admin-api/groups/${groupId}/members/${identity}/metadata`,
    );
    return response?.data?.data ?? null;
  }

  async setContextMetadata(
    groupId: string,
    contextId: string,
    request: SetContextMetadataRequest,
  ): Promise<void> {
    await this.httpClient.put(`/admin-api/groups/${groupId}/contexts/${contextId}/metadata`, request);
  }

  async getContextMetadata(groupId: string, contextId: string): Promise<MetadataRecord | null> {
    // Tolerates every observed "no record yet" shape (see getGroupMetadata).
    const response = await this.httpClient.get<{ data: GetMetadataResponseData | null } | null>(
      `/admin-api/groups/${groupId}/contexts/${contextId}/metadata`,
    );
    return response?.data?.data ?? null;
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

  /**
   * The operator-facing "have all peers migrated?" rollup for a namespace.
   * The handler serializes the payload directly, so there is no `{ data }`
   * envelope to unwrap here (unlike most admin reads).
   */
  async getMigrationStatus(namespaceId: string): Promise<MigrationStatus> {
    const id = encodeURIComponent(namespaceId);
    return this.httpClient.get<MigrationStatus>(`/admin-api/groups/${id}/migration-status`);
  }

  /** Per-group cascade-migration snapshots for a namespace. */
  async getCascadeStatus(namespaceId: string): Promise<CascadeStatusEntry[]> {
    const id = encodeURIComponent(namespaceId);
    return unwrap(
      await this.httpClient.get<{ data: CascadeStatusEntry[] }>(`/admin-api/groups/${id}/cascade-status`),
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

  /** Move `childGroupId` under `request.newParentId`. */
  async reparentGroup(
    childGroupId: string,
    request: ReparentGroupRequest,
  ): Promise<ReparentGroupResponseData> {
    // Core returns this flat ({ reparented }); tolerate the { data } envelope too.
    const r = await this.httpClient.post<
      ReparentGroupResponseData & { data?: ReparentGroupResponseData }
    >(`/admin-api/groups/${childGroupId}/reparent`, request);
    return (r?.data ?? r) as ReparentGroupResponseData;
  }

  async listSubgroups(groupId: string): Promise<SubgroupEntry[]> {
    const response = await this.httpClient.get<{ subgroups?: SubgroupEntry[]; data?: SubgroupEntry[] }>(
      `/admin-api/groups/${groupId}/subgroups`,
    );
    return response.subgroups ?? response.data ?? [];
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

  /** Node network status (GET /admin-api/network/status). */
  async getNetworkStatus(): Promise<unknown> {
    return this.httpClient.get<unknown>('/admin-api/network/status');
  }

  /** Node storage/usage stats (GET /admin-api/usage). */
  async getUsage(): Promise<unknown> {
    return this.httpClient.get<unknown>('/admin-api/usage');
  }

  /** Node TLS certificate, PEM text (GET /admin-api/certificate). */
  async getCertificate(): Promise<string> {
    return this.httpClient.get<string>('/admin-api/certificate', { parse: 'text' });
  }

  // ---- Group / context / namespace membership ----

  /** Create a standalone group (POST /admin-api/groups). */
  async createGroup(request: Record<string, unknown>): Promise<{ groupId: string }> {
    return unwrap(
      await this.httpClient.post<{ data: { groupId: string } }>('/admin-api/groups', request),
    );
  }

  /** Leave a group (POST /admin-api/groups/:group_id/leave). */
  async leaveGroup(groupId: string, request?: Record<string, unknown>): Promise<void> {
    await this.httpClient.post(`/admin-api/groups/${groupId}/leave`, request ?? {});
  }

  /** Leave a context (POST /admin-api/contexts/:context_id/leave). */
  async leaveContext(contextId: string, request?: Record<string, unknown>): Promise<void> {
    await this.httpClient.post(`/admin-api/contexts/${contextId}/leave`, request ?? {});
  }

  /** Leave a namespace (POST /admin-api/namespaces/:namespace_id/leave). */
  async leaveNamespace(namespaceId: string, request?: Record<string, unknown>): Promise<void> {
    await this.httpClient.post(`/admin-api/namespaces/${namespaceId}/leave`, request ?? {});
  }

  /** Issue a group ownership proof (POST /admin-api/groups/:group_id/issue-ownership-proof). */
  async issueOwnershipProof(groupId: string, request?: Record<string, unknown>): Promise<unknown> {
    return this.httpClient.post<unknown>(`/admin-api/groups/${groupId}/issue-ownership-proof`, request ?? {});
  }

  /** Issue a namespace ownership proof (POST /admin-api/groups/:group_id/issue-namespace-ownership-proof). */
  async issueNamespaceOwnershipProof(groupId: string, request?: Record<string, unknown>): Promise<unknown> {
    return this.httpClient.post<unknown>(
      `/admin-api/groups/${groupId}/issue-namespace-ownership-proof`,
      request ?? {},
    );
  }

  /** Set a member's auto-follow flag (PUT /admin-api/groups/:group_id/members/:identity/auto-follow). */
  async setMemberAutoFollow(
    groupId: string,
    identity: string,
    request: Record<string, unknown>,
  ): Promise<void> {
    await this.httpClient.put(`/admin-api/groups/${groupId}/members/${identity}/auto-follow`, request);
  }

  /** Abort a namespace migration (POST /admin-api/groups/:namespace_id/migration/abort). */
  async abortMigration(namespaceId: string, request?: Record<string, unknown>): Promise<unknown> {
    return this.httpClient.post<unknown>(
      `/admin-api/groups/${namespaceId}/migration/abort`,
      request ?? {},
    );
  }
}
