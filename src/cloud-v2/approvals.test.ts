/**
 * Approvals as core's node reports them (`GET /auth/apps`, `/orgs/{org}/apps`,
 * `/releases`), the consent page an app sends its user to, publisher binding
 * and the operator's report and deadline routes, through the real sealed
 * channel to a stand-in node. Synthetic data only.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { StandInCloudNode } from '../../tests/cloud-v2/stand-in-node.js';
import {
  CalimeroClient,
  ConsentStale,
  ORG_CAPABILITIES,
  ReleaseDeadlineError,
  consentReturn,
  pageQuery,
  pendingApprovalsFrom,
  publisherBindingBytes,
  publisherBindingMessage,
  releaseConsent,
  stalledBy,
  upgradeConsent,
  type AppsReport,
  type ReleaseRules,
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
const CONFIRM = { challengeId: 'c-1', assertion: expect.objectContaining({ signature: 'sig' }) };
const OWNERS = { releases: 'owner', appUpgrades: 'owner', outbound: 'owner' } as const;

const app = (id: string, version: string, availableVersions: string[]) => ({
  app: id,
  group: 2,
  scope: { kind: 'account' as const },
  bundle: `h-${id}`,
  package: { package: 'com.example.kv', version, service: null },
  publisher: { signer: 'did:key:z6Mk' },
  upgradesHeldBy: 'owner' as const,
  lastUpgrade: null,
  approvedReleases: ['2.3.109'],
  replicas: [{ node: 1, release: '2.3.109', approved: true }],
  name: `app ${id}`,
  availableVersions,
});

const REPORT: AppsReport = {
  scope: { kind: 'account' },
  governance: OWNERS,
  approvedReleases: ['2.3.109'],
  clusterReleases: [
    { release: '2.3.109', nodes: 2, approved: true },
    { release: '2.3.120', nodes: 1, approved: false },
    { release: '2.3.130', nodes: 1, approved: false },
  ],
  apps: [app('a-1', '1.0.0', ['1.0.1', '1.1.0']), app('a-2', '2.0.0', [])],
  next: null,
};
const at = (iso: string) => Date.parse(iso) / 1000;
const RULES: ReleaseRules = {
  governance: OWNERS,
  deadlines: [{ version: '2.3.120', after: '2027-03-12T00:00:00Z', afterSecs: at('2027-03-12T00:00:00Z') }],
};

describe('pendingApprovalsFrom', () => {
  it('lists unapproved cluster releases, newest first, and apps with newer releases', () => {
    const pending = pendingApprovalsFrom(REPORT, RULES, at('2027-01-01T00:00:00Z'));
    expect(pending.releases).toEqual([
      {
        version: '2.3.130',
        nodes: 1,
        actionable: true,
        releaseNotesUrl: 'https://github.com/calimero-network/mero-tee/releases/tag/mero-tee-v2.3.130',
        verifyUrl: 'https://mero-tee.vercel.app/mero-tee?release_tag=mero-tee-v2.3.130',
        deadline: null,
      },
      expect.objectContaining({ version: '2.3.120', deadline: RULES.deadlines[0] }),
    ]);
    expect(pending.upgrades).toEqual([
      { app: 'a-1', name: 'app a-1', package: 'com.example.kv', from: '1.0.0', to: '1.1.0', available: ['1.0.1', '1.1.0'], actionable: true },
    ]);
    expect(pending.stalledBy).toBeNull();
    expect(pending.actionable).toBe(true);
  });

  it('names the release a passed deadline stops new work on, until it is approved', () => {
    const after = at('2027-04-01T00:00:00Z');
    expect(pendingApprovalsFrom(REPORT, RULES, after).stalledBy).toEqual(RULES.deadlines[0]);
    expect(stalledBy(['2.3.109', '2.3.120'], RULES.deadlines, after)).toBeNull();
    expect(stalledBy(['2.3.130'], RULES.deadlines, after)).toBeNull();
    // Unrestricted (no approvals ever recorded) is never stopped.
    expect(stalledBy(null, RULES.deadlines, after)).toBeNull();
  });

  it('marks nothing actionable where the operator holds the decisions', () => {
    const operator = { releases: 'operator', appUpgrades: 'operator', outbound: 'owner' } as const;
    const pending = pendingApprovalsFrom({ ...REPORT, governance: operator }, RULES);
    expect(pending.releases.every((r) => !r.actionable)).toBe(true);
    expect(pending.upgrades.every((u) => !u.actionable)).toBe(true);
    expect(pending.actionable).toBe(false);
  });
});

describe('helpers', () => {
  it('builds the publisher binding message core verifies', () => {
    const msg = publisherBindingMessage('prod-eu', 'org-1', 'did:key:z6Mk', 0);
    expect(msg).toBe('calimero-publisher-binding/v1\nprod-eu\norg-1\ndid:key:z6Mk\n0');
    expect(new TextDecoder().decode(publisherBindingBytes('prod-eu', 'org-1', 'did:key:z6Mk', 0))).toBe(msg);
  });

  it('reads the consent page redirect, and nothing else', () => {
    expect(consentReturn('https://kv.apps.example/settings?request_id=3.abc&result=approved')).toEqual({
      requestId: '3.abc',
      result: 'approved',
    });
    expect(consentReturn('https://kv.apps.example/settings?request_id=3.abc&result=maybe')).toBeNull();
    expect(consentReturn('https://kv.apps.example/settings')).toBeNull();
  });

  it('pages reports and refuses a limit core would', () => {
    expect(pageQuery()).toBe('');
    expect(pageQuery({ after: 'a-1', limit: 50 })).toBe('?after=a-1&limit=50');
    expect(() => pageQuery({ limit: 101 })).toThrow(RangeError);
    expect(() => pageQuery({ limit: 0 })).toThrow(RangeError);
  });

  it('has the APPROVE_RELEASES capability on bit 10', () => {
    expect(ORG_CAPABILITIES.APPROVE_RELEASES).toBe(1 << 10);
  });
});

describe('over the sealed channel', () => {
  it('pendingApprovals reads every page of the report and the release rules', async () => {
    node.answer = (head) => {
      if (head.path === '/auth/apps') return { status: 200, json: { ...REPORT, apps: [REPORT.apps[0]], next: 'a-1' } };
      if (head.path === '/auth/apps?after=a-1') return { status: 200, json: { ...REPORT, apps: [REPORT.apps[1]], next: null } };
      if (head.path === '/releases') return { status: 200, json: RULES };
      return { status: 404, json: { error: 'NOT_FOUND', message: head.path } };
    };
    const pending = await client().pendingApprovals();
    expect(sent()).toEqual(
      expect.arrayContaining([
        ['GET', '/auth/apps'],
        ['GET', '/auth/apps?after=a-1'],
        ['GET', '/releases'],
      ]),
    );
    expect(pending.upgrades.map((u) => u.app)).toEqual(['a-1']);
    expect(pending.releases.map((r) => r.version)).toEqual(['2.3.130', '2.3.120']);
  });

  it("reads an organization's report and an organization's release fields", async () => {
    const c = client();
    node.answer = () => ({ status: 200, json: { ...REPORT, scope: { kind: 'org', org: 'org-1' } } });
    await c.appsReport('org-1', { limit: 10 });
    expect(last().head.path).toBe('/orgs/org-1/apps?limit=10');
    node.answer = () => ({
      status: 200,
      json: { orgId: 'org-1', releaseApprovers: ['acc-1'], publishes: ['did:key:z6Mk'], newWorkStopped: null },
    });
    const org = await c.getOrg('org-1');
    expect(org.releaseApprovers).toEqual(['acc-1']);
    expect(org.publishes).toEqual(['did:key:z6Mk']);
    expect(org.newWorkStopped).toBeNull();
  });

  it('asks the node for a consent page and reads the decision', async () => {
    const c = client();
    const started = { requestId: '1.xyz', url: 'https://node-1.example/consent/1.xyz', expiresAt: 9e9 };
    node.answer = () => ({ status: 200, json: started });
    const opened: string[] = [];
    const request = upgradeConsent('a-1', '1.1.0', 'https://kv.apps.example/settings');
    expect(await c.openConsentPage(request, (url) => opened.push(url))).toEqual(started);
    expect(opened).toEqual([started.url]);
    expect(last().head.path).toBe('/consent/requests');
    expect(last().body).toEqual({ kind: 'upgrade', subject: { app: 'a-1', toVersion: '1.1.0' }, returnTo: 'https://kv.apps.example/settings' });

    await c.requestConsent(releaseConsent({ kind: 'org', org: 'org-1' }, '2.3.130', 'https://kv.apps.example/'));
    expect(last().body).toEqual({
      kind: 'release',
      scope: { org: 'org-1' },
      subject: { version: '2.3.130' },
      returnTo: 'https://kv.apps.example/',
    });
    await c.requestConsent(releaseConsent({ kind: 'account' }, '2.3.130', 'https://kv.apps.example/'));
    expect(last().body).toMatchObject({ scope: 'account' });

    let polls = 0;
    node.answer = () => {
      polls += 1;
      return {
        status: 200,
        json: { requestId: '1.xyz', kind: 'upgrade', status: polls < 2 ? 'pending' : 'approved', decidedAt: polls < 2 ? null : 5 },
      };
    };
    const result = await c.waitForConsent('1.xyz', { intervalMs: 1 });
    expect(result).toEqual({ requestId: '1.xyz', kind: 'upgrade', status: 'approved', decidedAt: 5 });
    expect(last().head.path).toBe('/consent/1.xyz/result');
  });

  it('types the deadline and stale-consent refusals', async () => {
    const c = client();
    node.answer = () => ({
      status: 409,
      json: {
        error: 'RELEASE_DEADLINE',
        message: 'release deadline: approve mero-tee release 2.3.120',
        details: { release: '2.3.120', after: '2027-03-12T00:00:00Z', afterSecs: 1804809600 },
      },
    });
    const refused = await c.upgradeApp('a-1', { version: '1.1.0' }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ReleaseDeadlineError);
    expect(refused).toMatchObject({ status: 409, release: '2.3.120', after: '2027-03-12T00:00:00Z' });

    node.answer = () => ({ status: 409, json: { error: 'CONSENT_STALE', message: 'the target changed' } });
    expect(await c.requestConsent(upgradeConsent('a-1', '1.1.0', 'https://kv.apps.example/')).catch((e: unknown) => e)).toBeInstanceOf(
      ConsentStale,
    );
  });

  it('binds a publisher key and upgrades its published instances with a passkey', async () => {
    const c = client();
    node.answer = () => ({ status: 200, json: { signerId: 'did:key:z6Mk', cluster: 'prod-eu', generation: 2, bound: false } });
    const info = await c.publisherBinding('did:key:z6Mk');
    expect(last().head.path).toBe('/publishers/did%3Akey%3Az6Mk');
    expect(info.generation).toBe(2);

    const confirming = (json: unknown) => {
      node.answer = (_, body) =>
        body.confirm
          ? { status: 200, json }
          : { status: 412, json: { error: 'CONFIRM_REQUIRED', message: 'approve', details: CHALLENGE } };
    };
    confirming({});
    await c.bindPublisher('org-1', { signerId: 'did:key:z6Mk', publicKey: 'pk', signature: 'sig' }, passkey);
    expect(last().head.path).toBe('/orgs/org-1/publishers');
    expect(last().body).toEqual({ signerId: 'did:key:z6Mk', publicKey: 'pk', signature: 'sig', confirm: CONFIRM });

    confirming({ runId: 'r-1' });
    await c.upgradePublished('org-1', 'com.example.kv', { version: '1.1.0' }, passkey);
    expect(last().head.path).toBe('/orgs/org-1/packages/com.example.kv/upgrade');
    expect(last().body).toEqual({ version: '1.1.0', confirm: CONFIRM });
  });

  it("calls the operator's reports and deadline routes", async () => {
    const c = client();
    c.useApiKey('ops-token');
    node.answer = () => ({ status: 200, json: { fresh: true, governance: OWNERS, apps: [], orgs: [], next: null } });
    await c.opsApps({ limit: 100 });
    await c.opsOrgs({ after: 'org-1' });
    await c.setReleaseDeadline('2.3.120', new Date('2027-03-12T00:00:00Z'));
    expect(last().body).toEqual({ after: '2027-03-12T00:00:00.000Z' });
    await c.liftReleaseDeadline('2.3.120');
    expect(sent()).toEqual([
      ['GET', '/ops/apps?limit=100'],
      ['GET', '/ops/orgs?after=org-1'],
      ['POST', '/ops/releases/2.3.120/deadline'],
      ['DELETE', '/ops/releases/2.3.120/deadline'],
    ]);
    expect(last().head.headers).toContainEqual(['authorization', 'Bearer ops-token']);
  });
});
