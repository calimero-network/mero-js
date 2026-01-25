import { HttpClient } from '../../http-client';
import { PublicApiClient } from './public';
import { ApplicationsApiClient } from './applications';
import { ContextsApiClient } from './contexts';
import { ProposalsApiClient } from './proposals';
import { CapabilitiesApiClient } from './capabilities';
import { IdentityApiClient } from './identity';
import { NetworkApiClient } from './network';
import { BlobsApiClient } from './blobs';
import { AliasesApiClient } from './aliases';
import { TeeApiClient } from './tee';

/**
 * Unified Admin API Client that composes all domain-specific modules.
 *
 * Sub-clients are lazily initialized on first access to minimize memory
 * usage when only a subset of functionality is needed.
 *
 * @example
 * ```typescript
 * const admin = new AdminApiClient(httpClient);
 *
 * // Only ApplicationsApiClient is initialized
 * const apps = await admin.applications.listApplications();
 *
 * // Now ContextsApiClient is also initialized
 * const contexts = await admin.contexts.listContexts();
 * ```
 */
export class AdminApiClient {
  private readonly httpClient: HttpClient;

  // Lazy-initialized sub-clients
  private _public?: PublicApiClient;
  private _applications?: ApplicationsApiClient;
  private _contexts?: ContextsApiClient;
  private _proposals?: ProposalsApiClient;
  private _capabilities?: CapabilitiesApiClient;
  private _identity?: IdentityApiClient;
  private _network?: NetworkApiClient;
  private _blobs?: BlobsApiClient;
  private _aliases?: AliasesApiClient;
  private _tee?: TeeApiClient;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
  }

  /** Public endpoints (health checks, etc.) - no authentication required */
  get public(): PublicApiClient {
    if (!this._public) {
      this._public = new PublicApiClient(this.httpClient);
    }
    return this._public;
  }

  /** Application management (install, list, uninstall) */
  get applications(): ApplicationsApiClient {
    if (!this._applications) {
      this._applications = new ApplicationsApiClient(this.httpClient);
    }
    return this._applications;
  }

  /** Context management (create, list, join, leave) */
  get contexts(): ContextsApiClient {
    if (!this._contexts) {
      this._contexts = new ContextsApiClient(this.httpClient);
    }
    return this._contexts;
  }

  /** Proposal management for context governance */
  get proposals(): ProposalsApiClient {
    if (!this._proposals) {
      this._proposals = new ProposalsApiClient(this.httpClient);
    }
    return this._proposals;
  }

  /** Capability queries for feature detection */
  get capabilities(): CapabilitiesApiClient {
    if (!this._capabilities) {
      this._capabilities = new CapabilitiesApiClient(this.httpClient);
    }
    return this._capabilities;
  }

  /** Identity management (key generation, context identities) */
  get identity(): IdentityApiClient {
    if (!this._identity) {
      this._identity = new IdentityApiClient(this.httpClient);
    }
    return this._identity;
  }

  /** Network and peer management */
  get network(): NetworkApiClient {
    if (!this._network) {
      this._network = new NetworkApiClient(this.httpClient);
    }
    return this._network;
  }

  /** Blob storage (upload, list, delete binary data) */
  get blobs(): BlobsApiClient {
    if (!this._blobs) {
      this._blobs = new BlobsApiClient(this.httpClient);
    }
    return this._blobs;
  }

  /** Alias management for human-readable names */
  get aliases(): AliasesApiClient {
    if (!this._aliases) {
      this._aliases = new AliasesApiClient(this.httpClient);
    }
    return this._aliases;
  }

  /** TEE (Trusted Execution Environment) operations */
  get tee(): TeeApiClient {
    if (!this._tee) {
      this._tee = new TeeApiClient(this.httpClient);
    }
    return this._tee;
  }
}
