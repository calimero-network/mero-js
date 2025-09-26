// Universal entry - DI only, no platform-specific types
export * from '@mero/core';

// Optional: expose a factory that accepts adapters/envs explicitly
// This allows explicit dependency injection without platform detection
export { createCore as createMero } from '@mero/core';
