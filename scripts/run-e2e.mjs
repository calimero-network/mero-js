#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const workflow = process.argv[2] || path.join(root, ".merobox", "workflows", "smoke-auth.yml");

// Resolve merobox binary (prefer local venv if you used the prepare installer)
function resolveMerobox() {
  if (process.env.MEROBOX_BIN) return process.env.MEROBOX_BIN;

  const venv = process.env.MEROBOX_VENV || path.join(root, ".merobox", ".venv");
  const binUnix = path.join(venv, "bin", "merobox");
  const binWin = path.join(venv, "Scripts", "merobox.exe");
  if (existsSync(binUnix)) return binUnix;
  if (existsSync(binWin)) return binWin;
  return "merobox"; // fall back to PATH
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) {
    const what = [cmd, ...args].join(" ");
    throw new Error(`Command failed: ${what}`);
  }
}

const MEROBOX = resolveMerobox();
const env = {
  ...process.env,
  // Provide defaults for CI/local; override with real secrets in CI:
  MERO_NODE_HOST: process.env.MERO_NODE_HOST || "node1.127.0.0.1.nip.io",
  AUTH_USERNAME: process.env.AUTH_USERNAME || "admin@example.com",
  AUTH_PASSWORD: process.env.AUTH_PASSWORD || "admin",
};

console.log(`[e2e] Using workflow: ${workflow}`);
console.log(`[e2e] Using merobox: ${MEROBOX}`);

try {
  // 1) Start stack from workflow
  run(MEROBOX, ["bootstrap", "run", workflow]);

  // 2) (Optional) quick readiness probe for dashboard
  //    If your workflow already waits, you can skip this step.
  try {
    run("curl", ["-sf", `http://${env.MERO_NODE_HOST}/admin-dashboard`]);
  } catch {
    console.warn("[e2e] Dashboard not reachable yet; continuing as tests may include waits.");
  }

  // 3) Run E2E tests (adjust to your scripts)
  // no-auth tests (optional):
  if (process.env.RUN_NO_AUTH !== "0") {
    try {
      run("pnpm", ["-w", "test:e2e"], { env });
    } catch (e) {
      console.warn("[e2e] no-auth tests failed (continuing to auth suite):", e.message);
    }
  }

  // auth tests:
  run("pnpm", ["-w", "test:e2e-auth"], { env });

  console.log("[e2e] All tests completed.");
} finally {
  // 4) Always stop nodes
  try {
    run(MEROBOX, ["stop", "--all"]);
  } catch (e) {
    console.warn("[e2e] merobox stop failed:", e.message);
  }
}
