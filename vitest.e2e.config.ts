import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    setupFiles: ['./tests/e2e/coverage-recorder.ts'],
    testTimeout: 120000, // 2 minutes for e2e tests
    hookTimeout: 120000, // 2 minutes for beforeAll/afterAll
    environment: 'node',
    // Single process so the coverage recorder accumulates across all e2e files
    // (and the stateful single-node suite runs sequentially).
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    env: {
      AUTH_API_BASE_URL: 'http://localhost',
    },
  },
});
