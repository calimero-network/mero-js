/**
 * E2E for access grants — a third party with no session calling the methods a
 * node owner named, and nothing else.
 *
 * The node owner issues a grant for `get` on the kv-store context, and a client
 * holding nothing but the token reads through it. The same token is refused on
 * `set`, then on `get` once revoked. A grant the node does not hold is refused
 * the same way, so a guess learns nothing.
 *
 * The guest client is a fresh `MeroJs` that never authenticated: the route is
 * public on every node and the token in the body is its whole credential.
 *
 * Skipped against a merod that predates the routes: the listing answers 404
 * for a context this node holds only when the route is absent. Core's paired
 * SDK e2e runs it against its own build, where a 404 fails the coverage gate.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { MeroJs } from '../../src/mero-js.js';
import { ensureApplication, resolveBaseUrl, resolveCreds, runId } from './harness.js';

const NODE_URL = resolveBaseUrl();
const { username: USERNAME, password: PASSWORD } = resolveCreds();
const RUN = runId();

describe('access grants E2E', () => {
  let owner: MeroJs;
  let guest: MeroJs;
  let contextId: string;
  let routesMissing = false;

  beforeAll(async () => {
    owner = new MeroJs({ baseUrl: NODE_URL });
    await owner.authenticate({ username: USERNAME, password: PASSWORD });

    const applicationId = await ensureApplication(owner);
    const ns = await owner.admin.createNamespace({ applicationId, name: `grant-${RUN}` });
    const ctx = await owner.admin.createContext({ applicationId, groupId: ns.namespaceId });
    contextId = ctx.contextId;

    await owner.rpc.execute({
      contextId,
      method: 'set',
      argsJson: { key: 'greeting', value: `hello-${RUN}` },
    });

    guest = new MeroJs({ baseUrl: NODE_URL });

    try {
      await owner.admin.listAccessGrants(contextId);
    } catch (e) {
      if ((e as { status?: number }).status !== 404) throw e;
      routesMissing = true;
      console.log('(skip) access grant routes absent - this merod predates them');
    }
  });

  it('lets a token call the methods it names, and only those, until revoked', async (ctx) => {
    if (routesMissing) return ctx.skip();
    const grant = await owner.admin.createAccessGrant(contextId, {
      methods: ['get'],
      label: `e2e ${RUN}`,
    });
    expect(grant.token).toMatch(/^[0-9a-f]{64}$/);
    expect(grant.methods).toEqual(['get']);

    const listed = await owner.admin.listAccessGrants(contextId);
    expect(listed.map((g) => g.grantId)).toContain(grant.grantId);
    // The token is shown once; a listing never carries it.
    expect(JSON.stringify(listed)).not.toContain(grant.token);

    const read = await guest.admin.callWithAccessGrant(contextId, {
      token: grant.token,
      method: 'get',
      argsJson: { key: 'greeting' },
    });
    expect(read.returns).toBe(`hello-${RUN}`);

    await expect(
      guest.admin.callWithAccessGrant(contextId, {
        token: grant.token,
        method: 'set',
        argsJson: { key: 'greeting', value: 'overwritten' },
      }),
    ).rejects.toMatchObject({ status: 403 });

    await owner.admin.revokeAccessGrant(contextId, grant.grantId);
    await expect(
      guest.admin.callWithAccessGrant(contextId, {
        token: grant.token,
        method: 'get',
        argsJson: { key: 'greeting' },
      }),
    ).rejects.toMatchObject({ status: 403 });

    // And the write that was refused never happened.
    const after = await owner.rpc.execute<string>({
      contextId,
      method: 'get',
      argsJson: { key: 'greeting' },
    });
    expect(after).toBe(`hello-${RUN}`);
  });

  it('refuses a token the node never issued', async (ctx) => {
    if (routesMissing) return ctx.skip();
    await expect(
      guest.admin.callWithAccessGrant(contextId, {
        token: 'ab'.repeat(32),
        method: 'get',
        argsJson: { key: 'greeting' },
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses to grant a method name that could widen the permission', async (ctx) => {
    if (routesMissing) return ctx.skip();
    await expect(
      owner.admin.createAccessGrant(contextId, { methods: ['get],admin'] }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
