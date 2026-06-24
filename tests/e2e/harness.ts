/**
 * E2E node harness — resolves where the SDK should point and whether to boot a
 * node itself. Lets the same e2e suite run two ways:
 *
 *   - locally: spawn merobox (the default), or
 *   - in core CI: point at an already-running node via NODE_BASE_URL (and skip
 *     spawning), so "core breaks first" — core's freshly-built merod drives the
 *     same tests against its own wire.
 *
 * Env:
 *   NODE_BASE_URL   if set, the suite uses this URL and does NOT spawn anything.
 *   MEROD_BINARY    if set (and NODE_BASE_URL unset), spawn this merod binary.
 *   AUTH_API_BASE_URL  legacy override for the auth base URL (default http://localhost).
 */
import type { ChildProcess } from 'child_process';
import { fileURLToPath } from 'node:url';
import type { MeroJs } from '../../src/mero-js';

/** The demo app the e2e suite exercises (bundled at ./assets/kv-store.mpk). */
export const KV_STORE_PACKAGE = 'com.calimero.kv-store';

/**
 * Ensure the kv-store app is installed on the target node, returning its id.
 * Installs it from the local bundle if absent — so the suite is self-provisioning
 * and reproducible on a fresh node (instead of assuming a pre-installed app).
 */
export async function ensureApplication(mero: MeroJs): Promise<string> {
  const { apps } = await mero.admin.listApplications();
  const existing = apps.find((a) => a.package === KV_STORE_PACKAGE);
  if (existing) return existing.id;
  const path = fileURLToPath(new URL('./assets/kv-store.mpk', import.meta.url));
  const res = await mero.admin.installDevApplication({ path, metadata: [] });
  return res.applicationId;
}

/** Short per-run suffix so resources don't collide on a persistent node. */
export function runId(): string {
  return Math.floor(Number(process.hrtime.bigint() % 1_000_000_000n)).toString(36);
}

export function resolveBaseUrl(): string {
  return (
    process.env.NODE_BASE_URL ||
    process.env.NODE_URL ||
    process.env.AUTH_API_BASE_URL ||
    'http://localhost'
  );
}

/** Credentials for the e2e suite, overridable via env (default dev/dev). */
export function resolveCreds(): { username: string; password: string } {
  return {
    username: process.env.MERO_E2E_USER || 'dev',
    password: process.env.MERO_E2E_PASS || 'dev',
  };
}

/** True when an external node is already running and the suite must not spawn one. */
export function usingInjectedNode(): boolean {
  return Boolean(process.env.NODE_BASE_URL || process.env.NODE_URL);
}

export interface StartedNode {
  baseUrl: string;
  /** Stop anything this harness started. No-op for an injected node. */
  stop: () => Promise<void>;
}

/**
 * Start (or attach to) a node for the e2e run. When NODE_BASE_URL is set, attaches
 * without spawning; otherwise spawns merod (MEROD_BINARY) or merobox and waits.
 */
export async function startNode(opts?: { waitMs?: number }): Promise<StartedNode> {
  const baseUrl = resolveBaseUrl();

  if (usingInjectedNode()) {
    return { baseUrl, stop: async () => {} };
  }

  const { spawn } = await import('child_process');
  const merodBinary = process.env.MEROD_BINARY;

  let child: ChildProcess;
  let stop: () => Promise<void>;

  if (merodBinary) {
    child = spawn(merodBinary, ['run'], { stdio: 'pipe' });
    stop = async () => {
      child.kill('SIGTERM');
    };
  } else {
    child = spawn('merobox', ['run', '--auth-service'], { stdio: 'pipe' });
    stop = async () => {
      const { spawn: spawn2 } = await import('child_process');
      await new Promise<void>((resolve) => {
        const nuke = spawn2('merobox', ['nuke', '--force'], { stdio: 'inherit' });
        const t = setTimeout(() => {
          nuke.kill();
          resolve();
        }, 30000);
        nuke.on('exit', () => {
          clearTimeout(t);
          resolve();
        });
      });
    };
  }

  child.on('error', (err) => console.error('node process error:', err));
  child.stderr?.on('data', (d) => console.error('node stderr:', d.toString()));

  await new Promise((resolve) => setTimeout(resolve, opts?.waitMs ?? 60000));
  return { baseUrl, stop };
}
