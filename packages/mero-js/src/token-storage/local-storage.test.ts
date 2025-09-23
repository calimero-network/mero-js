import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LocalStorageTokenStorage } from './local-storage';
import type { TokenData } from './types';

// Mock localStorage
const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};

// Mock window object
Object.defineProperty(global, 'window', {
  value: {
    localStorage: mockLocalStorage,
  },
  writable: true,
});

describe('LocalStorageTokenStorage', () => {
  let storage: LocalStorageTokenStorage;
  const mockToken: TokenData = {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expires_at: Date.now() + 3600000, // 1 hour from now
  };

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new LocalStorageTokenStorage();
  });

  it('should start with no token', async () => {
    mockLocalStorage.getItem.mockReturnValue(null);
    const token = await storage.getToken();
    expect(token).toBeNull();
    expect(mockLocalStorage.getItem).toHaveBeenCalledWith('mero-js-token');
  });

  it('should store and retrieve token', async () => {
    mockLocalStorage.getItem.mockReturnValue(JSON.stringify(mockToken));

    await storage.setToken(mockToken);
    const retrieved = await storage.getToken();

    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'mero-js-token',
      JSON.stringify(mockToken),
    );
    expect(retrieved).toEqual(mockToken);
  });

  it('should clear token', async () => {
    await storage.clearToken();
    expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('mero-js-token');
  });

  it('should be available when localStorage exists', async () => {
    const available = await storage.isAvailable();
    expect(available).toBe(true);
  });

  it('should handle JSON parse errors gracefully', async () => {
    mockLocalStorage.getItem.mockReturnValue('invalid-json');
    const token = await storage.getToken();
    expect(token).toBeNull();
  });

  it('should throw error when localStorage is not available', async () => {
    // Mock window as undefined
    Object.defineProperty(global, 'window', {
      value: undefined,
      writable: true,
    });

    await expect(storage.setToken(mockToken)).rejects.toThrow(
      'localStorage is not available',
    );

    const available = await storage.isAvailable();
    expect(available).toBe(false);
  });
});

describe('LocalStorageTokenStorage with custom key', () => {
  it('should use custom key when provided', async () => {
    // Ensure window.localStorage is properly mocked
    Object.defineProperty(global, 'window', {
      value: {
        localStorage: mockLocalStorage,
      },
      writable: true,
    });

    const customStorage = new LocalStorageTokenStorage({ key: 'custom-key' });
    mockLocalStorage.getItem.mockReturnValue(null);

    const result = await customStorage.getToken();
    expect(mockLocalStorage.getItem).toHaveBeenCalledWith('custom-key');
  });
});
