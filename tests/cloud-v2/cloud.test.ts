import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CalimeroClient, CalimeroError } from '../../src/cloud-v2/index.js';
import { KV_STORE_WASM, startCluster, type LocalCluster } from './cluster.js';
import { publisher, signedMpk, variant } from './mpk.js';
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

  it('installs signed packages, refuses unsigned ones, upgrades by version, uninstalls and deletes', async () => {
    const [alice] = await person(0, 'alice-packages');
    const kv = new Uint8Array(readFileSync(KV_STORE_WASM));
    const key = publisher();

    // An archive with no signature is refused.
    await expect(alice.uploadPackage(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ code: 'BAD_PACKAGE' });

    const installed = await alice.uploadPackage(signedMpk('com.mero-js.kv', '1.0.0', kv, key));
    expect(installed).toMatchObject({ package: 'com.mero-js.kv', version: '1.0.0', signerId: key.signerId });
    // Another key cannot release the same package.
    await expect(alice.uploadPackage(signedMpk('com.mero-js.kv', '1.1.0', kv, publisher()))).rejects.toMatchObject({
      status: 403,
    });

    const app = await alice.createApp('pkg-kv', { package: 'com.mero-js.kv', version: '1.0.0' });
    await alice.call(app, 'set', { key: 'a', value: '1' });
    expect((await alice.listApps({ package: 'com.mero-js.kv' }))[0]).toMatchObject({ appId: app, version: '1.0.0' });

    await alice.uploadPackage(signedMpk('com.mero-js.kv', '1.0.1', variant(kv, 'v101'), key));
    const up = await alice.upgradeApp(app, { version: '1.0.1' });
    expect(up.status).toBe('ok');
    expect((await alice.view(app, 'get', { key: 'a' })).result).toBe('1');
    const info = await alice.package('com.mero-js.kv');
    expect(info.latest).toBe('1.0.1');
    expect(info.versions.map((v) => v.version)).toEqual(['1.0.0', '1.0.1']);

    await expect(alice.uninstallPackage('com.mero-js.kv', '1.0.1')).rejects.toThrow(/still runs/);
    await alice.uninstallPackage('com.mero-js.kv', '1.0.0');
    await alice.deleteApp(app);
    await expect(alice.getApp(app)).rejects.toMatchObject({ status: 404 });
    await alice.uninstallPackage('com.mero-js.kv');
    expect((await alice.packages()).map((p) => p.package)).not.toContain('com.mero-js.kv');
  });

  it('covers the rest of the API: passkeys, API keys, access, orgs and teams', async () => {
    const [alice, pk] = await person(0, 'alice-api');
    const [bob] = await person(1, 'bob-api');
    const bobId = (await bob.me()).accountId as string;

    // A second passkey is another device; it can be removed again.
    const second = new SoftPasskey('localhost', ORIGIN);
    const cred = await alice.addPasskey(second);
    const viaSecond = client(2);
    await viaSecond.signIn(second);
    expect((await viaSecond.me()).accountId).toBe((await alice.me()).accountId);
    await alice.removePasskey(cred);
    await expect(client(2).signIn(second)).rejects.toBeInstanceOf(CalimeroError);
    void pk;

    const { keyId } = await alice.createApiKey({ label: 'ci' });
    expect((await alice.listApiKeys()).map((k) => k.keyId)).toContain(keyId);
    await alice.revokeApiKey(keyId);
    expect((await alice.listApiKeys()).map((k) => k.keyId)).not.toContain(keyId);

    const bundle = await alice.uploadBundle(new Uint8Array(readFileSync(KV_STORE_WASM)));
    const app = await alice.createApp('shared', bundle);
    await expect(bob.call(app, 'set', { key: 'x', value: 'y' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await alice.setAccess(app, { kind: 'accounts', accounts: [bobId] });
    await new Promise((r) => setTimeout(r, 300));
    await bob.call(app, 'set', { key: 'x', value: 'y' });

    const org = await alice.createOrg('Initech');
    await alice.setMember(org, bobId, 'member');
    const team = await alice.createTeam(org, 'ops', 'invite');
    await alice.setTeamMember(org, team, bobId, { role: 'readOnly' });
    expect(await alice.getTeam(org, team)).toMatchObject({ teamId: team });
    await alice.updateTeam(org, team, { name: 'platform', metadata: { colour: 'blue' } });
    expect(await alice.getTeam(org, team)).toMatchObject({ name: 'platform' });
    await alice.setCapabilities(org, 0, { account: bobId });
    await alice.removeTeamMember(org, team, bobId);
    await alice.deleteTeam(org, team);
    await expect(alice.getTeam(org, team)).rejects.toMatchObject({ status: 404 });
    const token = await alice.invite(org, 'guest', [], { ttlSecs: 60, uses: 1 });
    expect(token).toBeTruthy();
    expect(await alice.getOrg(org)).toMatchObject({ orgId: org });
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
