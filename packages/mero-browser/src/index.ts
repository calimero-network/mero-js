import { createCore, CoreConfig } from '@mero/core';
import { makeBrowserEnv } from '@mero/adapter-browser';

/** Batteries-included factory for browser apps */
export function createMero(config: CoreConfig) {
  const deps = makeBrowserEnv();
  return createCore(config, deps);
}

// Re-export public types so browser apps have a single import
export * from '@mero/core';
