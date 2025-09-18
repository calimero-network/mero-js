#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const VENV_DIR = process.env.MEROBOX_VENV || path.join(ROOT, '.merobox', '.venv');
const IS_WIN = process.platform === 'win32';

function whichPython() {
  // try python3, then python
  for (const cmd of ['python3', 'python']) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return cmd;
  }
  return null;
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }
}

function ensureVenv(py) {
  if (!existsSync(VENV_DIR)) {
    mkdirSync(path.dirname(VENV_DIR), { recursive: true });
    run(py, ['-m', 'venv', VENV_DIR]);
  }
}

function pipExe() {
  return IS_WIN
    ? path.join(VENV_DIR, 'Scripts', 'pip.exe')
    : path.join(VENV_DIR, 'bin', 'pip');
}

function meroboxExe() {
  return IS_WIN
    ? path.join(VENV_DIR, 'Scripts', 'merobox.exe')
    : path.join(VENV_DIR, 'bin', 'merobox');
}

(async () => {
  const py = whichPython();
  if (!py) {
    console.error('[merobox] No Python found (python3/python). Skipping install.');
    process.exit(0); // do not hard-fail local installs
  }

  ensureVenv(py);

  // upgrade pip, then install or upgrade merobox
  run(pipExe(), ['install', '--upgrade', 'pip']);
  // pin if you want: replace 'merobox' with 'merobox==<version>'
  run(pipExe(), ['install', '--upgrade', 'merobox']);

  // smoke check
  const ok = spawnSync(meroboxExe(), ['--help'], { stdio: 'ignore' });
  if (ok.status !== 0) throw new Error('merobox not callable after install');

  console.log(`[merobox] Installed at ${meroboxExe()}`);
})();
