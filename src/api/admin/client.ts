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
 * Unified Admin API Client that composes all concept-based modules
 */
export class AdminApiClient {
  public readonly public: PublicApiClient;
  public readonly applications: ApplicationsApiClient;
  public readonly contexts: ContextsApiClient;
  public readonly proposals: ProposalsApiClient;
  public readonly capabilities: CapabilitiesApiClient;
  public readonly identity: IdentityApiClient;
  public readonly network: NetworkApiClient;
  public readonly blobs: BlobsApiClient;
  public readonly aliases: AliasesApiClient;
  public readonly tee: TeeApiClient;

  constructor(httpClient: HttpClient) {
    this.public = new PublicApiClient(httpClient);
    this.applications = new ApplicationsApiClient(httpClient);
    this.contexts = new ContextsApiClient(httpClient);
    this.proposals = new ProposalsApiClient(httpClient);
    this.capabilities = new CapabilitiesApiClient(httpClient);
    this.identity = new IdentityApiClient(httpClient);
    this.network = new NetworkApiClient(httpClient);
    this.blobs = new BlobsApiClient(httpClient);
    this.aliases = new AliasesApiClient(httpClient);
    this.tee = new TeeApiClient(httpClient);
  }
}
