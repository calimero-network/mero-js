// Types matching OpenAPI spec exactly
// All responses are wrapped in { data: ... }

export interface AuthChallengeResponse {
  challenge: string;
  nonce: string;
  // Note: timestamp is embedded in the JWT challenge string, not a separate field
}

export type AuthMethod =
  | 'near_wallet'
  | 'user_password'
  | 'eth_wallet'
  | 'starknet_wallet'
  | 'icp_wallet';

// Note: Auth API expects snake_case field names (despite OpenAPI spec showing camelCase)
export interface AuthTokenRequest {
  auth_method: AuthMethod;
  public_key: string;
  client_name: string;
  timestamp: number;
  provider_data: Record<string, unknown>;
  permissions?: string[];
}

// Note: Auth API returns snake_case field names
export interface AuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

// Server requires BOTH access_token and refresh_token (snake_case, no serde rename)
export interface RefreshTokenRequest {
  access_token: string;
  refresh_token: string;
}

export interface AuthProvider {
  id: string;
  name: string;
  enabled: boolean;
}

export interface AuthProvidersResponse {
  providers: AuthProvider[];
  count?: number;
}

export interface AuthIdentityResponse {
  service: string;
  version: string;
  identity: string;
}

export interface TokenValidationRequest {
  token: string;
}

// Token validation response
// Note: The server returns an empty string "" on success with auth info in headers
// (X-Auth-User, X-Auth-Permissions). This is designed for auth proxy use.
// If the request doesn't throw an error, the token is valid.
export interface TokenValidationResponse {
  valid: boolean;
  claims?: Record<string, unknown> | null;
}

// Raw response from server (empty string on success)
export type TokenValidationRawResponse = string;

export interface RevokeTokenResponse {
  revoked: boolean;
}

export interface RootKey {
  keyId: string;
  publicKey: string;
  clientName: string;
  createdAt: string;
  permissions: string[];
}

export type ListRootKeysResponse = RootKey[];

export interface CreateRootKeyRequest {
  publicKey: string;
  clientName: string;
  permissions?: string[];
}

export type CreateRootKeyResponse = RootKey;

export interface DeleteRootKeyResponse {
  deleted: boolean;
}

export interface ClientKey {
  keyId: string;
  rootKeyId: string;
  contextId: string | null;
  contextIdentity: string | null;
  permissions: string[];
  createdAt: string;
}

export type ListClientKeysResponse = ClientKey[];

// Note: Auth API expects snake_case field names
export interface GenerateClientKeyRequest {
  context_id: string;
  context_identity: string;
  permissions: string[];
}

export type GenerateClientKeyResponse = ClientKey;

export interface DeleteClientKeyResponse {
  deleted: boolean;
}

export type GetKeyPermissionsResponse = string[];

export interface UpdateKeyPermissionsRequest {
  permissions: string[];
}

export type UpdateKeyPermissionsResponse = string[];

export interface AuthMetricsResponse {
  [key: string]: Record<string, unknown>;
}

export interface HealthResponse {
  status: string;
}
