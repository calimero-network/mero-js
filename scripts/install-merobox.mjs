#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

function whichPipx() {
  const r = spawnSync('pipx', ['--version'], { encoding: 'utf8' });
  if (r.status === 0) return 'pipx';
  return null;
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }
}

(async () => {
  const pipx = whichPipx();
  if (!pipx) {
    console.warn('[merobox] pipx not found. Skipping install.');
    console.warn('[merobox] This is expected in some CI environments.');
    process.exit(0); // do not hard-fail
  }

  try {
    // install or upgrade merobox using pipx
    run(pipx, ['install', '--force', 'merobox']);

    // smoke check
    const ok = spawnSync('merobox', ['--help'], { stdio: 'ignore' });
    if (ok.status !== 0) throw new Error('merobox not callable after install');

    console.log('[merobox] Installed successfully');
  } catch (error) {
    console.warn(`[merobox] Installation failed: ${error.message}`);
    console.warn('[merobox] This is expected in some CI environments.');
    console.warn('[merobox] E2E tests may not be available.');
    process.exit(0); // do not hard-fail
  }
})();
