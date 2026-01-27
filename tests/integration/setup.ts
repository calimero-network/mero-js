/**
 * Integration Test Setup
 *
 * Sets up MSW (Mock Service Worker) for intercepting HTTP requests.
 * This allows testing the SDK's HTTP client behavior without a real backend.
 */

import { beforeAll, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { handlers } from '../mocks/handlers';

// Create MSW server with default handlers
export const server = setupServer(...handlers);

beforeAll(() => {
  // Start the MSW server before all tests
  server.listen({
    onUnhandledRequest: 'warn',
  });
});

afterEach(() => {
  // Reset handlers after each test (removes runtime handlers)
  server.resetHandlers();
});

afterAll(() => {
  // Clean up after all tests
  server.close();
});

// Export server for use in tests that need custom handlers
export { server as mswServer };
