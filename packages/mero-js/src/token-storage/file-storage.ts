import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { TokenData, TokenStorage, TokenStorageConfig } from './types';

/**
 * Node.js file-based token storage implementation.
 * Only works in Node.js environments.
 */
export class FileTokenStorage implements TokenStorage {
  private filePath: string;

  constructor(config: TokenStorageConfig = {}) {
    const fileName = config.key || 'mero-js-token.json';
    const dir = config.dir || join(homedir(), '.mero-js');
    this.filePath = join(dir, fileName);
  }

  async getToken(): Promise<TokenData | null> {
    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      return JSON.parse(data) as TokenData;
    } catch (error) {
      // File doesn't exist or can't be read
      return null;
    }
  }

  async setToken(token: TokenData): Promise<void> {
    try {
      // Ensure directory exists
      const dir = this.filePath.substring(0, this.filePath.lastIndexOf('/'));
      await fs.mkdir(dir, { recursive: true });

      // Write token to file
      await fs.writeFile(
        this.filePath,
        JSON.stringify(token, null, 2),
        'utf-8',
      );
    } catch (error) {
      throw new Error(
        `Failed to store token to file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async clearToken(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
    } catch (error) {
      // File doesn't exist, that's fine
      if ((error as any)?.code !== 'ENOENT') {
        console.warn('Failed to delete token file:', error);
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if we can access the file system
      await fs.access(
        this.filePath.substring(0, this.filePath.lastIndexOf('/')),
      );
      return true;
    } catch {
      return false;
    }
  }
}
