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
import { execFileSync, type ChildProcess } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'node:url';
import type { MeroJs } from '../../src/mero-js.js';

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
  const res = await mero.admin.installDevApplication({ path });
  return res.applicationId;
}

/** Short per-run suffix so resources don't collide on a persistent node. */
export function runId(): string {
  // Full monotonic nanosecond clock (strictly increasing per call) so unique
  // names don't collide within the same millisecond.
  return process.hrtime.bigint().toString(36);
}

export function resolveBaseUrl(): string {
  return (
    process.env.NODE_BASE_URL ||
    process.env.NODE_URL ||
    process.env.AUTH_API_BASE_URL ||
    'http://localhost'
  );
}

/**
 * Credentials for the e2e suite, overridable via env. The default password is
 * 8+ chars because core >= 0.11.0-rc.14 enforces a minimum password length
 * when the account is created (core#3081).
 */
export function resolveCreds(): { username: string; password: string } {
  return {
    username: process.env.MERO_E2E_USER || 'dev',
    password: process.env.MERO_E2E_PASS || 'dev-password',
  };
}

/**
 * Admin account provisioning for fresh nodes (core >= 0.11.0-rc.17). The
 * bootstrap secret is gone: a node now mints its admin root key at startup from
 * MERO_AUTH_ADMIN_USER/MERO_AUTH_ADMIN_PASSWORD when it has no account yet
 * (provision-if-unbootstrapped). When the harness spawns the node itself,
 * default these to the e2e credentials so the fresh node provisions exactly the
 * account authenticate() will log in with. When attaching to an injected node
 * (NODE_BASE_URL), the caller controls provisioning and no default is forced.
 */
export function ensureAdminCredsEnv(): void {
  if (usingInjectedNode()) return;
  const { username, password } = resolveCreds();
  process.env.MERO_AUTH_ADMIN_USER ??= username;
  process.env.MERO_AUTH_ADMIN_PASSWORD ??= password;
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

  // Spawned nodes inherit this env; a fresh rc.17 node mints its admin from it
  // at startup, so the first authenticate() with the same creds succeeds.
  ensureAdminCredsEnv();

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

/**
 * The `merod` binary, for the few things only it can do offline (minting an
 * author's device certificate). Suites that need it skip without it.
 */
export const MEROD_BINARY = process.env.MEROD_BINARY;

/**
 * A fixed BIP-39 phrase, so the author's ACCOUNT is deterministic.
 *
 * It owns nothing. It is here because this scenario needs an author whose
 * account holds **no node at all** — the case delegated authorship exists for —
 * and an account only exists where some root does. A node's own root would work
 * and would need no phrase, but `sign-cert` reads it from the datastore and
 * RocksDB's lock is exclusive, so it cannot be read while the node under test is
 * serving this suite. `--from` opens no store, which is what makes it usable
 * here.
 */
const AUTHOR_PHRASE =
  'legal winner thank year wave sausage worth useful legal winner thank year ' +
  'wave sausage worth useful legal winner thank year wave sausage worth title';

export interface MintedDevice {
  credential: string;
  account: string;
  secret: string;
}

/** Run an offline `merod account` subcommand and return its stdout. */
export function offlineMerod(args: string[]): string {
  return execFileSync(MEROD_BINARY as string, ['--node', 'sdk-e2e-offline', ...args], {
    encoding: 'utf8',
    timeout: 60_000,
  });
}

/**
 * Mint a device for the phrase's account and certify it, offline.
 *
 * `--generate` mints the keypair and certifies it in one step, so the secret
 * exists only in this output and never reaches the node — which is the whole
 * point: a node holding it could forge writes in the member's name.
 */
export function mintDevice(): MintedDevice {
  const dir = mkdtempSync(join(tmpdir(), 'mero-warrant-'));
  const phraseFile = join(dir, 'phrase');
  writeFileSync(phraseFile, `${AUTHOR_PHRASE}\n`, { mode: 0o600 });

  const out = offlineMerod(['account', 'sign-cert', '--generate', '--from', phraseFile]);
  const lines = out.split('\n');

  const credential = lines.find((l) => /^[0-9a-f]{100,}$/.test(l.trim()))?.trim();
  const account = /^Account: +([0-9a-f]{64})$/m.exec(out)?.[1];
  const secret = /^Secret: +([0-9a-f]{64})$/m.exec(out)?.[1];

  // Named individually rather than one "parse failed": if `sign-cert` changes
  // its output, the message should say which field went missing.
  if (!credential) throw new Error(`sign-cert printed no credential:\n${out}`);
  if (!account) throw new Error(`sign-cert printed no Account line:\n${out}`);
  if (!secret) throw new Error(`sign-cert printed no Secret line:\n${out}`);

  return { credential, account, secret };
}

