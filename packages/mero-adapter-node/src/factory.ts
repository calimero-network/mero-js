// Node.js adapter factory functions
import { FileTokenStorage } from './file-storage';
import { NodeHttpClient } from './node-client';
import { Transport } from '@mero/core';

export function makeNodeEnv() {
  const transport: Transport = {
    fetch: globalThis.fetch, // This will be replaced with node-fetch or undici
    baseUrl: '', // Will be set by the SDK
  };

  return {
    httpClient: new NodeHttpClient(transport),
    tokenStorage: new FileTokenStorage(),
  };
}
