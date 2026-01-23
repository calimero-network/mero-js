import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/tests/e2e/**'],
    include: ['src/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
  },
});
