/**
 * E2E endpoint-coverage recorder (test infra, node-only — never bundled).
 *
 * When MERO_COVERAGE_OUT is set, wraps global fetch to record the pathname of
 * every request the SDK issues during the e2e run, and writes the deduped set to
 * that file as a JSON array. Core's `check-endpoint-coverage.sh` then diffs it
 * against the route manifest to flag endpoints with no SDK e2e coverage.
 *
 * Loaded as a vitest setupFile (see vitest.e2e.config.ts). No-op when the env var
 * is unset, so normal runs are unaffected. Requires a single test process
 * (configured via singleFork) so all files share one accumulator.
 */
import { writeFileSync } from 'node:fs';

const OUT = process.env.MERO_COVERAGE_OUT;
const seen = new Set<string>();
let installed = false;

/** Extract the pathname from any fetch input and record it. */
export function recordUrl(raw: string): void {
  try {
    // Base covers relative URLs; absolute URLs ignore the base.
    seen.add(new URL(raw, 'http://localhost').pathname);
  } catch {
    /* ignore unparseable inputs */
  }
}

/** Current recorded pathnames (sorted) — exposed for assertions/inspection. */
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

export function installFetchRecorder(): void {
  if (installed || !OUT) return;
  installed = true;
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    recordUrl(inputToUrl(input));
    flush();
    return original(input, init);
  }) as typeof fetch;
  // Safety net in case a request slips past before the last flush.
  process.on('exit', flush);
}

// Auto-install when loaded as a setup file.
installFetchRecorder();
