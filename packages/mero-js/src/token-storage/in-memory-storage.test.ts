import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTokenStorage } from './in-memory-storage';
import type { TokenData } from './types';

describe('InMemoryTokenStorage', () => {
  let storage: InMemoryTokenStorage;
  const mockToken: TokenData = {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expires_at: Date.now() + 3600000, // 1 hour from now
  };

  beforeEach(() => {
    storage = new InMemoryTokenStorage();
  });

  it('should start with no token', async () => {
    const token = await storage.getToken();
    expect(token).toBeNull();
  });

  it('should store and retrieve token', async () => {
    await storage.setToken(mockToken);
    const retrieved = await storage.getToken();
    expect(retrieved).toEqual(mockToken);
  });

  it('should clear token', async () => {
    await storage.setToken(mockToken);
    await storage.clearToken();
    const token = await storage.getToken();
    expect(token).toBeNull();
  });

  it('should always be available', async () => {
    const available = await storage.isAvailable();
    expect(available).toBe(true);
  });

  it('should overwrite existing token', async () => {
    const newToken: TokenData = {
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_at: Date.now() + 7200000, // 2 hours from now
    };

    await storage.setToken(mockToken);
    await storage.setToken(newToken);
    const retrieved = await storage.getToken();
    expect(retrieved).toEqual(newToken);
  });
});
