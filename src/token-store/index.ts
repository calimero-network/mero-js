import type { TokenData } from '../mero-js';

export interface TokenStore {
  getTokens(): TokenData | null;
  setTokens(data: TokenData): void;
  clear(): void;
}

export class MemoryTokenStore implements TokenStore {
  private tokens: TokenData | null = null;

  getTokens(): TokenData | null {
    return this.tokens;
  }

  setTokens(data: TokenData): void {
    this.tokens = data;
  }

  clear(): void {
    this.tokens = null;
  }
}

const STORAGE_KEY = 'mero-tokens';

export class LocalStorageTokenStore implements TokenStore {
  private readonly key: string;

  constructor(key: string = STORAGE_KEY) {
    this.key = key;
  }

  getTokens(): TokenData | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.access_token && parsed.refresh_token) {
        return {
          access_token: parsed.access_token,
          refresh_token: parsed.refresh_token,
          expires_at: typeof parsed.expires_at === 'number' ? parsed.expires_at : Date.now() + 3600_000,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  setTokens(data: TokenData): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(this.key, JSON.stringify(data));
    } catch {
      // Storage unavailable
    }
  }

  clear(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.removeItem(this.key);
    } catch {
      // Storage unavailable
    }
  }
}
