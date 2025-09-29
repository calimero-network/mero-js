import { createCore } from '@mero/core';
import { makeBrowserEnv } from '@mero/adapter-browser';

/** Batteries-included factory for browser apps */
export function createMero() {
  return createCore(makeBrowserEnv());
}

// Re-export public types so browser apps have a single import
export * from '@mero/core';
