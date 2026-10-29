/**
 * The in-app approvals: what `pendingApprovals` reads from the node and makes
 * of it, and the passkey-confirmed requests `approveRelease`,
 * `withdrawRelease` and `upgradeApp` send, through the real sealed channel to
 * a stand-in node. Synthetic data only; the provisional field names are those
 * core's read endpoints are expected to use.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { StandInCloudNode } from '../../tests/cloud-v2/stand-in-node.js';
import { CalimeroClient, CalimeroError, pendingApprovalsFrom, releaseNotesUrl, verifyReleaseUrl } from './index.js';
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
let prompts = 0;
const passkey: PasskeyProvider = {
  create: async () => ({ attestationObject: 'ao', clientDataJson: 'cd' }),
  get: async () => {
    prompts += 1;
    return { credentialId: 'cred', authenticatorData: 'ad', clientDataJson: 'cd', signature: 'sig' };
  },
};
const CHALLENGE = { challengeId: 'c-1', challenge: 'AAEC', rpId: 'localhost' };
const CONFIRM = { challengeId: 'c-1', assertion: expect.objectContaining({ signature: 'sig' }) };

const APPS = [
  { appId: 'a-1', name: 'notes', owner: 'acc-1', org: null, bundle: 'h1', package: 'com.example.kv', version: '1.0.0' },
  // Up to date.
  { appId: 'a-2', name: 'todo', owner: 'acc-1', org: null, bundle: 'h2', package: 'com.example.todo', version: '2.0.0' },
  // An organization's app and someone else's: approved elsewhere, never listed.
  { appId: 'a-3', name: 'team', owner: 'acc-1', org: 'org-1', bundle: 'h3', package: 'com.example.kv', version: '1.0.0' },
  { appId: 'a-4', name: 'shared', owner: 'acc-2', org: null, bundle: 'h4', package: 'com.example.kv', version: '1.0.0' },
];

describe('pendingApprovalsFrom', () => {
  it('lists releases the cluster runs that the account has not approved, and newer app versions', () => {
    const me = {
      accountId: 'acc-1',
      approvedReleases: ['2.3.109'],
      nodeReleases: [
        { version: '2.3.109', nodes: 2 },
        { version: '2.3.120', nodes: 1 },
      ],
      governance: { releases: 'owner', appUpgrades: 'owner', outbound: 'owner' },
    };
    const pending = pendingApprovalsFrom(me, APPS, { 'com.example.kv': ['1.0.0', '1.1.0', '1.0.1'], 'com.example.todo': ['2.0.0'] });
    expect(pending.approvedReleases).toEqual(['2.3.109']);
    expect(pending.releases).toEqual([
      {
        version: '2.3.120',
        nodes: 1,
        managedBy: 'owner',
        actionable: true,
        releaseNotesUrl: 'https://github.com/calimero-network/mero-tee/releases/tag/mero-tee-v2.3.120',
        verifyUrl: 'https://mero-tee.vercel.app/mero-tee?release_tag=mero-tee-v2.3.120',
      },
    ]);
    expect(pending.upgrades).toEqual([
      {
        appId: 'a-1',
        name: 'notes',
        package: 'com.example.kv',
        from: '1.0.0',
        to: '1.1.0',
        available: ['1.1.0', '1.0.1'],
        managedBy: 'owner',
        actionable: true,
      },
    ]);
    expect(pending.actionable).toBe(true);
  });

  it('reports what the operator holds as operator-managed, with nothing to act on', () => {
    const me = {
      accountId: 'acc-1',
      approvedReleases: ['2.3.109'],
      unapprovedReleases: ['mero-tee-v2.3.120'],
      governance: { releases: 'operator', appUpgrades: 'operator', outbound: 'owner' },
    };
    const apps = [{ ...APPS[0], availableVersions: ['1.0.0', '1.2.0'] }];
    const pending = pendingApprovalsFrom(me, apps);
    expect(pending.governance).toEqual({ releases: 'operator', appUpgrades: 'operator', outbound: 'owner' });
    expect(pending.releases).toMatchObject([{ version: '2.3.120', managedBy: 'operator', actionable: false }]);
    expect(pending.upgrades).toMatchObject([{ appId: 'a-1', to: '1.2.0', managedBy: 'operator', actionable: false }]);
    expect(pending.actionable).toBe(false);
  });

  it("reads today's /auth/me (no cluster releases, no governance) as nothing pending", () => {
    const pending = pendingApprovalsFrom({ accountId: 'acc-1', approvedReleases: ['2.3.109'] }, APPS);
    expect(pending).toEqual({
      accountId: 'acc-1',
      approvedReleases: ['2.3.109'],
      releases: [],
      upgrades: [],
      governance: null,
      actionable: false,
    });
  });

  it('builds the release notes and verifier links', () => {
    expect(releaseNotesUrl('2.3.120')).toBe('https://github.com/calimero-network/mero-tee/releases/tag/mero-tee-v2.3.120');
    expect(verifyReleaseUrl('2.3.120')).toBe('https://mero-tee.vercel.app/mero-tee?release_tag=mero-tee-v2.3.120');
  });
});

describe('the in-app approvals over the sealed channel', () => {
  it('pendingApprovals reads /auth/me, /apps and the packages it has to look up', async () => {
    node.answer = (head) => {
      if (head.path === '/auth/me') {
        return { status: 200, json: { accountId: 'acc-1', approvedReleases: ['2.3.109'], nodeReleases: { '2.3.120': 1 } } };
      }
      if (head.path === '/apps') return { status: 200, json: { apps: APPS } };
      if (head.path === '/packages/com.example.kv') {
        return { status: 200, json: { package: 'com.example.kv', latest: '1.1.0', versions: [{ version: '1.0.0' }, { version: '1.1.0' }] } };
      }
      return { status: 404, json: { error: 'NOT_FOUND', message: 'no such package' } };
    };
    const pending = await client().pendingApprovals();
    expect(sent().slice(0, 2).sort()).toEqual([
      ['GET', '/apps'],
      ['GET', '/auth/me'],
    ]);
    expect(sent().slice(2).sort()).toEqual([
      ['GET', '/packages/com.example.kv'],
      ['GET', '/packages/com.example.todo'],
    ]);
    expect(pending.releases.map((r) => r.version)).toEqual(['2.3.120']);
    expect(pending.upgrades).toMatchObject([{ appId: 'a-1', from: '1.0.0', to: '1.1.0' }]);
  });

  it('approveRelease(version, passkey) approves for the account with its passkey', async () => {
    node.answer = (_, body) =>
      body.confirm ? { status: 200, json: {} } : { status: 412, json: { error: 'CONFIRM_REQUIRED', message: 'approve', details: CHALLENGE } };
    await client().approveRelease('2.3.120', passkey);
    expect(sent()).toEqual([
      ['POST', '/auth/releases'],
      ['POST', '/auth/releases'],
    ]);
    expect(node.requests[0].body).toEqual({ version: '2.3.120', approved: true });
    expect(last().body).toEqual({ version: '2.3.120', approved: true, confirm: CONFIRM });
  });

  it('withdrawRelease checks it is not the last one, then withdraws with the passkey', async () => {
    node.answer = (head, body) => {
      if (head.path === '/auth/me') return { status: 200, json: { accountId: 'acc-1', approvedReleases: ['2.3.109', '2.3.120'] } };
      return body.confirm
        ? { status: 200, json: {} }
        : { status: 412, json: { error: 'CONFIRM_REQUIRED', message: 'approve', details: CHALLENGE } };
    };
    await client().withdrawRelease('2.3.109', passkey);
    expect(sent()).toEqual([
      ['GET', '/auth/me'],
      ['POST', '/auth/releases'],
      ['POST', '/auth/releases'],
    ]);
    expect(last().body).toEqual({ version: '2.3.109', approved: false, confirm: CONFIRM });
  });

  it('withdrawRelease refuses the last approved release before any prompt', async () => {
    node.answer = () => ({ status: 200, json: { accountId: 'acc-1', approvedReleases: ['2.3.109'] } });
    const before = prompts;
    const refused = await client().withdrawRelease('2.3.109', passkey).catch((e) => e);
    expect(refused).toBeInstanceOf(CalimeroError);
    expect(refused).toMatchObject({ status: 409, code: 'LAST_APPROVED_RELEASE' });
    expect(sent()).toEqual([['GET', '/auth/me']]);
    expect(prompts).toBe(before);
  });

  it('upgradeApp(app, version, passkey) upgrades to that release with the passkey', async () => {
    node.answer = (_, body) =>
      body.confirm
        ? { status: 200, json: { index: 7, status: 'upgraded', error: null } }
        : { status: 412, json: { error: 'CONFIRM_REQUIRED', message: 'approve', details: CHALLENGE } };
    expect(await client().upgradeApp('a-1', '1.1.0', passkey)).toEqual({ index: 7, status: 'upgraded', error: null });
    expect(sent()).toEqual([
      ['POST', '/apps/a-1/upgrade'],
      ['POST', '/apps/a-1/upgrade'],
    ]);
    expect(node.requests[0].body).toEqual({ version: '1.1.0' });
    expect(last().body).toEqual({ version: '1.1.0', confirm: CONFIRM });
  });
});
