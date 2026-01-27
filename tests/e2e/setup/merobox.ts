/**
 * Merobox Lifecycle Management
 * 
 * Health-based startup instead of blind 60-second wait.
 */

import { spawn, ChildProcess } from 'child_process';
import { MeroJs } from '../../../src/index';

export interface MeroboxConfig {
  nodeBaseUrl: string;
  credentials: { username: string; password: string };
  httpTimeout: number;
  meroboxTimeout: number;
  healthCheckInterval: number;
}

export interface MeroboxState {
  process: ChildProcess | null;
  nodeUrl: string | null;
  isReady: boolean;
}

let meroboxState: MeroboxState = {
  process: null,
  nodeUrl: null,
  isReady: false,
};

let startupPromise: Promise<MeroboxState> | null = null;

// Simple wait utility
async function waitFor(
  check: () => Promise<boolean>,
  opts: { timeout: number; interval: number; description: string },
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < opts.timeout) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, opts.interval));
  }
  throw new Error(`Timeout waiting for ${opts.description}`);
}

export async function startMerobox(config: MeroboxConfig): Promise<MeroboxState> {
  if (meroboxState.isReady && meroboxState.process) {
    return meroboxState;
  }

  if (startupPromise) {
    return startupPromise;
  }

  startupPromise = doStartMerobox(config);
  try {
    meroboxState = await startupPromise;
    return meroboxState;
  } finally {
    startupPromise = null;
  }
}

async function doStartMerobox(config: MeroboxConfig): Promise<MeroboxState> {
  console.log('🚀 Starting merobox environment...');

  const meroboxProc = spawn('merobox', ['run', '--auth-service'], {
    stdio: 'pipe',
    cwd: process.cwd(),
    env: { ...process.env, MEROBOX_IMAGE: process.env.MEROBOX_IMAGE },
  });

  let nodeUrl: string | null = null;

  const parseOutput = (data: Buffer) => {
    const output = data.toString();
    const match = output.match(/Auth Node URL:\s*(https?:\/\/[^\s]+)/);
    if (match) {
      nodeUrl = match[1];
      console.log('📝 Found Node URL:', nodeUrl);
    }
  };

  meroboxProc.stdout?.on('data', parseOutput);
  meroboxProc.stderr?.on('data', parseOutput);
  meroboxProc.on('error', (e) => console.error('❌ Merobox error:', e));
  meroboxProc.on('exit', (code) => {
    if (code !== 0 && code !== null) console.warn(`⚠️ Merobox exited: ${code}`);
    meroboxState.isReady = false;
  });

  // Wait for URL
  console.log('⏳ Waiting for merobox to output URLs...');
  await waitFor(() => Promise.resolve(nodeUrl !== null), {
    timeout: 60000,
    interval: 1000,
    description: 'merobox URL detection',
  });
  console.log('✅ Detected Node URL:', nodeUrl);

  // Wait for health
  console.log('⏳ Waiting for services to be healthy...');
  const effectiveUrl = nodeUrl || config.nodeBaseUrl;
  const tempMeroJs = new MeroJs({
    baseUrl: effectiveUrl,
    credentials: config.credentials,
    timeoutMs: config.httpTimeout,
  });

  try {
    await waitFor(
      async () => {
        try {
          const h = await tempMeroJs.auth.getHealth();
          return h?.status === 'healthy';
        } catch {
          return false;
        }
      },
      {
        timeout: config.meroboxTimeout,
        interval: config.healthCheckInterval,
        description: 'auth service health check',
      },
    );
    console.log('✅ Auth service is healthy');
  } catch (error) {
    meroboxProc.kill();
    throw error;
  }

  return { process: meroboxProc, nodeUrl: effectiveUrl, isReady: true };
}

export async function stopMerobox(): Promise<void> {
  if (!meroboxState.process) return;

  console.log('🧹 Stopping merobox...');
  meroboxState.process.kill('SIGTERM');

  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      meroboxState.process?.kill('SIGKILL');
      resolve();
    }, 10000);
    meroboxState.process?.on('exit', () => {
      clearTimeout(t);
      resolve();
    });
  });

  // Nuke containers
  console.log('🗑️ Running merobox nuke...');
  const nuke = spawn('merobox', ['nuke', '--force'], { stdio: 'pipe' });
  await new Promise<void>((r) => {
    const t = setTimeout(() => { nuke.kill(); r(); }, 30000);
    nuke.on('exit', () => { clearTimeout(t); r(); });
  });

  meroboxState = { process: null, nodeUrl: null, isReady: false };
}

export function getMeroboxState(): MeroboxState {
  return { ...meroboxState };
}

export function isMeroboxRunning(): boolean {
  return meroboxState.isReady && meroboxState.process !== null;
}
