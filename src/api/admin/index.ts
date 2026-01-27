// Main unified client
export { AdminApiClient } from './client';
export { createAdminApiClient } from './factory';

// Individual concept-based clients (for direct use if needed)
export { PublicApiClient } from './public';
export { ApplicationsApiClient } from './applications';
export { ContextsApiClient } from './contexts';
export { ProposalsApiClient } from './proposals';
export { CapabilitiesApiClient } from './capabilities';
export { IdentityApiClient } from './identity';
export { NetworkApiClient } from './network';
export { BlobsApiClient } from './blobs';
export { AliasesApiClient } from './aliases';
export { TeeApiClient } from './tee';

// Types from each module (re-export all, including types)
export * from './public';
export * from './applications';
export * from './contexts';
export * from './proposals';
export * from './capabilities';
export * from './identity';
export * from './network';
export * from './blobs';
export * from './aliases';
export * from './tee';
