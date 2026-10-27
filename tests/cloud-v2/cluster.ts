/** Start a local merod cluster (dev mode: mock quotes) for tests. */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const BINARY =
  process.env.MEROD_BINARY ?? process.env.MEROD_V2_BINARY ?? resolve(__dirname, '../../../core/target/debug/merod');
export const KV_STORE_WASM =
  process.env.KV_STORE_WASM ?? resolve(__dirname, '../../../core/target/wasm32-unknown-unknown/app-release/kv_store.wasm');

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => ok(port));
    });
    s.on('error', fail);
  });
}

export interface LocalCluster {
  urls: string[];
  stop(i?: number): void;
}

export async function startCluster(n = 3): Promise<LocalCluster> {
  const ports = await Promise.all(Array.from({ length: n }, freePort));
  const urls = ports.map((p) => `http://127.0.0.1:${p}`);
  const peers = urls.map((u, i) => `${i + 1}=${u}/`).join(',');
  const procs: Array<ChildProcess | undefined> = urls.map((url, i) =>
    spawn(
      BINARY,
      // `merod run FLAGS`: a node from flags alone, no `init`.
      [
        'run',
        '--node-id', String(i + 1),
        '--listen', `127.0.0.1:${ports[i]}`,
        '--public-url', `${url}/`,
        '--data-dir', mkdtempSync(join(tmpdir(), 'merod-')),
        '--peers', peers,
        '--cluster', 'mero-js-test',
        '--dev',
        '--origins', 'http://localhost:3000',
        ...(i === 0 ? ['--bootstrap'] : []),
      ],
      { stdio: process.env.MEROD_V2_LOGS ? 'inherit' : 'ignore' },
    ),
  );
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const r = await fetch(`${urls[0]}/health`);
      const h = (await r.json()) as { systemLeader?: number };
      if (h.systemLeader) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error('cluster did not start');
    await new Promise((r) => setTimeout(r, 200));
  }
  // Let the leader register nodes and mint the first session key.
  await new Promise((r) => setTimeout(r, 1500));
  return {
    urls,
    stop(i?: number) {
      const idx = i === undefined ? procs.map((_, j) => j) : [i];
      for (const j of idx) {
        procs[j]?.kill('SIGKILL');
        procs[j] = undefined;
      }
    },
  };
}
