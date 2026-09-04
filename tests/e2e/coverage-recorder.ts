/**
 * E2E endpoint-coverage recorder (test infra, node-only — never bundled).
 *
 * When MERO_COVERAGE_OUT is set, wraps global fetch to record every request the
 * SDK issues during the e2e run, and writes the deduped set to that file as a
 * JSON array of `{ route: "METHOD /path", status: <number> }` - one entry per
 * distinct (route, status) pair, status 0 when the request never got a response.
 * Core's `check-endpoint-coverage.sh` then diffs it against the route manifest,
 * counting a route as covered only when some call returned status < 400: a route
 * whose every call 4xx'd is a stale request shape, not coverage. Recording the
 * method (not just the path) means a broken verb can't hide behind another verb
 * on the same route (e.g. GET vs DELETE /admin-api/blobs/:id).
 *
 * Loaded as a vitest setupFile (see vitest.e2e.config.ts). No-op when the env var
 * is unset, so normal runs are unaffected. Requires a single test process
 * (configured via singleFork) so all files share one accumulator.
 */
import { writeFileSync } from 'node:fs';

export interface CoverageHit {
  route: string;
  status: number;
}

const OUT = process.env.MERO_COVERAGE_OUT;

/**
 * Vitest re-instantiates this setup module once per test file, so the
 * accumulator lives on the shared process global - a module-level one would
 * leave the output holding only whichever file's instance flushed last.
 */
const GLOBAL_KEY = Symbol.for('mero-js.e2e.coverage');
const globals = globalThis as Record<symbol, unknown>;
const store = (globals[GLOBAL_KEY] ??= {
  // Keyed "METHOD /path\tstatus" so each (route, status) pair is recorded once.
  seen: new Map<string, CoverageHit>(),
  exitHooked: false,
}) as { seen: Map<string, CoverageHit>; exitHooked: boolean };

/** Record one request outcome as "METHOD /pathname" (method upper-cased, defaults to GET). */
export function recordRequest(method: string, raw: string, status: number): void {
  try {
    // Base covers relative URLs; absolute URLs ignore the base.
    const { pathname } = new URL(raw, 'http://localhost');
    const route = `${(method || 'GET').toUpperCase()} ${pathname}`;
    store.seen.set(`${route}\t${status}`, { route, status });
  } catch {
    /* ignore unparseable inputs */
  }
}

/** Current recorded (route, status) hits, sorted by route then status. */
export function recordedPaths(): CoverageHit[] {
  return [...store.seen.values()].sort(
    (a, b) => a.route.localeCompare(b.route) || a.status - b.status,
  );
}

function flush(): void {
  if (!OUT) return;
  writeFileSync(OUT, `${JSON.stringify(recordedPaths(), null, 2)}\n`);
}

function record(method: string, url: string, status: number): void {
  // Recording must never break a request - swallow any record/flush error.
  try {
    recordRequest(method, url, status);
    flush();
  } catch {
    /* ignore - coverage recording is best-effort */
  }
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
  if (!OUT) return;
  const original = globalThis.fetch;
  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const method = inputToMethod(input, init);
    const url = inputToUrl(input);
    // Preserve the native binding (some fetch impls require `this === globalThis`).
    let response: Response;
    try {
      response = await original.call(globalThis, input, init);
    } catch (e) {
      record(method, url, 0);
      throw e;
    }
    record(method, url, response.status);
    return response;
  }) as typeof fetch;
  // Safety net in case a request slips past before the last flush.
  if (!store.exitHooked) {
    store.exitHooked = true;
    process.on('exit', () => {
      try {
        flush();
      } catch {
        /* ignore */
      }
    });
  }
}

// Auto-install when loaded as a setup file.
installFetchRecorder();
