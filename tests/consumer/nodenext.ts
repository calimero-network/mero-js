// Compiled by tsconfig.consumer.json as an external NodeNext consumer of the built
// dist/. The @ts-expect-error lines fail if unresolvable specifiers widen the API to any.
import { CalimeroClient, ConfirmRequired, browserPasskey } from '@calimero-network/mero-js';
import type { CalimeroClientOptions, CalimeroSession, CloudPolicy, UpgradeRun } from '@calimero-network/mero-js';

const policy: CloudPolicy = { release: { minReleaseVersion: '2.3.109' } };
const options: CalimeroClientOptions = { baseUrl: 'https://node.example', policy };

export const client = new CalimeroClient(options);
export const passkey = browserPasskey();

// @ts-expect-error baseUrl is required
new CalimeroClient({ policy });

// @ts-expect-error minReleaseVersion is a string
export const badPolicy: CloudPolicy = { release: { minReleaseVersion: 2 } };

export const accountOf = (s: CalimeroSession): string => s.accountId;

export function finished(run: UpgradeRun): boolean {
  return run.finished;
}

// @ts-expect-error a run's failures are keyed by app id, not a list
export const failedList: UpgradeRun['failed'] = ['a-1'];

export function needsPasskey(e: unknown): boolean {
  return e instanceof ConfirmRequired && e.status === 412;
}
