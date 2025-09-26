import type { TokenData, TokenStorage, TokenStorageConfig } from '@mero/core';

/**
 * Browser localStorage token storage implementation.
 * Only works in browser environments.
 */
export class LocalStorageTokenStorage implements TokenStorage {
  private key: string;

  constructor(config: TokenStorageConfig = {}) {
    this.key = config.key || 'mero-js-token';
  }

  async getToken(): Promise<TokenData | null> {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }

    try {
      const stored = window.localStorage.getItem(this.key);
      if (!stored) {
        return null;
      }
      return JSON.parse(stored) as TokenData;
    } catch (error) {
      console.warn('Failed to parse stored token:', error);
      return null;
    }
  }

  async setToken(token: TokenData): Promise<void> {
    if (typeof window === 'undefined' || !window.localStorage) {
      throw new Error('localStorage is not available');
    }

    try {
      window.localStorage.setItem(this.key, JSON.stringify(token));
    } catch (error) {
      throw new Error(
        `Failed to store token: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async clearToken(): Promise<void> {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    try {
      window.localStorage.removeItem(this.key);
    } catch (error) {
      console.warn('Failed to clear token from localStorage:', error);
    }
  }

  async isAvailable(): Promise<boolean> {
    return (
      typeof window !== 'undefined' &&
      typeof window.localStorage !== 'undefined'
    );
  }
}
