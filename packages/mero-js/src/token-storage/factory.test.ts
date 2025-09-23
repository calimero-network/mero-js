import { describe, it, expect, vi } from 'vitest';
import { createTokenStorage, createDefaultTokenStorage } from './factory';
import { InMemoryTokenStorage } from './in-memory-storage';
import { LocalStorageTokenStorage } from './local-storage';
import { FileTokenStorage } from './file-storage';

// Mock window for browser detection
const mockWindow = {
  localStorage: {},
};

Object.defineProperty(global, 'window', {
  value: mockWindow,
  writable: true,
});

describe('Token Storage Factory', () => {
  describe('createTokenStorage', () => {
    it('should create in-memory storage', () => {
      const storage = createTokenStorage('memory');
      expect(storage).toBeInstanceOf(InMemoryTokenStorage);
    });

    it('should create localStorage storage', () => {
      const storage = createTokenStorage('localStorage', { key: 'test-key' });
      expect(storage).toBeInstanceOf(LocalStorageTokenStorage);
    });

    it('should create file storage', () => {
      const storage = createTokenStorage('file', { key: 'test-token.json' });
      expect(storage).toBeInstanceOf(FileTokenStorage);
    });

    it('should throw error for unknown storage type', () => {
      expect(() => createTokenStorage('unknown' as any)).toThrow(
        'Unknown storage type: unknown',
      );
    });
  });

  describe('createDefaultTokenStorage', () => {
    it('should create localStorage storage in browser environment', () => {
      const storage = createDefaultTokenStorage({ key: 'browser-token' });
      expect(storage).toBeInstanceOf(LocalStorageTokenStorage);
    });

    it('should create file storage in Node.js environment', () => {
      // Mock Node.js environment
      Object.defineProperty(global, 'window', {
        value: undefined,
        writable: true,
      });

      Object.defineProperty(global, 'process', {
        value: { versions: { node: '18.0.0' } },
        writable: true,
      });

      const storage = createDefaultTokenStorage({ key: 'node-token.json' });
      expect(storage).toBeInstanceOf(FileTokenStorage);
    });

    it('should fallback to in-memory storage when neither browser nor Node.js', () => {
      // Mock unknown environment
      Object.defineProperty(global, 'window', {
        value: undefined,
        writable: true,
      });

      Object.defineProperty(global, 'process', {
        value: undefined,
        writable: true,
      });

      const storage = createDefaultTokenStorage();
      expect(storage).toBeInstanceOf(InMemoryTokenStorage);
    });
  });
});
