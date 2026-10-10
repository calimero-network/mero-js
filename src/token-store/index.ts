import type { TokenData } from '../mero-js.js';

export interface TokenStore {
  getTokens(): TokenData | null;
  setTokens(data: TokenData): void;
  clear(): void;
  /**
   * Run `fn` holding a lock that every process sharing this store respects.
   * MeroJs holds it around a token refresh, so two processes on one store never
   * spend the same single-use refresh token. Web Locks cover tabs of one
   * browser; a store shared across processes (a file read by several CLIs, say)
   * needs its own lock, and implements this. Takes precedence over Web Locks.
   */
  withLock?<T>(fn: () => Promise<T>): Promise<T>;
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
