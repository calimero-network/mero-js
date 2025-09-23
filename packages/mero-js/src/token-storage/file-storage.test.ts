import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FileTokenStorage } from './file-storage';
import type { TokenData } from './types';
import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Mock fs
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
    mkdir: vi.fn(),
    access: vi.fn(),
  },
}));

describe('FileTokenStorage', () => {
  let storage: FileTokenStorage;
  const mockToken: TokenData = {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expires_at: Date.now() + 3600000, // 1 hour from now
  };

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new FileTokenStorage();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should start with no token', async () => {
    (fs.readFile as any).mockRejectedValue(new Error('ENOENT'));
    const token = await storage.getToken();
    expect(token).toBeNull();
  });

  it('should store and retrieve token', async () => {
    (fs.readFile as any).mockResolvedValue(JSON.stringify(mockToken));
    (fs.writeFile as any).mockResolvedValue(undefined);
    (fs.mkdir as any).mockResolvedValue(undefined);

    await storage.setToken(mockToken);
    const retrieved = await storage.getToken();

    expect(fs.writeFile).toHaveBeenCalled();
    expect(retrieved).toEqual(mockToken);
  });

  it('should clear token', async () => {
    (fs.unlink as any).mockResolvedValue(undefined);

    await storage.clearToken();
    expect(fs.unlink).toHaveBeenCalled();
  });

  it('should handle file not found when clearing', async () => {
    const error = new Error('ENOENT');
    (error as any).code = 'ENOENT';
    (fs.unlink as any).mockRejectedValue(error);

    // Should not throw
    await expect(storage.clearToken()).resolves.toBeUndefined();
  });

  it('should be available when file system is accessible', async () => {
    (fs.access as any).mockResolvedValue(undefined);
    const available = await storage.isAvailable();
    expect(available).toBe(true);
  });

  it('should not be available when file system is not accessible', async () => {
    (fs.access as any).mockRejectedValue(new Error('Permission denied'));
    const available = await storage.isAvailable();
    expect(available).toBe(false);
  });

  it('should use custom directory and filename when provided', async () => {
    const customStorage = new FileTokenStorage({
      key: 'custom-token.json',
      dir: '/custom/path',
    });

    (fs.writeFile as any).mockResolvedValue(undefined);
    (fs.mkdir as any).mockResolvedValue(undefined);

    await customStorage.setToken(mockToken);

    expect(fs.writeFile).toHaveBeenCalledWith(
      '/custom/path/custom-token.json',
      JSON.stringify(mockToken, null, 2),
      'utf-8',
    );
  });

  it('should handle write errors', async () => {
    (fs.writeFile as any).mockRejectedValue(new Error('Disk full'));

    await expect(storage.setToken(mockToken)).rejects.toThrow(
      'Failed to store token to file',
    );
  });
});
