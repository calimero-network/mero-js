import type { TokenStorage, TokenStorageConfig } from './types';
import { InMemoryTokenStorage } from './in-memory-storage';

export type StorageType = 'memory';

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

    default:
      throw new Error(`Unknown storage type: ${type}`);
  }
}

/**
 * Create the default token storage (in-memory only in core)
 */
export function createDefaultTokenStorage(
  config: TokenStorageConfig = {},
): TokenStorage {
  return new InMemoryTokenStorage();
}
