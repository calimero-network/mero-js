/**
 * Each CalimeroClient method sends the route and body core 1.0's node API
 * (`crates/node/src/api.rs`) takes, through the real sealed channel to a
 * stand-in node. The passkey flows mdma's console runs in the browser come
 * first. Synthetic data only.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { StandInCloudNode } from '../../tests/cloud-v2/stand-in-node.js';
import {
  CalimeroClient,
  ConfirmCancelled,
  ConfirmRequired,
  NotFound,
  ORG_CAPABILITIES,
  deployerKey,
  frontendManifest,
  orgCapabilities,
  pageDeployment,
  type UpgradeRun,
} from './index.js';
import type { PasskeyProvider } from './passkey.js';

const node = new StandInCloudNode();
beforeAll(() => node.start());
afterAll(() => node.stop());
beforeEach(() => {
  node.requests.length = 0;
  node.answer = () => ({ status: 200, json: {} });
});

const client = () => new CalimeroClient({ baseUrl: node.url, policy: { allowMock: true } });
const sent = () => node.requests.map((r) => [r.head.method, r.head.path]);
const last = () => node.requests[node.requests.length - 1];
const passkey: PasskeyProvider = {
  create: async () => ({ attestationObject: 'ao', clientDataJson: 'cd' }),
  get: async () => ({ credentialId: 'cred', authenticatorData: 'ad', clientDataJson: 'cd', signature: 'sig' }),
};
const CHALLENGE = { challengeId: 'c-1', challenge: 'AAEC', rpId: 'localhost' };
/** Answers 412 CONFIRM_REQUIRED until the body carries a confirmation, then `json`. */
const confirming = (json: unknown) => {
  node.answer = (_, body) =>
    body.confirm
      ? { status: 200, json }
      : { status: 412, json: { error: 'CONFIRM_REQUIRED', message: 'approve', details: CHALLENGE } };
};
const RUN: UpgradeRun = {
  runId: 'r-1',
  package: 'com.example.kv',
  version: '1.1.0',
  cascade: false,
  by: 'acc-1',
  startedAt: 1,
  apps: ['a-1', 'a-2'],
  done: ['a-1'],
  failed: { 'a-2': 'migration failed' },
  finished: true,
};

describe("the console's passkey actions", () => {
  it('signs in, creates an org and installs a package', async () => {
    const c = client();
    node.answer = (head) => {
      if (head.path === '/auth/passkey/login/begin') return { status: 200, json: { challengeId: 'l-1', options: CHALLENGE } };
      if (head.path === '/auth/passkey/login/finish') {
        return { status: 200, json: { accountId: 'acc-1', sessionToken: 'tok', expiresAt: 9e9, refreshToken: 'r' } };
      }
      if (head.path === '/orgs') return { status: 200, json: { orgId: 'org-1' } };
      return { status: 200, json: { package: 'com.example.kv', version: '1.0.0', signerId: 'did:key:z', services: {} } };
    };
    const session = await c.signIn(passkey);
    expect(session.accountId).toBe('acc-1');
    expect(c.session).toEqual(session);
    expect(await c.createOrg('Acme')).toBe('org-1');
    await c.installPackage('com.example.kv', '1.0.0');
    expect(sent()).toEqual([
      ['POST', '/auth/passkey/login/begin'],
      ['POST', '/auth/passkey/login/finish'],
      ['POST', '/orgs'],
      ['POST', '/packages/install'],
    ]);
    expect(node.requests[1].body).toEqual({ challengeId: 'l-1', assertion: expect.objectContaining({ signature: 'sig' }) });
    expect(node.requests[2].body).toEqual({ name: 'Acme' });
    expect(last().body).toEqual({ package: 'com.example.kv', version: '1.0.0' });
    expect(last().head.headers).toContainEqual(['authorization', 'Bearer tok']);
  });

  it('signs up: the new passkey registers, then signs the account it creates', async () => {
    const c = client();
    node.answer = (head, body) => {
      if (head.path === '/auth/passkey/register/begin') return { status: 200, json: { challengeId: 'r-1', options: { challenge: 'AAEC' } } };
      if (!body.confirm) {
        return {
          status: 412,
          json: { error: 'CONFIRM_REQUIRED', message: 'sign', details: { ...CHALLENGE, allowCredentials: ['cred'] } },
        };
      }
      return { status: 200, json: { accountId: 'acc-1', sessionToken: 'tok', expiresAt: 9e9, refreshToken: 'r' } };
    };
    const session = await c.signUp(passkey, 'alice');
    expect(session.accountId).toBe('acc-1');
    expect(c.session).toEqual(session);
    expect(sent()).toEqual([
      ['POST', '/auth/passkey/register/begin'],
      ['POST', '/auth/passkey/register/finish'],
      ['POST', '/auth/passkey/register/finish'],
    ]);
    const registration = { attestationObject: 'ao', clientDataJson: 'cd' };
    expect(node.requests[1].body).toEqual({ challengeId: 'r-1', registration });
    expect(last().body).toEqual({
      challengeId: 'r-1',
      registration,
      confirm: { challengeId: 'c-1', assertion: expect.objectContaining({ signature: 'sig' }) },
    });
  });

  it('upgrades an org with one passkey approval, follows the run and retries it', async () => {
    const c = client();
    confirming(RUN);
    const run = await c.upgradeOrg('org-1', { package: 'com.example.kv', version: '1.1.0', cascade: true }, passkey);
    expect(run).toEqual(RUN);
    expect(sent()).toEqual([
      ['POST', '/orgs/org-1/upgrade'],
      ['POST', '/orgs/org-1/upgrade'],
    ]);
    expect(last().body).toEqual({
      package: 'com.example.kv',
      version: '1.1.0',
      cascade: true,
      confirm: { challengeId: 'c-1', assertion: expect.objectContaining({ signature: 'sig' }) },
    });

    node.requests.length = 0;
    node.answer = () => ({ status: 200, json: RUN });
    expect(await c.upgradeRun('org-1', 'r-1')).toEqual(RUN);
    expect(sent()).toEqual([['GET', '/orgs/org-1/upgrades/r-1']]);

    node.requests.length = 0;
    confirming({ ...RUN, runId: 'r-2' });
    expect((await c.retryUpgradeRun('org-1', 'r-1', passkey)).runId).toBe('r-2');
    expect(sent()).toEqual([
      ['POST', '/orgs/org-1/upgrades/r-1/retry'],
      ['POST', '/orgs/org-1/upgrades/r-1/retry'],
    ]);
  });

  it('postConfirmed reaches orgs/{org}/upgrade and /outbound as the console calls it', async () => {
    const c = client();
    confirming({ runId: 'r-9' });
    expect(await c.postConfirmed('orgs/org-1/upgrade', { package: 'p', version: '2.0.0' }, passkey)).toEqual({ runId: 'r-9' });
    confirming({ ok: true });
    await c.postConfirmed('orgs/org-1/outbound', { package: 'p' }, passkey);
    expect(sent()).toEqual([
      ['POST', '/orgs/org-1/upgrade'],
      ['POST', '/orgs/org-1/upgrade'],
      ['POST', '/orgs/org-1/outbound'],
      ['POST', '/orgs/org-1/outbound'],
    ]);
  });

  it('approves outbound prefixes and releases, for an org or for the account', async () => {
    const c = client();
    confirming({});
    await c.approveOutbound('org-1', 'com.example.kv', passkey);
    expect(last().head.path).toBe('/orgs/org-1/outbound');
    expect(last().body).toMatchObject({ package: 'com.example.kv', prefixes: 'manifest', replace: false });
    await c.approveOutbound(null, 'com.example.kv', passkey, { prefixes: ['https://api.example/'], replace: true });
    expect(last().head.path).toBe('/auth/outbound');
    expect(last().body).toMatchObject({ prefixes: ['https://api.example/'], replace: true, confirm: { challengeId: 'c-1' } });
    await c.approveRelease('org-1', '2.3.120', passkey);
    expect(last().head.path).toBe('/orgs/org-1/releases');
    expect(last().body).toMatchObject({ version: '2.3.120', approved: true });
    await c.approveRelease(null, '2.3.110', passkey, false);
    expect(last().head.path).toBe('/auth/releases');
    expect(last().body).toMatchObject({ version: '2.3.110', approved: false });
  });

  it('creates and revokes an API key and mints an invite, each create approved with the passkey', async () => {
    const c = client();
    node.answer = (head, body) => {
      if (!body.confirm) {
        return { status: 412, json: { error: 'CONFIRM_REQUIRED', message: 'approve', details: CHALLENGE } };
      }
      return head.path === '/auth/apikeys'
        ? { status: 200, json: { keyId: 'k-1', key: 'cal_secret' } }
        : { status: 200, json: { token: 'inv-1' } };
    };
    expect(await c.createApiKey({ label: 'ci', apps: ['a-1'], readOnly: true }, passkey)).toEqual({
      keyId: 'k-1',
      key: 'cal_secret',
    });
    expect(node.requests[0].body).toEqual({ label: 'ci', apps: ['a-1'], readOnly: true });
    expect(node.requests[1].body).toEqual({
      label: 'ci',
      apps: ['a-1'],
      readOnly: true,
      confirm: { challengeId: 'c-1', assertion: expect.objectContaining({ signature: 'sig' }) },
    });
    await c.revokeApiKey('k-1', passkey);
    expect(await c.invite('org-1', 'member', passkey, ['t-1'], { ttlSecs: 60, uses: 2 })).toBe('inv-1');
    expect(sent()).toEqual([
      ['POST', '/auth/apikeys'],
      ['POST', '/auth/apikeys'],
      ['DELETE', '/auth/apikeys/k-1'],
      ['DELETE', '/auth/apikeys/k-1'],
      ['POST', '/orgs/org-1/invites'],
      ['POST', '/orgs/org-1/invites'],
    ]);
    expect(node.requests[3].body).toEqual({ confirm: { challengeId: 'c-1', assertion: expect.anything() } });
    expect(node.requests[4].body).toEqual({ role: 'member', teams: ['t-1'], ttlSecs: 60, uses: 2 });
    expect(last().body).toEqual({ role: 'member', teams: ['t-1'], ttlSecs: 60, uses: 2, confirm: { challengeId: 'c-1', assertion: expect.anything() } });
  });
});

describe('credentials, memberships and invites are approved with a passkey (412 CONFIRM_REQUIRED)', () => {
  /** A passkey that records the credentials it was allowed to sign with. */
  const recording = (signature: string) => {
    const allowed: Array<string[] | undefined> = [];
    const created: Array<Record<string, unknown>> = [];
    const pk: PasskeyProvider = {
      create: async (options) => {
        created.push(options);
        return { attestationObject: `ao-${signature}`, clientDataJson: 'cd' };
      },
      get: async (_challenge, _rpId, allow) => {
        allowed.push(allow);
        return { credentialId: `cred-${signature}`, authenticatorData: 'ad', clientDataJson: 'cd', signature };
      },
    };
    return { pk, allowed, created };
  };

  it("adds a passkey: the new one registers, one the account already has approves", async () => {
    const c = client();
    const fresh = recording('new');
    const existing = recording('old');
    node.answer = (head, body) => {
      if (head.path === '/auth/passkeys/add/begin') return { status: 200, json: { challengeId: 'a-1', options: { challenge: 'AAEC' } } };
      if (!body.confirm) {
        return {
          status: 412,
          json: { error: 'CONFIRM_REQUIRED', message: 'approve', details: { ...CHALLENGE, allowCredentials: ['cred-old'] } },
        };
      }
      return { status: 200, json: { credentialId: 'cred-new' } };
    };
    expect(await c.addPasskey(fresh.pk, existing.pk)).toBe('cred-new');
    expect(sent()).toEqual([
      ['POST', '/auth/passkeys/add/begin'],
      ['POST', '/auth/passkeys/add/finish'],
      ['POST', '/auth/passkeys/add/finish'],
    ]);
    const registration = { attestationObject: 'ao-new', clientDataJson: 'cd' };
    expect(node.requests[1].body).toEqual({ challengeId: 'a-1', registration });
    // The same registration again, approved by the existing passkey, limited to the account's credentials.
    expect(last().body).toEqual({
      challengeId: 'a-1',
      registration,
      confirm: { challengeId: 'c-1', assertion: expect.objectContaining({ credentialId: 'cred-old', signature: 'old' }) },
    });
    expect(fresh.created).toEqual([{ challenge: 'AAEC' }]);
    expect(fresh.allowed).toEqual([]);
    expect(existing.allowed).toEqual([['cred-old']]);
  });

  type Case = [string, (c: CalimeroClient) => Promise<unknown>, 'POST' | 'DELETE', string, Record<string, unknown>];
  const cases: Case[] = [
    ['removePasskey', (c) => c.removePasskey('cred/1', passkey), 'DELETE', '/auth/passkeys/cred%2F1', {}],
    ['setMember', (c) => c.setMember('org-1', 'acc-2', 'admin', passkey), 'POST', '/orgs/org-1/members', { account: 'acc-2', role: 'admin' }],
    ['removeMember', (c) => c.removeMember('org-1', 'acc-2', passkey), 'DELETE', '/orgs/org-1/members/acc-2', {}],
    [
      'setCapabilities',
      (c) => c.setCapabilities('org-1', 17, passkey, { account: 'acc-2', team: 't-1' }),
      'POST',
      '/orgs/org-1/capabilities',
      { capabilities: 17, account: 'acc-2', team: 't-1' },
    ],
    ['setCapabilities (default)', (c) => c.setCapabilities('org-1', 4, passkey), 'POST', '/orgs/org-1/capabilities', { capabilities: 4 }],
    [
      'setTeamMember',
      (c) => c.setTeamMember('org-1', 't-1', 'acc-2', passkey, { role: 'readOnly' }),
      'POST',
      '/orgs/org-1/teams/t-1/members',
      { account: 'acc-2', role: 'readOnly' },
    ],
    ['removeTeamMember', (c) => c.removeTeamMember('org-1', 't-1', 'acc-2', passkey), 'DELETE', '/orgs/org-1/teams/t-1/members/acc-2', {}],
    ['invite', (c) => c.invite('org-1', 'guest', passkey), 'POST', '/orgs/org-1/invites', { role: 'guest', teams: [] }],
  ];

  it.each(cases)('%s answers the 412 and sends the same body again with confirm', async (_, act, method, path, body) => {
    confirming({ token: 'inv-1' });
    await act(client());
    expect(sent()).toEqual([
      [method, path],
      [method, path],
    ]);
    expect(node.requests[0].body).toEqual(body);
    expect(last().body).toEqual({
      ...body,
      confirm: { challengeId: 'c-1', assertion: expect.objectContaining({ signature: 'sig' }) },
    });
  });

  it('without a passkey the 412 is ConfirmRequired, carrying the challenge, and nothing more is sent', async () => {
    confirming({});
    const none = undefined as unknown as PasskeyProvider;
    const error = await client()
      .removeMember('org-1', 'acc-2', none)
      .then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(ConfirmRequired);
    expect(error).toMatchObject({ status: 412, code: 'CONFIRM_REQUIRED', details: CHALLENGE });
    expect(sent()).toEqual([['DELETE', '/orgs/org-1/members/acc-2']]);
  });

  it('a declined prompt is ConfirmCancelled, and the confirmed request is never sent', async () => {
    confirming({});
    const declining: PasskeyProvider = {
      ...passkey,
      get: async () => {
        throw Object.assign(new Error('not allowed'), { name: 'NotAllowedError' });
      },
    };
    const error = await client()
      .setMember('org-1', 'acc-2', 'member', declining)
      .then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(ConfirmCancelled);
    expect(sent()).toEqual([['POST', '/orgs/org-1/members']]);
  });

  it('redeeming an invite asks for nothing', async () => {
    node.answer = () => ({ status: 200, json: { orgId: 'org-1' } });
    expect(await client().redeemInvite('inv-1')).toEqual({ orgId: 'org-1' });
    expect(sent()).toEqual([['POST', '/invites/inv-1/redeem']]);
    expect(last().body).toEqual({});
  });
});

describe('the rest of the node API', () => {
  it('labels a passkey, reads usage and an alias', async () => {
    const c = client();
    node.answer = (head) =>
      head.path.startsWith('/auth/aliases/') ? { status: 200, json: { alias: 'kv', appId: 'a-1' } } : { status: 200, json: { apps: 1 } };
    await c.labelPasskey('cred/1', 'laptop');
    expect(last().body).toEqual({ label: 'laptop' });
    expect(await c.usage()).toEqual({ apps: 1 });
    expect(await c.alias('kv')).toBe('a-1');
    expect(sent()).toEqual([
      ['POST', '/auth/passkeys/cred%2F1'],
      ['GET', '/auth/usage'],
      ['GET', '/auth/aliases/kv'],
    ]);
  });

  it("covers an app's metadata, storage, ABI, transfer and blobs", async () => {
    const c = client();
    const blob = { blobId: '3yZe7d', id: 'ab'.repeat(32), size: 3 };
    node.answer = (head, body) => {
      if (head.path.endsWith('/transfer')) {
        return body.confirm
          ? { status: 200, json: {} }
          : { status: 412, json: { error: 'CONFIRM_REQUIRED', message: '', details: CHALLENGE } };
      }
      if (head.path === '/apps/a-1/blobs') return { status: 200, json: { blobs: [blob] } };
      if (head.path.endsWith('/info')) return { status: 200, json: blob };
      return { status: 200, json: { keys: 1 } };
    };
    await c.setAppMetadata('a-1', { colour: 'teal' });
    expect(last().body).toEqual({ metadata: { colour: 'teal' } });
    expect(await c.appStorage('a-1')).toEqual({ keys: 1 });
    await c.appAbi('a-1');
    await c.transferApp('a-1', 'acc-2', passkey);
    expect(last().body).toMatchObject({ to: 'acc-2', confirm: { challengeId: 'c-1' } });
    expect(await c.listBlobs('a-1')).toEqual([blob]);
    expect(await c.blobInfo('a-1', blob.blobId)).toEqual(blob);
    await c.deleteBlob('a-1', blob.blobId);
    expect(sent()).toEqual([
      ['POST', '/apps/a-1/metadata'],
      ['GET', '/apps/a-1/storage'],
      ['GET', '/apps/a-1/abi'],
      ['POST', '/apps/a-1/transfer'],
      ['POST', '/apps/a-1/transfer'],
      ['GET', '/apps/a-1/blobs'],
      ['GET', '/apps/a-1/blobs/3yZe7d/info'],
      ['DELETE', '/apps/a-1/blobs/3yZe7d'],
    ]);
  });

  it("sets an org's and a member's metadata", async () => {
    const c = client();
    await c.setOrgMetadata('org-1', { logo: 'x' });
    await c.setMemberMetadata('org-1', 'acc-2', null);
    expect(sent()).toEqual([
      ['POST', '/orgs/org-1/metadata'],
      ['POST', '/orgs/org-1/members/acc-2/metadata'],
    ]);
    expect(last().body).toEqual({ metadata: null });
  });

  it('publishes presence as hex, reads it, and streams it', async () => {
    const c = client();
    const entry = { account: 'acc-1', device: 'd-1', state: '0102' };
    node.answer = (head) => {
      if (head.path.endsWith('/presence/stream')) {
        return { status: 200, events: [`event: snapshot\ndata: ${JSON.stringify([entry])}\n\n`] };
      }
      return { status: 200, json: { present: [entry] } };
    };
    await c.publishPresence('a-1', 3, new Uint8Array([1, 2]));
    expect(last().body).toEqual({ seq: 3, state: '0102' });
    await c.publishPresence('a-1', 4, null);
    expect(last().body).toEqual({ seq: 4, state: null });
    expect(await c.presence('a-1')).toEqual([entry]);
    const ac = new AbortController();
    const first = await c.presenceStream('a-1', ac.signal).next();
    ac.abort();
    expect(first.value).toEqual({ id: '', kind: 'snapshot', data: [entry] });
    expect(sent().map(([, path]) => path)).toEqual([
      '/apps/a-1/presence',
      '/apps/a-1/presence',
      '/apps/a-1/presence',
      '/apps/a-1/presence/stream',
    ]);
  });

  it("reads the node's attestation unverified, for display", async () => {
    const doc = await client().attestation();
    expect(doc).toMatchObject({ mock: true, transportKey: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });
});

describe('core 1.0.0-rc.7+ routes', () => {
  const header = (i: number, name: string) =>
    node.requests[i].head.headers.find(([k]) => k.toLowerCase() === name)?.[1];

  it('uploads a blob with its content type, octet-stream by default', async () => {
    const c = client();
    node.answer = () => ({ status: 200, json: { blobId: 'b', id: 'ab', size: 3 } });
    await c.uploadBlob('a-1', new TextEncoder().encode('abc'), 'image/png');
    await c.uploadBlob('a-1', new TextEncoder().encode('abc'), { contentType: 'text/plain; charset=utf-8' });
    await c.uploadBlob('a-1', new TextEncoder().encode('abc'));
    expect(sent()).toEqual([
      ['POST', '/apps/a-1/blobs'],
      ['POST', '/apps/a-1/blobs'],
      ['POST', '/apps/a-1/blobs'],
    ]);
    expect([0, 1, 2].map((i) => header(i, 'content-type'))).toEqual([
      'image/png',
      'text/plain; charset=utf-8',
      'application/octet-stream',
    ]);
    expect(node.requests[0].body).toEqual({ raw: 'abc' });
  });

  it('downloads with the served content type, and with a grant and no session', async () => {
    const c = client();
    node.answer = () => ({ status: 200, bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' });
    expect(await c.blobContent('a-1', '3yZe7d')).toEqual({ data: new Uint8Array([1, 2, 3]), contentType: 'image/png' });
    expect(await c.downloadBlob('a-1', '3yZe7d')).toEqual(new Uint8Array([1, 2, 3]));
    expect(await c.downloadBlobGranted('a-1', '3yZe7d', 'g+1/x')).toEqual(new Uint8Array([1, 2, 3]));
    expect(sent()).toEqual([
      ['GET', '/apps/a-1/blobs/3yZe7d'],
      ['GET', '/apps/a-1/blobs/3yZe7d'],
      ['GET', '/apps/a-1/blobs/3yZe7d?grant=g%2B1%2Fx'],
    ]);
    expect(header(2, 'authorization')).toBeUndefined();
    node.answer = () => ({ status: 404, json: { error: 'NOT_FOUND', message: 'no such blob in this app' } });
    await expect(c.downloadBlobGranted('a-1', '3yZe7d', 'expired')).rejects.toBeInstanceOf(NotFound);
  });

  it("reads a component app's xcalls", async () => {
    const xcalls = { pending: 2, deadLetters: [{ seq: 7, app: 'a-2', method: 'ping', reason: 'no such app', atMs: 1 }] };
    node.answer = () => ({ status: 200, json: xcalls });
    expect(await client().appXcalls('a-1')).toEqual(xcalls);
    expect(sent()).toEqual([['GET', '/apps/a-1/xcalls']]);
  });

  it('grants, lists and revokes deployers, each change approved with the passkey', async () => {
    const c = client();
    confirming({ key: 'org:org-1', deployer: { org: 'org-1' }, grant: {} });
    await c.grantDeployer({ org: 'org-1' }, passkey, { until: new Date('2027-01-01T00:00:00Z') });
    expect(node.requests[0].body).toEqual({ deployer: { org: 'org-1' }, until: '2027-01-01T00:00:00.000Z' });
    expect(last().body).toMatchObject({ deployer: { org: 'org-1' }, confirm: { challengeId: 'c-1' } });
    await c.grantDeployer({ account: 'acc-2' }, passkey);
    expect(last().body).not.toHaveProperty('until');
    await c.revokeDeployer({ account: 'acc-2' }, passkey);
    expect(last().body).toMatchObject({ confirm: { challengeId: 'c-1' } });
    await c.revokeDeployer('org:org-1', passkey);
    node.answer = () => ({ status: 200, json: { deployments: 'granted', deployers: 'owner', owner: { org: 'org-1' }, grants: [] } });
    expect((await c.deployers()).deployers).toBe('owner');
    expect(sent()).toEqual([
      ['POST', '/deployers'],
      ['POST', '/deployers'],
      ['POST', '/deployers'],
      ['POST', '/deployers'],
      ['DELETE', '/deployers/account%3Aacc-2'],
      ['DELETE', '/deployers/account%3Aacc-2'],
      ['DELETE', '/deployers/org%3Aorg-1'],
      ['DELETE', '/deployers/org%3Aorg-1'],
      ['GET', '/deployers'],
    ]);
    expect(deployerKey({ org: 'o' })).toBe('org:o');
  });

  it('creates a deployment, offers and withdraws an app, lists and deletes it', async () => {
    const c = client();
    confirming({ id: 'd-1', deployment: {} });
    expect(await c.createDeployment('Acme Labs', { org: 'org-1' }, passkey)).toBe('d-1');
    expect(last().body).toMatchObject({ name: 'Acme Labs', owner: { org: 'org-1' }, confirm: { challengeId: 'c-1' } });
    confirming({ deployment: 'd-1', app: 'notes', offer: {} });
    await c.offerApp('d-1', { app: 'notes', package: 'com.example.notes', version: '1.0.0' }, passkey);
    expect(last().body).toMatchObject({ app: 'notes', package: 'com.example.notes', version: '1.0.0', confirm: {} });
    confirming({});
    await c.withdrawApp('d-1', 'notes', passkey);
    await c.deleteDeployment('d-1', passkey);
    node.answer = (head) => {
      if (head.path === '/deployments') return { status: 200, json: { deployments: [{ id: 'd-1' }] } };
      if (head.path.endsWith('/orgs')) return { status: 200, json: { deployment: 'd-1', orgs: [], outsideOrgs: 1 } };
      return { status: 200, json: { id: 'd-1', name: 'Acme Labs', owner: { kind: 'org', name: 'Acme' }, apps: [] } };
    };
    expect(await c.deployments()).toEqual([{ id: 'd-1' }]);
    expect((await c.deployment('d-1')).owner).toEqual({ kind: 'org', name: 'Acme' });
    expect((await c.deploymentOrgs('d-1')).outsideOrgs).toBe(1);
    expect(sent()).toEqual([
      ['POST', '/deployments'],
      ['POST', '/deployments'],
      ['POST', '/deployments/d-1/apps'],
      ['POST', '/deployments/d-1/apps'],
      ['DELETE', '/deployments/d-1/apps/notes'],
      ['DELETE', '/deployments/d-1/apps/notes'],
      ['DELETE', '/deployments/d-1'],
      ['DELETE', '/deployments/d-1'],
      ['GET', '/deployments'],
      ['GET', '/deployments/d-1'],
      ['GET', '/deployments/d-1/orgs'],
    ]);
  });

  it("creates an instance from the deployment a frontend page was opened for", async () => {
    const c = client();
    node.answer = () => ({ status: 200, json: { appId: 'a-9' } });
    const deployment = pageDeployment('https://notes.example/1.0.0/?deployment=d-1');
    expect(deployment).toBe('d-1');
    expect(pageDeployment('https://notes.example/1.0.0/')).toBeNull();
    expect(await c.createApp('mine', { package: 'com.example.notes', deployment: deployment! }, { org: 'org-2' })).toBe('a-9');
    expect(last().body).toEqual({ name: 'mine', package: 'com.example.notes', deployment: 'd-1', org: 'org-2' });
  });

  it("reads a frontend's /.well-known/calimero.json", async () => {
    const urls: string[] = [];
    const fetcher = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ package: 'p', versions: ['1.0.0'], api: ['https://api.example'] }));
    }) as unknown as typeof fetch;
    const manifest = await frontendManifest('https://notes.example', fetcher);
    expect(urls).toEqual(['https://notes.example/.well-known/calimero.json']);
    expect(manifest.deployments).toEqual([]);
  });
});

describe('ORG_CAPABILITIES', () => {
  it("has core's bit values", () => {
    expect(ORG_CAPABILITIES).toEqual({
      CREATE_APP: 1,
      INVITE_MEMBERS: 2,
      JOIN_OPEN_TEAMS: 4,
      MANAGE_MEMBERS: 8,
      MANAGE_APPLICATION: 16,
      CREATE_TEAM: 32,
      DELETE_TEAM: 64,
      MANAGE_VISIBILITY: 128,
      MANAGE_METADATA: 256,
      APPROVE_RELEASES: 1024,
    });
    expect(orgCapabilities('CREATE_APP', 'MANAGE_APPLICATION')).toBe(17);
  });
});
