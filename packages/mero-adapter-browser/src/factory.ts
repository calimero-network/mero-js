// Browser adapter factory functions
import { WebHttpClient } from './web-client';
import { LocalStorageTokenStorage } from './local-storage';
import { Transport } from '@mero/core';

export function makeBrowserEnv() {
  const transport: Transport = {
    fetch: globalThis.fetch,
    baseUrl: '', // Will be set by the SDK
  };

  return {
    httpClient: new WebHttpClient(transport),
    tokenStorage: new LocalStorageTokenStorage(),
  };
}
