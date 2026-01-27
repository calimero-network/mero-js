import { beforeAll, afterEach, afterAll } from 'vitest';
import { server } from './mocks/server';
import { baseHandlers } from './mocks/handlers';

// Start MSW server before all tests
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  // Set default handlers
  server.use(...baseHandlers);
});

// Reset handlers after each test for isolation
afterEach(() => {
  server.resetHandlers();
  // Restore base handlers
  server.use(...baseHandlers);
});

// Clean up after all tests
afterAll(() => {
  server.close();
});
