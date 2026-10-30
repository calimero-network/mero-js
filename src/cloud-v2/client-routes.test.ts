/**
 * Each CalimeroClient method sends the route and body core 1.0's node API
 * (`crates/node/src/api.rs`) takes, through the real sealed channel to a
 * stand-in node. The passkey flows mdma's console runs in the browser come
 * first. Synthetic data only.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { StandInCloudNode } from '../../tests/cloud-v2/stand-in-node.js';
import { CalimeroClient, ORG_CAPABILITIES, orgCapabilities, type UpgradeRun } from './index.js';
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

  it('creates and revokes an API key and mints an invite', async () => {
    const c = client();
    node.answer = (head) =>
      head.path === '/auth/apikeys'
        ? { status: 200, json: { keyId: 'k-1', key: 'cal_secret' } }
        : { status: 200, json: { token: 'inv-1' } };
    expect(await c.createApiKey({ label: 'ci', apps: ['a-1'], readOnly: true })).toEqual({ keyId: 'k-1', key: 'cal_secret' });
    expect(node.requests[0].body).toEqual({ label: 'ci', apps: ['a-1'], readOnly: true });
    await c.revokeApiKey('k-1');
    expect(await c.invite('org-1', 'member', ['t-1'], { ttlSecs: 60, uses: 2 })).toBe('inv-1');
    expect(sent()).toEqual([
      ['POST', '/auth/apikeys'],
      ['DELETE', '/auth/apikeys/k-1'],
      ['POST', '/orgs/org-1/invites'],
    ]);
    expect(last().body).toEqual({ role: 'member', teams: ['t-1'], ttlSecs: 60, uses: 2 });
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
