import type { TokenData, TokenStorage } from './types';

/**
 * In-memory token storage implementation.
 * This is the default storage and works in all environments.
 */
export class InMemoryTokenStorage implements TokenStorage {
  private token: TokenData | null = null;

  async getToken(): Promise<TokenData | null> {
    return this.token;
  }

  async setToken(token: TokenData): Promise<void> {
    this.token = token;
  }

  async clearToken(): Promise<void> {
    this.token = null;
  }

  async isAvailable(): Promise<boolean> {
    return true; // Always available
  }
}
