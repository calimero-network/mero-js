import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BadOrigin,
  CalimeroClient,
  CalimeroError,
  ConfirmRequired,
  LoginRequired,
  NotFound,
  OriginNotRegistered,
} from '../../src/cloud-v2/index.js';
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

describe('Calimero 1.0 cluster', () => {
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
    const { key } = await alice.createApiKey({ readOnly: true, apps: [app] }, pk);
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
    const [alice, alicePk] = await person(0, 'alice-org');
    const [bob] = await person(1, 'bob-org');
    const bobId = (await bob.me()).accountId as string;
    const org = await alice.createOrg('Acme');
    const team = await alice.createTeam(org, 'eng', 'invite');
    const token = await alice.invite(org, 'member', alicePk, [team]);
    await bob.redeemInvite(token);

    const bundle = await alice.uploadBundle(new Uint8Array(readFileSync(KV_STORE_WASM)));
    const app = await alice.createApp('team-kv', bundle, { org });
    await bob.call(app, 'set', { key: 'from', value: 'bob' });

    // Removing a member is approved with a passkey; without one the node asks for it.
    await expect(alice.delete(`orgs/${org}/members/${bobId}`)).rejects.toMatchObject({ code: 'CONFIRM_REQUIRED' });
    await alice.removeMember(org, bobId, alicePk);
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
    const [alice, alicePk] = await person(0, 'alice-packages');
    const kv = new Uint8Array(readFileSync(KV_STORE_WASM));
    const key = publisher();

    // An archive with no signature is refused.
    await expect(alice.uploadPackage(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ code: 'BAD_PACKAGE' });

    // Its own bytes: other tests' apps run kv-store uploaded raw, and a bundle is
    // its hash, so 1.0.0 would count as running there and could not be removed.
    const installed = await alice.uploadPackage(signedMpk('com.mero-js.kv', '1.0.0', variant(kv, 'v100'), key));
    expect(installed).toMatchObject({ package: 'com.mero-js.kv', version: '1.0.0', signerId: key.signerId });
    // Another key cannot release the same package.
    await expect(alice.uploadPackage(signedMpk('com.mero-js.kv', '1.1.0', kv, publisher()))).rejects.toMatchObject({
      status: 403,
    });

    const app = await alice.createApp('pkg-kv', { package: 'com.mero-js.kv', version: '1.0.0' });
    await alice.call(app, 'set', { key: 'a', value: '1' });
    expect((await alice.listApps({ package: 'com.mero-js.kv' }))[0]).toMatchObject({ appId: app, version: '1.0.0' });

    await alice.uploadPackage(signedMpk('com.mero-js.kv', '1.0.1', variant(kv, 'v101'), key));
    // The owner approves an upgrade with their passkey.
    await expect(alice.upgradeApp(app, { version: '1.0.1' })).rejects.toMatchObject({ code: 'CONFIRM_REQUIRED' });
    const up = await alice.upgradeApp(app, { version: '1.0.1' }, alicePk);
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

    // A second passkey is another device, approved by the one the account has; it can be removed again.
    const second = new SoftPasskey('localhost', ORIGIN);
    // The new passkey cannot approve its own addition.
    await expect(alice.addPasskey(second, second)).rejects.toBeInstanceOf(CalimeroError);
    const cred = await alice.addPasskey(second, pk);
    const viaSecond = client(2);
    await viaSecond.signIn(second);
    expect((await viaSecond.me()).accountId).toBe((await alice.me()).accountId);
    await expect(alice.delete(`auth/passkeys/${cred}`)).rejects.toMatchObject({ code: 'CONFIRM_REQUIRED' });
    await alice.removePasskey(cred, pk);
    await expect(client(2).signIn(second)).rejects.toBeInstanceOf(CalimeroError);

    await expect(alice.post('auth/apikeys', { label: 'ci' })).rejects.toMatchObject({ code: 'CONFIRM_REQUIRED' });
    const { keyId } = await alice.createApiKey({ label: 'ci' }, pk);
    expect((await alice.listApiKeys()).map((k) => k.keyId)).toContain(keyId);
    // A node from before answers the revocation at once; this one asks for the passkey (412) first.
    await alice.revokeApiKey(keyId, pk);
    expect((await alice.listApiKeys()).map((k) => k.keyId)).not.toContain(keyId);

    const bundle = await alice.uploadBundle(new Uint8Array(readFileSync(KV_STORE_WASM)));
    const app = await alice.createApp('shared', bundle);
    await expect(bob.call(app, 'set', { key: 'x', value: 'y' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await alice.setAccess(app, { kind: 'accounts', accounts: [bobId] });
    await new Promise((r) => setTimeout(r, 300));
    await bob.call(app, 'set', { key: 'x', value: 'y' });

    const org = await alice.createOrg('Initech');
    await alice.setMember(org, bobId, 'member', pk);
    const team = await alice.createTeam(org, 'ops', 'invite');
    await alice.setTeamMember(org, team, bobId, pk, { role: 'readOnly' });
    expect(await alice.getTeam(org, team)).toMatchObject({ teamId: team });
    await alice.updateTeam(org, team, { name: 'platform', metadata: { colour: 'blue' } });
    expect(await alice.getTeam(org, team)).toMatchObject({ name: 'platform' });
    await alice.setCapabilities(org, 0, pk, { account: bobId });
    await alice.removeTeamMember(org, team, bobId, pk);
    // `ops` holds no apps: it goes without a passkey.
    await alice.deleteTeam(org, team);
    await expect(alice.getTeam(org, team)).rejects.toMatchObject({ status: 404 });
    // A team whose sub-team holds an app goes with alice's passkey, and the node's ask names the app
    // (core#4891). A node from before deletes it at once, so the 412 is checked only where it is asked.
    const eng = await alice.createTeam(org, 'eng', 'invite');
    const backend = await alice.createTeam(org, 'backend', 'invite', eng);
    const teamApp = await alice.createApp('eng-kv', bundle, { org, access: { kind: 'team', team: backend } });
    const asked = await alice.deleteTeam(org, eng).then(() => undefined, (e: unknown) => e);
    if (asked !== undefined) {
      expect(asked).toMatchObject({ status: 412, code: 'CONFIRM_REQUIRED', details: { apps: [teamApp] } });
      expect(await alice.getApp(teamApp)).toBeTruthy();
      await alice.deleteTeam(org, eng, pk);
    }
    await new Promise((r) => setTimeout(r, 300));
    await expect(alice.getTeam(org, eng)).rejects.toMatchObject({ status: 404 });
    await expect(alice.getApp(teamApp)).rejects.toMatchObject({ status: 404 });
    const token = await alice.invite(org, 'guest', pk, [], { ttlSecs: 60, uses: 1 });
    expect(token).toBeTruthy();
    expect(await alice.getOrg(org)).toMatchObject({ orgId: org });
  });

  it('sets aliases, deletes an org with the owner\'s passkey and signs out everywhere', async () => {
    const [alice, pk] = await person(0, 'alice-aliases');
    const bundle = await alice.uploadBundle(new Uint8Array(readFileSync(KV_STORE_WASM)));
    const app = await alice.createApp('kv-alias', bundle);
    await alice.setAlias('notes', app);
    expect(await alice.aliases()).toEqual({ notes: app });
    await alice.deleteAlias('notes');
    expect(await alice.aliases()).toEqual({});

    const org = await alice.createOrg('doomed');
    await expect(alice.delete(`orgs/${org}`)).rejects.toMatchObject({ code: 'CONFIRM_REQUIRED' });
    await alice.deleteOrg(org, pk);
    await expect(alice.getOrg(org)).rejects.toMatchObject({ status: 404 });

    const laptop = client(1);
    await laptop.signIn(pk);
    await alice.signOutEverywhere();
    await expect(laptop.me()).rejects.toMatchObject({ status: 401 });
  });

  it("runs the console's passkey actions: org upgrade runs, outbound and release approvals", async () => {
    const [alice, pk] = await person(0, 'alice-console');
    const [bob] = await person(1, 'bob-console');
    const bobId = (await bob.me()).accountId as string;
    // Signed in again elsewhere, as the console does with a fresh tab.
    const tab = client(2);
    expect((await tab.signIn(pk)).accountId).toBe((await alice.me()).accountId);

    const org = await tab.createOrg('Console Co');
    const kv = new Uint8Array(readFileSync(KV_STORE_WASM));
    const key = publisher();
    await tab.uploadPackage(signedMpk('com.mero-js.console', '1.0.0', variant(kv, 'c100'), key));
    await tab.uploadPackage(signedMpk('com.mero-js.console', '1.0.1', variant(kv, 'c101'), key));
    // A dev cluster has no registry: the install reaches the node and is refused there.
    await expect(tab.installPackage('com.mero-js.console', '1.0.1')).rejects.toMatchObject({ code: 'NO_REGISTRY' });

    const app = await tab.createApp('console-kv', { package: 'com.mero-js.console', version: '1.0.0' }, { org });
    await tab.call(app, 'set', { key: 'a', value: '1' });

    // One passkey approval for the whole run, then follow it.
    await expect(tab.post(`orgs/${org}/upgrade`, { package: 'com.mero-js.console', version: '1.0.1' })).rejects.toMatchObject({
      code: 'CONFIRM_REQUIRED',
    });
    let run = await tab.upgradeOrg(org, { package: 'com.mero-js.console', version: '1.0.1' }, pk);
    expect(run).toMatchObject({ package: 'com.mero-js.console', version: '1.0.1', apps: [app] });
    for (let i = 0; i < 50 && !run.finished; i++) {
      await new Promise((r) => setTimeout(r, 200));
      run = await tab.upgradeRun(org, run.runId);
    }
    expect(run).toMatchObject({ finished: true, done: [app], failed: {} });
    expect((await tab.listApps({ package: 'com.mero-js.console' }))[0]).toMatchObject({ appId: app, version: '1.0.1' });
    expect((await tab.view(app, 'get', { key: 'a' })).result).toBe('1');
    // Nothing failed, so a retry has nothing to run.
    const retried = await tab.retryUpgradeRun(org, run.runId, pk);
    expect(retried.apps).toEqual([]);
    expect(retried.runId).not.toBe(run.runId);

    // Outbound: the release declares no prefixes; approving and revoking them is the owner's.
    await tab.approveOutbound(org, 'com.mero-js.console', pk);
    await tab.approveOutbound(org, 'com.mero-js.console', pk, { prefixes: [], replace: true });
    await tab.approveOutbound(null, 'com.mero-js.console', pk);

    // Releases: approve one for the org and for the account, then withdraw it.
    await tab.approveRelease(org, '2.3.200', pk);
    await tab.approveRelease(null, '2.3.200', pk);
    await tab.approveRelease(null, '2.3.200', pk, false);

    const { key: apiKey, keyId } = await tab.createApiKey({ label: 'console', apps: [app], readOnly: true }, pk);
    expect(apiKey).toBeTruthy();
    await tab.revokeApiKey(keyId, pk);
    expect((await tab.listApiKeys()).map((k) => k.keyId)).not.toContain(keyId);
    const token = await tab.invite(org, 'member', pk);
    await bob.redeemInvite(token);
    expect(bobId).toBeTruthy();
  });

  it("dates the account's passkeys, lists its sessions and ends one, on a node that has them (core #4894)", async () => {
    const [laptop, pk] = await person(0, 'alice-sessions');
    const me = await laptop.me();
    const mine = me.passkeys?.find((p) => p.id === me.passkeyId);
    expect(mine).toBeTruthy();
    const phone = client(1);
    await phone.signIn(pk);

    let sessions;
    try {
      sessions = await laptop.listSessions();
    } catch (error) {
      // merod 1.0.0-rc.14 and earlier: no `/auth/sessions`, no passkey times.
      if (!(error instanceof CalimeroError && error.status === 404)) throw error;
      expect(mine?.addedAt ?? null).toBeNull();
      return;
    }
    expect(mine?.addedAt).toEqual(expect.any(Number));
    expect(mine?.lastSignInAt).toBeGreaterThanOrEqual(mine?.addedAt as number);

    expect(sessions).toHaveLength(2);
    const own = sessions.find((s) => s.current);
    const other = sessions.find((s) => !s.current);
    expect(own && other).toBeTruthy();
    for (const s of sessions) {
      expect(s.passkey).toBe(me.passkeyId);
      expect(s.app).toBeNull();
      expect(s.lastActiveAt).toEqual(expect.any(Number));
    }
    expect((await phone.listSessions()).find((s) => s.current)?.session).toBe(other?.session);

    // The laptop ends the phone's session: the phone must sign in again.
    await laptop.revokeSession(other?.session as string);
    await expect(phone.me()).rejects.toBeInstanceOf(LoginRequired);
    expect((await laptop.listSessions()).map((s) => s.session)).toEqual([own?.session]);
    await expect(laptop.revokeSession(other?.session as string)).rejects.toBeInstanceOf(NotFound);
    expect((await laptop.me()).accountId).toBe(me.accountId);
  });

  it("lists the account's sign-ins and approvals, on a node that has them (core #4901)", async () => {
    const [laptop, pk] = await person(0, 'alice-activity');
    const me = await laptop.me();
    let activity;
    try {
      activity = await laptop.listActivity();
    } catch (error) {
      // merod before core #4901: no `/auth/activity` (a bare `404`).
      if (!(error instanceof CalimeroError && error.status === 404) || error instanceof NotFound) throw error;
      return;
    }
    expect(activity).toEqual([
      expect.objectContaining({ kind: 'signIn', passkey: me.passkeyId, app: null, origin: null }),
    ]);
    const signedUp = activity[0]?.at as number;

    await laptop.createApiKey({ label: 'ci' }, pk);
    activity = await laptop.listActivity();
    expect(activity.map((a) => [a.kind, a.method, a.passkey])).toEqual([
      ['approval', '__create_api_key', me.passkeyId],
      ['signIn', null, me.passkeyId],
    ]);
    // `after` keeps only what came later.
    expect((await laptop.listActivity(signedUp)).every((a) => a.at > signedUp)).toBe(true);

    // Each account reads only its own.
    const [bob] = await person(1, 'bob-activity');
    const bobs = await bob.listActivity();
    expect(bobs).toHaveLength(1);
    expect(bobs[0]?.passkey).not.toBe(me.passkeyId);
  });

  it("covers the rest of 1.0's routes: metadata, usage, blobs, presence, transfer", async () => {
    const [alice, pk] = await person(0, 'alice-rest');
    const [bob] = await person(1, 'bob-rest');
    const bobId = (await bob.me()).accountId as string;
    const me = await alice.me();

    await alice.labelPasskey(me.passkeyId as string, 'laptop');
    expect(await alice.usage()).toBeTruthy();
    const doc = await alice.attestation();
    expect(doc.mock).toBe(true);

    const org = await alice.createOrg('Rest Co');
    await alice.setMember(org, bobId, 'member', pk);
    await alice.setOrgMetadata(org, { colour: 'teal' });
    await bob.setMemberMetadata(org, bobId, { title: 'engineer' });
    await alice.setMemberMetadata(org, bobId, null);

    const bundle = await alice.uploadBundle(new Uint8Array(readFileSync(KV_STORE_WASM)));
    const app = await alice.createApp('rest-kv', bundle, { org });
    await alice.setAlias('rest', app);
    expect(await alice.alias('rest')).toBe(app);
    await alice.setAppMetadata(app, { icon: 'k' });
    await alice.call(app, 'set', { key: 'a', value: '1' });
    expect(await alice.appStorage(app)).toHaveProperty('keys');
    expect(await alice.appAbi(app)).toHaveProperty('bundle');

    const up = await alice.uploadBlob(app, new TextEncoder().encode('hello blob'));
    expect((await alice.listBlobs(app)).map((b) => b.id)).toContain(up.id);
    expect(await alice.blobInfo(app, up.blobId)).toMatchObject({ id: up.id, size: 10 });
    await alice.deleteBlob(app, up.blobId);
    await expect(alice.blobInfo(app, up.blobId)).rejects.toMatchObject({ status: 404 });

    await alice.publishPresence(app, 1, new Uint8Array([1, 2, 3]));
    expect(await alice.presence(app)).toContainEqual(expect.objectContaining({ state: '010203' }));
    const ac = new AbortController();
    const first = await alice.presenceStream(app, ac.signal).next();
    ac.abort();
    expect(first.value?.kind).toBe('snapshot');
    await alice.publishPresence(app, 2, null);

    await alice.transferApp(app, bobId, pk);
    expect(await bob.getApp(app)).toMatchObject({ owner: bobId });
  });

  // Core's `feat/move-app-to-org`: a node without the route answers the move
  // 404, and the case is skipped.
  it('moves an app with its people into another organization, its data kept', async (ctx) => {
    const [alice, pk] = await person(0, 'alice-move');
    const [bob] = await person(1, 'bob-move');
    const bobId = (await bob.me()).accountId as string;
    const bundle = await alice.uploadBundle(new Uint8Array(readFileSync(KV_STORE_WASM)));
    const src = await alice.createOrg('move-src');
    const dst = await alice.createOrg('move-dst');
    await alice.setMember(src, bobId, 'member', pk);
    const app = await alice.createApp('moving', bundle, { org: src });
    await alice.call(app, 'set', { key: 'a', value: '1' });
    const moved = await alice.moveApp(app, dst, { bringMembers: true }, pk).catch((e: unknown) => e);
    if (moved instanceof CalimeroError && (moved.status === 404 || moved.status === 405)) return ctx.skip();
    expect(moved).toMatchObject({ appId: app, from: src, org: dst, added: [bobId], access: { kind: 'org' } });
    expect(await alice.getApp(app)).toMatchObject({ org: dst });
    expect((await bob.view(app, 'get', { key: 'a' })).result).toBe('1');
    // Back again, now without a passkey: the node asks for one.
    await expect(alice.moveApp(app, src)).rejects.toBeInstanceOf(ConfirmRequired);
  });

  // Core's `claude/package-origins`: a node without the routes answers the
  // listing of an installed package 404, and the case is skipped.
  it("registers a package's own origin, signs in from it, and removes it", async (ctx) => {
    const [alice, alicePk] = await person(0, 'alice-origins');
    const pkg = 'com.mero-js.origins';
    const kv = new Uint8Array(readFileSync(KV_STORE_WASM));
    await alice.uploadPackage(signedMpk(pkg, '1.0.0', variant(kv, 'origins'), publisher()));
    const listed = await alice.packageOrigins.list(pkg).catch((e: unknown) => e);
    if (listed instanceof CalimeroError && (listed.status === 404 || listed.status === 405)) return ctx.skip();
    expect(listed).toEqual([]);

    const site = 'https://chat.mero-js.test';
    // Adding one is a step-up; without a passkey the node asks for it.
    await expect(alice.packageOrigins.add(pkg, site)).rejects.toBeInstanceOf(ConfirmRequired);
    const added = await alice.packageOrigins.add(pkg, site, alicePk);
    expect(added).toMatchObject({ package: pkg, origin: site, rpId: 'chat.mero-js.test' });
    expect((await alice.packageOrigins.list(pkg)).map((o) => o.origin)).toEqual([site]);
    await expect(alice.packageOrigins.add(pkg, 'not an origin', alicePk)).rejects.toBeInstanceOf(BadOrigin);

    // A person signs up on the developer's site: the passkey is that site's,
    // the session bound to the package.
    const carol = client(1);
    const carolPk = new SoftPasskey('chat.mero-js.test', site);
    await carol.signUp(carolPk, 'carol', { origin: site });
    const me = await carol.me();
    expect(me.origin).toBe(site);
    expect(me.app).toBeTruthy();
    const again = client(2);
    await again.signIn(carolPk, { origin: site });

    // A site nobody registered is refused before any passkey prompt.
    const stranger = await client(0)
      .signIn(new SoftPasskey('stranger.mero-js.test', 'https://stranger.mero-js.test'), {
        origin: 'https://stranger.mero-js.test',
      })
      .catch((e: unknown) => e);
    expect(stranger).toBeInstanceOf(OriginNotRegistered);
    expect((stranger as OriginNotRegistered).origin).toBe('https://stranger.mero-js.test');

    // Removing the origin ends the sessions opened there.
    expect(await alice.packageOrigins.remove(pkg, site, alicePk)).toMatchObject({ package: pkg, origin: site, removed: true });
    await new Promise((r) => setTimeout(r, 300));
    await expect(carol.me()).rejects.toBeInstanceOf(LoginRequired);
    await expect(alice.packageOrigins.remove(pkg, site, alicePk)).rejects.toBeInstanceOf(NotFound);
    expect(await alice.packageOrigins.list(pkg)).toEqual([]);
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
