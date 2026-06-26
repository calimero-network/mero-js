/**
 * E2E endpoint-coverage recorder (test infra, node-only — never bundled).
 *
 * When MERO_COVERAGE_OUT is set, wraps global fetch to record "METHOD /path" for
 * every request the SDK issues during the e2e run, and writes the deduped set to
 * that file as a JSON array. Core's `check-endpoint-coverage.sh` then diffs it
 * against the route manifest to flag endpoints with no SDK e2e coverage. Recording
 * the method (not just the path) means a broken verb can't hide behind another
 * verb on the same route (e.g. GET vs DELETE /admin-api/blobs/:id).
 *
 * Loaded as a vitest setupFile (see vitest.e2e.config.ts). No-op when the env var
 * is unset, so normal runs are unaffected. Requires a single test process
 * (configured via singleFork) so all files share one accumulator.
 */
import { writeFileSync } from 'node:fs';

const OUT = process.env.MERO_COVERAGE_OUT;
const seen = new Set<string>();
let installed = false;

/** Record a request as "METHOD /pathname" (method upper-cased, defaults to GET). */
export function recordRequest(method: string, raw: string): void {
  try {
    // Base covers relative URLs; absolute URLs ignore the base.
    const { pathname } = new URL(raw, 'http://localhost');
    seen.add(`${(method || 'GET').toUpperCase()} ${pathname}`);
  } catch {
    /* ignore unparseable inputs */
  }
}

/** Current recorded "METHOD /path" entries (sorted) — exposed for inspection. */
export function recordedPaths(): string[] {
  return [...seen].sort();
}

function flush(): void {
  if (!OUT) return;
  writeFileSync(OUT, `${JSON.stringify(recordedPaths(), null, 2)}\n`);
}

function inputToUrl(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (input && typeof input === 'object' && 'url' in input) {
    return String((input as { url: unknown }).url);
  }
  return String(input);
}

/** Resolve the HTTP method from the fetch args (init wins, then a Request input). */
function inputToMethod(input: unknown, init?: Parameters<typeof fetch>[1]): string {
  if (init?.method) return init.method;
  if (input && typeof input === 'object' && 'method' in input) {
    return String((input as { method: unknown }).method);
  }
  return 'GET';
}

export function installFetchRecorder(): void {
  if (installed || !OUT) return;
  installed = true;
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    // Recording must never break a request — swallow any record/flush error.
    try {
      recordRequest(inputToMethod(input, init), inputToUrl(input));
      flush();
    } catch {
      /* ignore — coverage recording is best-effort */
    }
    // Preserve the native binding (some fetch impls require `this === globalThis`).
    return original.call(globalThis, input, init);
  }) as typeof fetch;
  // Safety net in case a request slips past before the last flush.
  process.on('exit', () => {
    try {
      flush();
    } catch {
      /* ignore */
    }
  });
}

// Auto-install when loaded as a setup file.
installFetchRecorder();
