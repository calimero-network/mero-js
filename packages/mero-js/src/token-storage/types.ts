// Token Storage Types

export interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface TokenStorage {
  /**
   * Get the stored token data
   */
  getToken(): Promise<TokenData | null>;

  /**
   * Store token data
   */
  setToken(token: TokenData): Promise<void>;

  /**
   * Clear stored token data
   */
  clearToken(): Promise<void>;

  /**
   * Check if token storage is available
   */
  isAvailable(): Promise<boolean>;
}

export interface TokenStorageConfig {
  /** Storage key for the token data */
  key?: string;
  /** Additional configuration for specific storage implementations */
  [key: string]: any;
}
