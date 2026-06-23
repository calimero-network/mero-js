// Auth API Types - Generated from OpenAPI 3.0.3 specification

// Re-export shared types
export { ApiResponse } from '../http-client';

// Health and Status Types
export interface HealthResponse {
  status: 'alive' | 'not_alive';
  storage: boolean;
  uptime_seconds: number;
}

export interface IdentityResponse {
  service: string;
  version: string;
  authentication_mode: string;
  providers: string[];
}

export interface ProvidersResponse {
  providers: Array<{
    name: string;
    type: string;
    description: string;
    configured: boolean;
    config: Record<string, unknown>;
  }>;
  count: number;
}

// Authentication Types
export interface TokenRequest {
  auth_method: string;
  public_key: string;
  client_name: string;
  permissions?: string[];
  timestamp: number;
  provider_data: Record<string, unknown>;
}

export interface TokenResponse {
  data: {
    access_token: string;
    refresh_token: string;
    error?: string | null;
  };
  error?: string | null;
}

export interface RefreshTokenRequest {
  access_token: string;
  refresh_token: string;
}

// Mock Token (CI/testing). Core's MockTokenRequest is snake_case.
export interface MockTokenRequest {
  client_name: string;
  permissions?: string[];
  node_url?: string;
  access_token_expiry?: number;
  refresh_token_expiry?: number;
}

// Token Management Types
// Core revokes by client_id (the request is `{ client_id }`).
export interface RevokeTokenRequest {
  client_id: string;
}

export interface RevokeTokenResponse {
  success: boolean;
  message: string;
}

// Key Management Types
export interface CreateKeyRequest {
  /** Public key to register as a root key. */
  public_key: string;
  /** Auth method / provider name (e.g. "user_password"). */
  auth_method: string;
  /** Provider-specific data. */
  provider_data: Record<string, unknown>;
  /** Target node URL to scope the root key to (optional). */
  target_node_url?: string;
}

export interface CreateKeyResponse {
  status: boolean;
  message: string;
}

export interface DeleteKeyResponse {
  success: boolean;
  message: string;
}

// Core returns a flat array of root keys (the `{ data }` payload).
export interface RootKey {
  key_id: string;
  public_key: string;
  auth_method: string;
  created_at: number;
  revoked_at?: number | null;
  permissions: string[];
}

// Client Management Types
// Core returns a flat array of client keys (the `{ data }` payload).
export interface ClientKey {
  client_id: string;
  root_key_id: string;
  name: string;
  permissions: string[];
  created_at: number;
  revoked_at?: number | null;
  is_valid: boolean;
}

export interface GenerateClientKeyRequest {
  /** Context the client key is scoped to (optional). */
  context_id?: string;
  /** Context identity (executor public key) the client key is for (optional). */
  context_identity?: string;
  /** Additional permissions to request (validated against the root key). */
  permissions?: string[];
  /** Target node URL to scope the client key/tokens to (optional). */
  target_node_url?: string;
}

export interface DeleteClientResponse {
  success: boolean;
  message: string;
}

// Permission Management Types
// Core applies an { add, remove } delta (remove first, then add) — NOT a
// full-set replacement. A `permissions` field is ignored by core.
export interface UpdateKeyPermissionsRequest {
  /** Permission strings to add (OR-ed onto the key's current set). */
  add?: string[];
  /** Permission strings to remove (applied before `add`). */
  remove?: string[];
}

export interface PermissionResponse {
  data: {
    permissions: string[];
  };
  error?: string | null;
}

// Client Configuration
export interface AuthApiClientConfig {
  baseUrl: string;
  getAuthToken?: () => Promise<string | undefined>;
  timeoutMs?: number;
}
