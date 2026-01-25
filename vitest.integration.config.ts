import { defineConfig } from 'vitest/config';

/**
 * Integration test configuration
 *
 * These tests use MSW to mock the backend, testing the SDK's
 * HTTP client behavior and API contract compliance.
 */
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    setupFiles: ['./tests/integration/setup.ts'],
    testTimeout: 10000,
    environment: 'node',
  },
});
