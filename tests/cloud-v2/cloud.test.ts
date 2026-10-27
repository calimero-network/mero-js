import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CalimeroClient, CalimeroError } from '../../src/cloud-v2/index.js';
import { KV_STORE_WASM, startCluster, type LocalCluster } from './cluster.js';
import { SoftPasskey } from './soft-passkey.js';

const ORIGIN = 'http://localhost:3000';
let cluster: LocalCluster;

const client = (i: number, allowMock = true) => new CalimeroClient({ baseUrl: cluster.urls[i], policy: { allowMock } });

async function person(i: number, name: string): Promise<[CalimeroClient, SoftPasskey]> {
  const c = client(i);
  const pk = new SoftPasskey('localhost', ORIGIN);
  await c.signUp(pk, name);
  return [c, pk];
}

beforeAll(async () => {
  cluster = await startCluster(3);
});

afterAll(() => cluster?.stop());

describe('cloud v2', () => {
  it('refuses a mock quote unless allowed', async () => {
    await expect(client(0, false).post('auth/passkey/login/begin')).rejects.toThrow(/mock quote refused/);
  });

  it('signs up, deploys kv-store and calls it through the sealed channel', async () => {
    const [alice, pk] = await person(0, 'alice');
    const me = await alice.me();
    expect(me.via).toBe('session');

    // The same passkey signs in on another node.
    const again = client(1);
    const s = await again.signIn(pk);
    expect(s.accountId).toBe(me.accountId);

    const bundle = await alice.uploadBundle(new Uint8Array(readFileSync(KV_STORE_WASM)));
    const app = await alice.createApp('kv', bundle, { confirmMethods: ['clear'] });

    const r = await alice.call(app, 'set', { key: 'a', value: '1' }, 'k1');
    expect(r.index).toBeGreaterThan(0);
    expect(r.events).toHaveLength(1);
    const replay = await alice.call(app, 'set', { key: 'a', value: 'other' }, 'k1');
    expect(replay.index).toBe(r.index);

    expect((await again.view(app, 'get', { key: 'a' })).result).toBe('1');
    expect((await again.view(app, 'get', { key: 'a' }, { stale: true, minIndex: r.index })).result).toBe('1');

    // Events replay from the start.
    const ac = new AbortController();
    const first = await alice.events(app, 0, ac.signal).next();
    ac.abort();
    expect(first.value?.kind).toBeTruthy();

    // A confirm method needs a fresh passkey assertion over the exact call.
    await expect(alice.call(app, 'clear', {})).rejects.toMatchObject({ code: 'CONFIRM_REQUIRED' });
    await alice.callConfirmed(app, 'clear', {}, pk);
    expect((await alice.view(app, 'len', {})).result).toBe(0);

    // Others cannot reach an owner-only app.
    const [bob] = await person(2, 'bob');
    await expect(bob.call(app, 'set', { key: 'x', value: 'y' })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // A read-only API key reads, never writes.
    const { key } = await alice.createApiKey({ readOnly: true, apps: [app] });
    const agent = client(2);
    agent.useApiKey(key);
    await agent.view(app, 'len', {});
    const denied = await agent.call(app, 'set', { key: 'x', value: 'y' }).catch((e) => e);
    expect(denied).toBeInstanceOf(CalimeroError);
    expect((denied as CalimeroError).code).toBe('FORBIDDEN');

    // Refresh rotates the session.
    const fresh = await alice.refresh();
    expect(fresh.sessionToken).not.toBe(s.sessionToken);
  });

  it('organizations gate apps and removal cuts access off', async () => {
    const [alice] = await person(0, 'alice-org');
    const [bob] = await person(1, 'bob-org');
    const bobId = (await bob.me()).accountId as string;
    const org = await alice.createOrg('Acme');
    const team = await alice.createTeam(org, 'eng', 'invite');
    const token = await alice.invite(org, 'member', [team]);
    await bob.redeemInvite(token);

    const bundle = await alice.uploadBundle(new Uint8Array(readFileSync(KV_STORE_WASM)));
    const app = await alice.createApp('team-kv', bundle, { org });
    await bob.call(app, 'set', { key: 'from', value: 'bob' });

    await alice.removeMember(org, bobId);
    await new Promise((r) => setTimeout(r, 300));
    await expect(bob.call(app, 'set', { key: 'x', value: 'y' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('stores an app\'s blobs and serves them only to that app', async () => {
    const [alice] = await person(0, 'alice-blobs');
    const bundle = await alice.uploadBundle(new Uint8Array(readFileSync(KV_STORE_WASM)));
    const app = await alice.createApp('files', bundle);
    const other = await alice.createApp('other', bundle);
    const data = new TextEncoder().encode('%PDF-1.7 '.repeat(500));
    const up = await alice.uploadBlob(app, data);
    expect(up.size).toBe(data.length);
    expect(await alice.downloadBlob(app, up.blobId)).toEqual(data);
    expect(await alice.downloadBlob(app, up.id)).toEqual(data);
    await expect(alice.downloadBlob(other, up.blobId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps serving after a node dies', async () => {
    const [alice, pk] = await person(1, 'alice-failover');
    const bundle = await alice.uploadBundle(new Uint8Array(readFileSync(KV_STORE_WASM)));
    const app = await alice.createApp('kv-ha', bundle);
    await alice.call(app, 'set', { key: 'k', value: 'v' });
    cluster.stop(0);
    const other = client(2);
    await other.signIn(pk);
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) {
      try {
        await other.call(app, 'set', { key: 'k2', value: 'v2' }, 'after-failover');
        ok = true;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    expect(ok).toBe(true);
    expect((await other.view(app, 'get', { key: 'k' })).result).toBe('v');
  });
});
