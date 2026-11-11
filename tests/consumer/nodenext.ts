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

// The runtime entry point: a route layer of its own sends through a client's transport.
import { NodeTransport, routePath } from '@calimero-network/mero-js/runtime';
import type { RequestOptions, Transport } from '@calimero-network/mero-js/runtime';

export const transport: Transport = client.transport;
export const own = new NodeTransport(options);
export const sameClient = new CalimeroClient(own);
export const getApp = (app: string): Promise<{ appId: string }> => transport.json('GET', routePath('apps/{app}', { app }));

// @ts-expect-error a method is one of the node's
export const badMethod = (): Promise<Response> => transport.request('FETCH', 'apps');

export const stepUp: RequestOptions = { body: {}, passkey, retry: 'once' };

// The generated route layer: typed paths, bodies and answers.
import { createApiClient, passkeyConfirm, stepUp as confirmWith, unwrap } from '@calimero-network/mero-js';
import type { ApiClient } from '@calimero-network/mero-js';

export const api: ApiClient = client.api;
export const ownApi: ApiClient = createApiClient(client.transport, { confirm: passkeyConfirm(passkey) });
export const me = async (): Promise<string> => (await unwrap(api.GET('/auth/me'))).accountId;
export const invite = (org: string) =>
  api.POST('/orgs/{org}/invites', {
    params: { path: { org } },
    body: { role: 'member' },
    middleware: [confirmWith(passkeyConfirm(passkey))],
  });

// @ts-expect-error not a route of the node
export const noRoute = () => api.GET('/no/such/route');

// @ts-expect-error a view's method is a string
export const badView = () => api.POST('/apps/{app}/views', { params: { path: { app: 'a' } }, body: { method: 1 } });
