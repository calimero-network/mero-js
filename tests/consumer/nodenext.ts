// Compiled by tsconfig.consumer.json as an external NodeNext consumer of the built
// dist/. The @ts-expect-error lines fail if unresolvable specifiers widen the API to any.
import { CalimeroClient, ConfirmRequired, browserPasskey } from '@calimero-network/mero-js';
import type { CalimeroClientOptions, CalimeroSession, NodePolicy, UpgradeRun } from '@calimero-network/mero-js';

const policy: NodePolicy = { release: { minReleaseVersion: '2.3.109' } };
const options: CalimeroClientOptions = { baseUrl: 'https://node.example', policy };

export const client = new CalimeroClient(options);
export const passkey = browserPasskey();

// @ts-expect-error baseUrl is required
new CalimeroClient({ policy });

// @ts-expect-error minReleaseVersion is a string
export const badPolicy: NodePolicy = { release: { minReleaseVersion: 2 } };

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

// The generated methods on a transport of your own.
import { createRouteClient, createRoutes, passkeyConfirm } from '@calimero-network/mero-js';
import type { NodeEvent, Routes } from '@calimero-network/mero-js';

export const ownRoutes: Routes = createRoutes(createRouteClient(client.transport, { confirm: passkeyConfirm(passkey) }));
export const me = async (): Promise<string> => (await ownRoutes.auth.me()).accountId;
export const kindOf = (event: NodeEvent): string => event.kind;
export const ownPolicy: NodePolicy = policy;

// The generated methods: one typed argument object, the typed payload.
export const orgName = async (org: string): Promise<string> => (await client.orgs.get({ org })).name;
export const inviteToken = async (org: string): Promise<string> =>
  (await client.orgs.inviteCreate({ org, role: 'member' }, { confirm: passkeyConfirm(passkey) })).token;
export const called = (app: string) => client.apps.call({ app, method: 'set', args: { k: 'v' } });

// @ts-expect-error a path parameter is required
export const noOrg = () => client.orgs.get({});

// @ts-expect-error not an argument of the route
export const extraArg = () => client.orgs.get({ org: 'o', bogus: 1 });

// @ts-expect-error an invite's role is one the node knows
export const badRole = () => client.orgs.inviteCreate({ org: 'o', role: 'emperor' });
