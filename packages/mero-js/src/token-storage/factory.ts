import type { TokenStorage, TokenStorageConfig } from './types';
import { InMemoryTokenStorage } from './in-memory-storage';
import { LocalStorageTokenStorage } from './local-storage';
import { FileTokenStorage } from './file-storage';

export type StorageType = 'memory' | 'localStorage' | 'file';

/**
 * Create a token storage instance based on the specified type
 */
export function createTokenStorage(
  type: StorageType = 'memory',
  config: TokenStorageConfig = {},
): TokenStorage {
  switch (type) {
    case 'memory':
      return new InMemoryTokenStorage();

    case 'localStorage':
      return new LocalStorageTokenStorage(config);

    case 'file':
      return new FileTokenStorage(config);

    default:
      throw new Error(`Unknown storage type: ${type}`);
  }
}

/**
 * Create the best available token storage for the current environment
 */
export function createDefaultTokenStorage(
  config: TokenStorageConfig = {},
): TokenStorage {
  // Check if we're in a browser environment
  if (
    typeof window !== 'undefined' &&
    typeof window.localStorage !== 'undefined'
  ) {
    return new LocalStorageTokenStorage(config);
  }

  // Check if we're in a Node.js environment
  if (typeof process !== 'undefined' && process.versions?.node) {
    return new FileTokenStorage(config);
  }

  // Fallback to in-memory storage
  return new InMemoryTokenStorage();
}
