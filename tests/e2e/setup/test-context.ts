/**
 * E2E Test Context
 *
 * Simple: just provides authenticated MeroJs instance.
 */

import { MeroJs } from '../../../src/index';
import { startMerobox, getMeroboxState, isMeroboxRunning } from './merobox';

export interface TestContext {
  meroJs: MeroJs;
  cleanup: () => Promise<void>;
}

// Default config
const DEFAULT_CONFIG = {
  nodeBaseUrl: process.env.TEST_NODE_URL || 'http://node1.127.0.0.1.nip.io',
  credentials: {
    username: process.env.TEST_ADMIN_USER || 'admin',
    password: process.env.TEST_ADMIN_PASS || 'admin123',
  },
  httpTimeout: 10000,
  meroboxTimeout: 90000,
  healthCheckInterval: 2000,
};

let testContext: TestContext | null = null;

export async function getTestContext(): Promise<TestContext> {
  if (testContext) {
    return testContext;
  }

  if (!isMeroboxRunning()) {
    await startMerobox(DEFAULT_CONFIG);
  }

  const state = getMeroboxState();

  const meroJs = new MeroJs({
    baseUrl: state.nodeUrl || DEFAULT_CONFIG.nodeBaseUrl,
    credentials: DEFAULT_CONFIG.credentials,
    timeoutMs: DEFAULT_CONFIG.httpTimeout,
  });

  console.log('🔑 Authenticating...');
  await meroJs.authenticate();
  console.log('✅ Authentication successful');

  testContext = {
    meroJs,
    cleanup: async () => {
      console.log('🧹 Cleaning up test context...');
      testContext = null;
    },
  };

  return testContext;
}

export async function resetTestContext(): Promise<void> {
  if (testContext) {
    await testContext.cleanup();
  }
}
