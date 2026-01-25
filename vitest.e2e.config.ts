import { defineConfig } from 'vitest/config';

/**
 * E2E test configuration
 *
 * These tests run against a real merobox instance.
 * They are slower but provide the highest confidence.
 */
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/setup/**'],
    testTimeout: 120000, // 2 minutes for e2e tests
    hookTimeout: 120000, // 2 minutes for beforeAll/afterAll
    environment: 'node',
    globalTeardown: './tests/e2e/global-teardown.ts',
    // Run e2e tests sequentially to avoid Docker container conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // Run all tests in a single process sequentially
      },
    },
    env: {
      // These can be overridden by environment variables
      TEST_NODE_URL: process.env.TEST_NODE_URL || 'http://node1.127.0.0.1.nip.io',
      TEST_AUTH_URL: process.env.TEST_AUTH_URL || 'http://localhost',
      TEST_ADMIN_USER: process.env.TEST_ADMIN_USER || 'admin',
      TEST_ADMIN_PASS: process.env.TEST_ADMIN_PASS || 'admin123',
      MEROBOX_TIMEOUT: process.env.MEROBOX_TIMEOUT || '90000',
    },
  },
});
