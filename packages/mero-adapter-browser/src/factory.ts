// Browser adapter factory functions
import { WebHttpClient } from './web-client';
import { LocalStorageTokenStorage } from './local-storage';
import { Transport } from '@mero/core';

// Add missing type imports for browser APIs
type RequestInit = globalThis.RequestInit;

export function makeBrowserEnv(baseUrl?: string) {
  const tokenStorage = new LocalStorageTokenStorage();
  const transport: Transport = {
    // Wrap fetch to ensure correct global context and avoid "Illegal invocation"
    fetch: (input: string | URL | Request, init?: RequestInit) =>
      globalThis.fetch(input, init),
    baseUrl: baseUrl || '',
    getAuthToken: async () => {
      try {
        const token = await tokenStorage.getToken();
        return token?.access_token;
      } catch {
        return undefined;
      }
    },
  };

  return {
    httpClient: new WebHttpClient(transport),
    tokenStorage,
  };
}
