import { createCore } from '@mero/core';
import { makeNodeEnv } from '@mero/adapter-node';

export function createMero(config: any) {
  const env = makeNodeEnv();
  return createCore(config, env);
}

export * from '@mero/core';
