import { createCore, CoreConfig } from '@mero/core';
import { makeBrowserEnv } from '@mero/adapter-browser';

/** Batteries-included factory for browser apps */
export function createMero(config: CoreConfig) {
  const deps = makeBrowserEnv();
  const core = createCore(config, deps);

  // Add SDK methods that were in the original MeroJs class
  return {
    ...core,
    tokenStorage: deps.tokenStorage,

    // Authentication methods
    async authenticate() {
      if (!config.credentials) {
        throw new Error('Credentials required for authentication');
      }

      const tokenData = await core.auth.generateTokens({
        auth_method: 'user_password',
        public_key: config.credentials.username,
        client_name: 'mero-js-sdk',
        permissions: ['admin'],
        timestamp: Date.now(),
        provider_data: {
          username: config.credentials.username,
          password: config.credentials.password,
        },
      });

      const tokenWithExpiry = {
        access_token: tokenData.data.access_token,
        refresh_token: tokenData.data.refresh_token,
        expires_at: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      };

      // Store token in storage
      await deps.tokenStorage.setToken(tokenWithExpiry);

      return tokenWithExpiry;
    },

    async getTokenData() {
      return await deps.tokenStorage.getToken();
    },

    async isAuthenticated() {
      const tokenData = await this.getTokenData();
      if (!tokenData) return false;
      return tokenData.expires_at > Date.now();
    },

    async logout() {
      await deps.tokenStorage.clearToken();
    },
  };
}

// Re-export public types so browser apps have a single import
export * from '@mero/core';
