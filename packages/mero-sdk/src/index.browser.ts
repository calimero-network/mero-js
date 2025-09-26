// Browser-specific SDK entry point
// This excludes Node.js-specific modules

// Re-export everything from core
export * from '@mero/core';

// Re-export browser-specific modules
export * from '@mero/adapter-browser';

// Main SDK class (browser version)
export { MeroJs, createMeroJs } from './mero-js';
export type { MeroJsConfig, TokenData } from './mero-js';

// HTTP factory (browser version)
export * from './http-factory';
