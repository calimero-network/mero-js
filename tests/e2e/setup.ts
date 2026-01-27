/**
 * Shared E2E test setup and teardown utilities
 * 
 * This module provides a single merobox instance that all e2e tests share,
 * preventing Docker container conflicts and reducing test execution time.
 */

import { ChildProcess } from 'child_process';
import { MeroJs } from '../../src/index';

let meroboxProcess: ChildProcess | null = null;
let authNodeUrl: string | null = null;
const meroJsInstances: Map<string, MeroJs> = new Map();
let isSetup = false;
let setupPromise: Promise<void> | null = null; // Mutex to prevent concurrent setup

export interface TestConfig {
  baseUrl?: string;
  credentials: {
    username: string;
    password: string;
  };
  timeoutMs?: number;
}

const DEFAULT_CONFIG: TestConfig = {
  baseUrl: process.env.AUTH_NODE_API_BASE_URL || 'http://node1.127.0.0.1.nip.io',
  credentials: {
    username: 'admin',
    password: 'admin123',
  },
  timeoutMs: 10000,
};

/**
 * Start merobox environment (idempotent - only starts once)
 * Uses a mutex to prevent concurrent setup calls
 */
export async function setupMerobox(): Promise<void> {
  // If already setup, return immediately
  if (isSetup && meroboxProcess) {
    console.log('✅ Merobox already running, reusing existing instance');
    return;
  }

  // If setup is in progress, wait for it to complete
  if (setupPromise) {
    console.log('⏳ Merobox setup in progress, waiting...');
    await setupPromise;
    return;
  }

  // Start setup and store the promise as a mutex
  setupPromise = (async () => {
    console.log('🚀 Starting merobox environment...');

  const { spawn } = await import('child_process');

  console.log('🔧 Starting Calimero node with auth service...');
  meroboxProcess = spawn('merobox', ['run', '--auth-service'], {
    stdio: 'pipe',
    cwd: process.cwd(),
  });

  meroboxProcess.on('error', (error) => {
    console.error('❌ Merobox process error:', error);
  });

  if (meroboxProcess.stderr) {
    meroboxProcess.stderr.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Auth Node URL:')) {
        const match = output.match(/Auth Node URL:\s*(https?:\/\/[^\s]+)/);
        if (match) {
          authNodeUrl = match[1];
          console.log('📝 Found Auth Node URL:', authNodeUrl);
        }
      }
    });
  }

  if (meroboxProcess.stdout) {
    meroboxProcess.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Auth Node URL:')) {
        const match = output.match(/Auth Node URL:\s*(https?:\/\/[^\s]+)/);
        if (match) {
          authNodeUrl = match[1];
          console.log('📝 Found Auth Node URL:', authNodeUrl);
        }
      }
    });
  }

    // Wait for services to be ready
    console.log('⏳ Waiting for services to start...');
    await new Promise((resolve) => setTimeout(resolve, 60000)); // Wait 60 seconds

    isSetup = true;
    setupPromise = null; // Clear mutex
    console.log('✅ Merobox setup complete');
  })();

  await setupPromise;
}

/**
 * Get or create MeroJs instance (idempotent per config)
 * Multiple instances can exist with different configs, but they all share the same merobox
 */
export async function getMeroJs(config?: Partial<TestConfig>): Promise<MeroJs> {
  if (!isSetup) {
    await setupMerobox();
  }

  const baseUrl = config?.baseUrl || authNodeUrl || DEFAULT_CONFIG.baseUrl;
  if (!baseUrl) {
    throw new Error('No base URL available for MeroJs SDK');
  }

  const finalConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    baseUrl,
  };

  // Create a cache key from the config
  const cacheKey = JSON.stringify({
    baseUrl: finalConfig.baseUrl,
    username: finalConfig.credentials.username,
  });

  // Return cached instance if it exists
  if (meroJsInstances.has(cacheKey)) {
    return meroJsInstances.get(cacheKey)!;
  }

  console.log('🔧 Creating MeroJs SDK...');
  console.log('Base URL:', finalConfig.baseUrl);

  const meroJsInstance = new MeroJs(finalConfig);

  // Wait for auth service to be ready
  console.log('⏳ Waiting for auth service to be ready...');
  let authReady = false;
  for (let i = 0; i < 10; i++) {
    try {
      const authHealth = await meroJsInstance.auth.getHealth();
      console.log('✅ Auth service is ready:', authHealth);
      authReady = true;
      break;
    } catch (error: any) {
      console.log(`⏳ Auth service not ready yet (attempt ${i + 1}/10)...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  if (!authReady) {
    throw new Error('Auth service did not become ready in time');
  }

  // Authenticate
  console.log('🔑 Authenticating with MeroJs SDK...');
  try {
    const tokenData = await meroJsInstance.authenticate();
    console.log('✅ Authentication successful!');
    console.log('🎫 Token expires at:', new Date(tokenData.expires_at));
  } catch (error: any) {
    console.error('❌ Authentication failed:', error.message);
    if (error.bodyText) {
      console.error('⚠️ Error body:', error.bodyText);
    }
    throw new Error(
      `Authentication required but failed: ${error.message}. Cannot proceed with tests.`,
    );
  }

  // Cache the instance
  meroJsInstances.set(cacheKey, meroJsInstance);
  
  return meroJsInstance;
}

/**
 * Cleanup merobox environment
 */
export async function teardownMerobox(): Promise<void> {
  if (!isSetup) {
    return;
  }

  console.log('🧹 Cleaning up merobox environment...');

  try {
    const { spawn } = await import('child_process');

    console.log('🗑️ Running merobox nuke --force...');
    const nukeProcess = spawn('merobox', ['nuke', '--force'], {
      stdio: 'inherit',
      cwd: process.cwd(),
    });

    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('⚠️ Merobox cleanup timeout, killing process...');
        nukeProcess.kill('SIGTERM');
        resolve(void 0);
      }, 90000);

      nukeProcess.on('close', () => {
        clearTimeout(timeout);
        console.log('✅ Merobox cleanup completed');
        resolve(void 0);
      });
      nukeProcess.on('error', () => {
        clearTimeout(timeout);
        console.warn('⚠️ Merobox cleanup failed');
        resolve(void 0);
      });
    });
  } catch (error) {
    console.warn('⚠️ Merobox cleanup failed:', error);
  }

  meroboxProcess = null;
  authNodeUrl = null;
  meroJsInstances.clear();
  isSetup = false;

  console.log('🧹 Test cleanup completed');
}
