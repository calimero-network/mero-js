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
  LoginRequired,
  NotFound,
  ORG_CAPABILITIES,
  PasskeyUnknownHere,
  SignUpRefused,
  deployerKey,
  frontendManifest,
  orgCapabilities,
  pageDeployment,
  recoveryPublicKey,
  recoverySeedText,
  signRecovery,
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
  it("threads a sign-in's and a sign-up's signal to every passkey prompt, and its abort is a cancel", async () => {
    const signals: Array<[string, AbortSignal | undefined]> = [];
    const pk: PasskeyProvider = {
      create: async (_o, o) => {
        signals.push(['create', o?.signal]);
        return { attestationObject: 'ao', clientDataJson: 'cd' };
      },
      get: async (_c, _r, _a, o) => {
        signals.push(['get', o?.signal]);
        if (o?.signal?.aborted) throw Object.assign(new Error('cancelled'), { name: 'NotAllowedError' });
        return { credentialId: 'cred', authenticatorData: 'ad', clientDataJson: 'cd', signature: 'sig' };
      },
    };
    const session = { accountId: 'acc-1', sessionToken: 'tok', expiresAt: 9e9, refreshToken: 'r' };
    node.answer = (head, body) => {
      if (head.path === '/auth/passkey/login/begin') return { status: 200, json: { challengeId: 'l-1', options: CHALLENGE } };
      if (head.path === '/auth/passkey/register/begin') return { status: 200, json: { challengeId: 'r-1', options: { challenge: 'AAEC' } } };
      if (head.path === '/auth/passkey/register/finish' && !body.confirm) {
        return { status: 412, json: { error: 'CONFIRM_REQUIRED', message: 'sign', details: CHALLENGE } };
      }
      return { status: 200, json: session };
    };
    const controller = new AbortController();
    await client().signIn(pk, { signal: controller.signal });
    await client().signUp(pk, 'alice', { signal: controller.signal });
    expect(signals).toEqual([
      ['get', controller.signal],
      ['create', controller.signal],
      ['get', controller.signal],
    ]);
    // Aborted at the sign-up's confirmation: the prompt's cancel is ConfirmCancelled.
    controller.abort();
    const error = await client()
      .signUp({ ...pk, create: async () => ({ attestationObject: 'ao', clientDataJson: 'cd' }) }, 'alice', { signal: controller.signal })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfirmCancelled);
  });

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

  it("signs up: the confirmation asks the passkey for user verification 'preferred', as the node checks it", async () => {
    // core verifies the sign-up confirmation with `require_uv: false` (it made
    // the passkey with `preferred`); `required` would leave a security key
    // without a PIN with a passkey and no account. A value the node names wins.
    const asked: unknown[] = [];
    const pk: PasskeyProvider = {
      create: async () => ({ attestationObject: 'ao', clientDataJson: 'cd' }),
      get: async (_c, _r, _a, options) => {
        asked.push(options?.userVerification);
        return { credentialId: 'cred', authenticatorData: 'ad', clientDataJson: 'cd', signature: 'sig' };
      },
    };
    let named: Record<string, unknown> = {};
    node.answer = (head, body) => {
      if (head.path === '/auth/passkey/register/begin') return { status: 200, json: { challengeId: 'r-1', options: { challenge: 'AAEC' } } };
      if (!body.confirm) return { status: 412, json: { error: 'CONFIRM_REQUIRED', message: 'sign', details: { ...CHALLENGE, ...named } } };
      return { status: 200, json: { accountId: 'acc-1', sessionToken: 'tok', expiresAt: 9e9, refreshToken: 'r' } };
    };
    await client().signUp(pk, 'alice');
    named = { userVerification: 'required' };
    await client().signUp(pk, 'alice');
    expect(asked).toEqual(['preferred', 'required']);
  });

  it('signs up with an invite: the token goes on begin, finish and the confirmed retry', async () => {
    const c = client();
    node.answer = (head, body) => {
      if (head.path === '/auth/passkey/register/begin') return { status: 200, json: { challengeId: 'r-1', options: { challenge: 'AAEC' } } };
      if (!body.confirm) return { status: 412, json: { error: 'CONFIRM_REQUIRED', message: 'sign', details: CHALLENGE } };
      return { status: 200, json: { accountId: 'acc-2', sessionToken: 'tok', expiresAt: 9e9, refreshToken: 'r' } };
    };
    await c.signUp(passkey, 'bob', { invite: 'inv_x', origin: null });
    expect(node.requests.map((r) => r.body)).toEqual([
      { name: 'bob', invite: 'inv_x' },
      { challengeId: 'r-1', registration: expect.anything(), invite: 'inv_x' },
      { challengeId: 'r-1', registration: expect.anything(), invite: 'inv_x', confirm: expect.anything() },
    ]);
  });

  it('reads the sign-up policy, and a refused sign-up says why before any passkey prompt', async () => {
    const c = client();
    const policy = { policy: 'invite', orgInvites: true, signUpInvites: true, inviteRequired: true };
    node.answer = () => ({ status: 200, json: policy });
    expect(await c.signUpPolicy()).toEqual(policy);
    expect(sent()).toEqual([['GET', '/sign-up']]);
    const refusals: Array<[string, string]> = [
      ['sign-up refused: this cluster takes new accounts by invite only', 'invite-only'],
      ['sign-up refused: this cluster takes only accounts its operator or owner pre-authorized with a sign-up invite', 'closed'],
      ['sign-up refused: unknown invite', 'unknown-invite'],
      ['sign-up refused: the invite has expired', 'expired-invite'],
      ["sign-up refused: the invite's organization is gone", 'org-gone'],
    ];
    for (const [message, reason] of refusals) {
      node.answer = () => ({ status: 403, json: { error: 'SIGN_UP_REFUSED', message } });
      let prompted = false;
      const pk = { ...passkey, create: async () => ((prompted = true), passkey.create({})) };
      const error = await c.signUp(pk, 'bob', { invite: 'inv_x' }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SignUpRefused);
      expect((error as SignUpRefused).reason).toBe(reason);
      expect(prompted).toBe(false);
    }
  });

  it('a passkey from another cluster is refused as such, and not refreshed for', async () => {
    const c = client();
    const message =
      'this passkey belongs to another Calimero cluster or was removed from this one; ' +
      'sign up here, or open the app from the link for the cluster your account is on';
    node.answer = (head) =>
      head.path === '/auth/passkey/login/begin'
        ? { status: 200, json: { challengeId: 'l-1', options: CHALLENGE } }
        : { status: 401, json: { error: 'PASSKEY_UNKNOWN_HERE', message } };
    const error = await c.signIn(passkey).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PasskeyUnknownHere);
    expect(error).not.toBeInstanceOf(LoginRequired);
    expect(error).toMatchObject({ status: 401, code: 'PASSKEY_UNKNOWN_HERE', name: 'PasskeyUnknownHere' });
    expect((error as Error).message).toContain('another Calimero cluster');
    expect(sent()).toEqual([
      ['POST', '/auth/passkey/login/begin'],
      ['POST', '/auth/passkey/login/finish'],
    ]);
    expect(c.session).toBeUndefined();
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

  it('creates an upgrade key with the passkey, and upgrades with it alone', async () => {
    const c = client();
    node.answer = (head, body) => {
      if (head.path === '/auth/apikeys' && !body.confirm) {
        return { status: 412, json: { error: 'CONFIRM_REQUIRED', message: 'approve', details: CHALLENGE } };
      }
      return head.path === '/auth/apikeys'
        ? { status: 200, json: { keyId: 'k-ci', key: 'cal_ci' } }
        : { status: 200, json: { index: 7, status: 'ok', error: null } };
    };
    expect(await c.createApiKey({ label: 'ci', upgrades: { app: 'a-1' }, ttlSecs: 3600 }, passkey)).toEqual({
      keyId: 'k-ci',
      key: 'cal_ci',
    });
    expect(node.requests[0].body).toEqual({ label: 'ci', upgrades: { app: 'a-1' }, ttlSecs: 3600 });
    c.useApiKey('cal_ci');
    expect(await c.upgradeApp('a-1', { version: '1.1.0' })).toEqual({ index: 7, status: 'ok', error: null });
    expect(sent()).toEqual([
      ['POST', '/auth/apikeys'],
      ['POST', '/auth/apikeys'],
      ['POST', '/apps/a-1/upgrade'],
    ]);
    expect(last().body).toEqual({ version: '1.1.0' });
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
    ['deleteTeam', (c) => c.deleteTeam('org-1', 't-1', passkey), 'DELETE', '/orgs/org-1/teams/t-1', {}],
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

  it('deletes a team holding no apps without a passkey; one holding apps is ConfirmRequired naming them', async () => {
    node.answer = () => ({ status: 200, json: { apps: [] } });
    await client().deleteTeam('org-1', 't-empty');
    expect(sent()).toEqual([['DELETE', '/orgs/org-1/teams/t-empty']]);

    node.requests.length = 0;
    const details = { ...CHALLENGE, allowCredentials: ['cred'], apps: ['app-1'] };
    node.answer = (_, body) =>
      body.confirm
        ? { status: 200, json: { apps: ['app-1'] } }
        : { status: 412, json: { error: 'CONFIRM_REQUIRED', message: 'approve', details } };
    const error = await client()
      .deleteTeam('org-1', 't-1')
      .then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(ConfirmRequired);
    expect(error).toMatchObject({ status: 412, code: 'CONFIRM_REQUIRED', details: { apps: ['app-1'] } });
    expect(sent()).toEqual([['DELETE', '/orgs/org-1/teams/t-1']]);

    node.requests.length = 0;
    await client().deleteTeam('org-1', 't-1', passkey);
    expect(sent()).toEqual([
      ['DELETE', '/orgs/org-1/teams/t-1'],
      ['DELETE', '/orgs/org-1/teams/t-1'],
    ]);
    expect(last().body).toEqual({ confirm: { challengeId: 'c-1', assertion: expect.objectContaining({ signature: 'sig' }) } });
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

describe('app teams, the invite list and team default capabilities (core #4890)', () => {
  const confirmed = { challengeId: 'c-1', assertion: expect.objectContaining({ signature: 'sig' }) };

  it('lists the app teams and the mode, with no approval', async () => {
    const listed = {
      mode: 'shared',
      appTeams: [
        {
          package: 'com.example.chat',
          teamId: 't-1',
          name: 'Chat',
          join: 'invite',
          memberCount: 12,
          defaultCapabilities: null,
          member: true,
          manages: false,
        },
      ],
    };
    node.answer = () => ({ status: 200, json: listed });
    expect(await client().listAppTeams('org/1')).toEqual(listed);
    expect(sent()).toEqual([['GET', '/orgs/org%2F1/app-teams']]);
  });

  it('scopes apps with the passkey: only the fields given go, the same body again with confirm', async () => {
    const result = {
      mode: 'shared',
      teams: [{ package: 'com.example.chat', teamId: 't-1', created: true, apps: ['a-1'], added: 3 }],
    };
    confirming(result);
    const apps = [{ package: 'com.example.chat', name: 'Chat', instances: ['a-1'] }];
    expect(await client().scopeApps('org-1', passkey, { apps, shared: true })).toEqual(result);
    expect(sent()).toEqual([
      ['POST', '/orgs/org-1/app-teams'],
      ['POST', '/orgs/org-1/app-teams'],
    ]);
    expect(node.requests[0].body).toEqual({ apps, shared: true });
    expect(last().body).toEqual({ apps, shared: true, confirm: confirmed });
  });

  it('closes one app team keeping whom it names, the per-package join and keep sent as given', async () => {
    const result = {
      mode: 'shared',
      teams: [
        { package: 'com.example.chat', teamId: 't-1', created: false, apps: [], added: 1, join: 'invite', dropped: 2 },
      ],
    };
    confirming(result);
    const apps = [{ package: 'com.example.chat', join: 'invite' as const, keep: ['acc-bob'] }];
    expect(await client().scopeApps('org-1', passkey, { apps })).toEqual(result);
    expect(node.requests[0].body).toEqual({ apps });
    expect(last().body).toEqual({ apps, confirm: confirmed });
  });

  it("turns on an older app team's private channels, childTeams sent as given", async () => {
    const result = {
      mode: 'standalone',
      teams: [{ package: 'com.example.chat', teamId: 't-1', created: false, apps: [], added: 0, join: 'everyone', dropped: 0 }],
    };
    confirming(result);
    const apps = [{ package: 'com.example.chat', instances: [], childTeams: true }];
    expect(await client().scopeApps('org-1', passkey, { apps })).toEqual(result);
    expect(node.requests[0].body).toEqual({ apps });
    expect(last().body).toEqual({ apps, confirm: confirmed });
  });

  it('scopes every package with defaults: an empty body, never null fields the node would refuse', async () => {
    confirming({ mode: 'standalone', teams: [] });
    await client().scopeApps('org-1', passkey);
    expect(node.requests[0].body).toEqual({});
    expect(last().body).toEqual({ confirm: confirmed });
    confirming({ mode: 'standalone', teams: [] });
    await client().scopeApps('org-1', passkey, { apps: [{ package: 'com.example.blocks', instances: [] }], shared: false });
    expect(last().body).toEqual({ apps: [{ package: 'com.example.blocks', instances: [] }], shared: false, confirm: confirmed });
  });

  it('lists the invites the caller may see', async () => {
    const invites = [
      {
        inviteKey: 'k-1',
        role: 'member',
        teams: ['t-1'],
        usesLeft: 1,
        expiresAt: 1731300000,
        expired: false,
        createdBy: 'acc-1',
        createdAt: 1731200000,
      },
      { inviteKey: 'k-0', role: 'guest', teams: [], usesLeft: 2, expiresAt: 1, expired: true, createdBy: null, createdAt: null },
    ];
    node.answer = () => ({ status: 200, json: { invites } });
    expect(await client().listInvites('org-1')).toEqual(invites);
    expect(sent()).toEqual([['GET', '/orgs/org-1/invites']]);
  });

  it('revokes an invite by its key, approved with the passkey (__revoke_invite)', async () => {
    confirming({});
    await client().revokeInvite('org-1', 'k/1', passkey);
    expect(sent()).toEqual([
      ['DELETE', '/orgs/org-1/invites/k%2F1'],
      ['DELETE', '/orgs/org-1/invites/k%2F1'],
    ]);
    expect(node.requests[0].body).toEqual({});
    expect(last().body).toEqual({ confirm: confirmed });
  });

  it("sets a team's default capabilities: the team and no account", async () => {
    confirming({});
    await client().setTeamDefaultCapabilities('org-1', 't-1', ORG_CAPABILITIES.INVITE_MEMBERS, passkey);
    expect(sent()).toEqual([
      ['POST', '/orgs/org-1/capabilities'],
      ['POST', '/orgs/org-1/capabilities'],
    ]);
    expect(node.requests[0].body).toEqual({ team: 't-1', capabilities: 2 });
    expect(last().body).toEqual({ team: 't-1', capabilities: 2, confirm: confirmed });
  });

  it('without a passkey a scope or a revoke is ConfirmRequired, and nothing more is sent', async () => {
    confirming({});
    const none = undefined as unknown as PasskeyProvider;
    const c = client();
    expect(await c.scopeApps('org-1', none).catch((e: unknown) => e)).toBeInstanceOf(ConfirmRequired);
    expect(await c.revokeInvite('org-1', 'k-1', none).catch((e: unknown) => e)).toBeInstanceOf(ConfirmRequired);
    expect(sent()).toEqual([
      ['POST', '/orgs/org-1/app-teams'],
      ['DELETE', '/orgs/org-1/invites/k-1'],
    ]);
  });

  it("an invite the caller may not see is NotFound; a refused scope keeps the node's message", async () => {
    node.answer = () => ({ status: 404, json: { error: 'NOT_FOUND', message: 'no such invite' } });
    expect(await client().revokeInvite('org-1', 'k-1', passkey).catch((e: unknown) => e)).toBeInstanceOf(NotFound);
    const message = "only the organization's owner and admins install apps in it and change its app teams";
    node.answer = (_, body) =>
      body.confirm
        ? { status: 400, json: { error: 'REJECTED', message } }
        : { status: 412, json: { error: 'CONFIRM_REQUIRED', message: 'approve', details: CHALLENGE } };
    const error = await client()
      .scopeApps('org-1', passkey)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 400, code: 'REJECTED' });
    expect((error as Error).message).toContain(message);
  });

  it("reads a team's package and default capabilities", async () => {
    const team = {
      teamId: 't-1',
      name: 'Chat',
      parent: null,
      join: 'invite',
      metadata: { app: { package: 'com.example.chat', name: 'Chat' } },
      package: 'com.example.chat',
      defaultCapabilities: 2,
      members: [{ account: 'acc-1', role: 'lead', capabilities: 6 }],
      children: [],
      apps: [{ appId: 'a-1', name: 'chat', contextId: 'ab' }],
      myRole: 'lead',
      member: true,
    };
    node.answer = () => ({ status: 200, json: team });
    const got = await client().getTeam('org-1', 't-1');
    expect(got.package).toBe('com.example.chat');
    expect(got.defaultCapabilities).toBe(2);
    expect(got).toEqual(team);
  });
});

describe('organization recovery', () => {
  const seed = new Uint8Array(32).fill(1);
  const confirmed = { challengeId: 'c-1', assertion: expect.objectContaining({ signature: 'sig' }) };

  it('creates an org with a recovery key, then rotates and removes it with the owner\'s passkey', async () => {
    const c = client();
    node.answer = () => ({ status: 200, json: { orgId: 'org-1' } });
    const key = await recoveryPublicKey(seed);
    expect(await c.createOrg('Acme', { recoveryKey: key })).toBe('org-1');
    expect(last().body).toEqual({ name: 'Acme', recoveryKey: key });
    confirming({});
    await c.setRecoveryKey('org-1', key, passkey);
    expect(last().body).toEqual({ publicKey: key, confirm: confirmed });
    confirming({});
    await c.setRecoveryKey('org-1', null, passkey);
    expect(last().body).toEqual({ publicKey: null, confirm: confirmed });
    expect(sent().slice(1)).toEqual([
      ['POST', '/orgs/org-1/recovery'],
      ['POST', '/orgs/org-1/recovery'],
      ['POST', '/orgs/org-1/recovery'],
      ['POST', '/orgs/org-1/recovery'],
    ]);
  });

  it('starts with a signature the seed makes locally, then cancels or finishes with a passkey', async () => {
    const c = client();
    node.answer = (head) =>
      head.path === '/auth/me'
        ? { status: 200, json: { accountId: 'acc-2' } }
        : { status: 200, json: { startedAt: 1, readyAt: 2 } };
    expect(await c.startRecovery('org-1', seed)).toEqual({ startedAt: 1, readyAt: 2 });
    const { nonce, signature } = last().body as { nonce: string; signature: string };
    expect(signature).toBe(await signRecovery(seed, 'org-1', 'acc-2', nonce));
    expect(JSON.stringify(node.requests)).not.toContain(recoverySeedText(seed).replace(/-/g, ''));
    confirming({});
    await c.cancelRecovery('org-1', passkey);
    confirming({ org: 'org-1', previousOwners: ['acc-1'] });
    expect(await c.finishRecovery('org-1', passkey)).toEqual({ org: 'org-1', previousOwners: ['acc-1'] });
    expect(sent()).toEqual([
      ['GET', '/auth/me'],
      ['POST', '/orgs/org-1/recovery/start'],
      ['POST', '/orgs/org-1/recovery/cancel'],
      ['POST', '/orgs/org-1/recovery/cancel'],
      ['POST', '/orgs/org-1/recovery/finish'],
      ['POST', '/orgs/org-1/recovery/finish'],
    ]);
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

  it("reads the passkeys' times from me(), lists the account's sessions and ends one (core #4894)", async () => {
    const c = client();
    const SESSIONS = [
      { session: 's-2', passkey: 'cred', app: null, origin: null, openedAt: 10, lastActiveAt: 20, current: true },
      { session: 's/1', passkey: 'cred', app: 'com.example.kv', origin: 'https://kv.example', openedAt: null, lastActiveAt: 5, current: false },
    ];
    node.answer = (head) => {
      if (head.path === '/auth/me') {
        return {
          status: 200,
          json: {
            accountId: 'acc-1',
            passkeyId: 'cred',
            orgs: [{ orgId: 'org-1', name: 'Acme', role: 'admin' }],
            passkeys: [
              { id: 'cred', label: 'laptop', signCount: 3, addedAt: 10, lastSignInAt: 30 },
              { id: 'old', label: null, signCount: 0, addedAt: null, lastSignInAt: null },
            ],
          },
        };
      }
      if (head.path === '/auth/sessions') return { status: 200, json: { sessions: SESSIONS } };
      if (head.path === '/auth/sessions/gone') return { status: 404, json: { error: 'NOT_FOUND', message: 'no such session' } };
      return { status: 200, json: {} };
    };
    const me = await c.me();
    expect(me.passkeyId).toBe('cred');
    expect(me.orgs?.[0]?.role).toBe('admin');
    expect(me.passkeys?.map((p) => [p.id, p.addedAt, p.lastSignInAt])).toEqual([
      ['cred', 10, 30],
      ['old', null, null],
    ]);
    const sessions = await c.listSessions();
    expect(sessions).toEqual(SESSIONS);
    expect(sessions.find((s) => s.current)?.session).toBe('s-2');
    await c.revokeSession('s/1');
    await expect(c.revokeSession('gone')).rejects.toBeInstanceOf(NotFound);
    expect(sent()).toEqual([
      ['GET', '/auth/me'],
      ['GET', '/auth/sessions'],
      ['DELETE', '/auth/sessions/s%2F1'],
      ['DELETE', '/auth/sessions/gone'],
    ]);
  });

  it('moves an app to another organization with a passkey, and says when the node has no route', async () => {
    const c = client();
    const moved = { appId: 'a-1', from: 'o-1', org: 'o-2', access: { kind: 'org' }, created: false, added: [], revokedInvites: 0 };
    node.answer = (_head, body) =>
      body.confirm
        ? { status: 200, json: moved }
        : { status: 412, json: { error: 'CONFIRM_REQUIRED', message: '', details: CHALLENGE } };
    expect(await c.moveApp('a-1', 'o-2', { bringMembers: true }, passkey)).toEqual(moved);
    expect(last().body).toMatchObject({ toOrg: 'o-2', bringMembers: true, confirm: { challengeId: 'c-1' } });
    expect(sent()).toEqual([
      ['POST', '/apps/a-1/move'],
      ['POST', '/apps/a-1/move'],
    ]);
    // Without a passkey the step-up reaches the caller; bringMembers defaults to false.
    await expect(c.moveApp('a-1', 'o-2')).rejects.toMatchObject({ code: 'CONFIRM_REQUIRED' });
    expect(last().body).toEqual({ toOrg: 'o-2', bringMembers: false });
    // A node from before the route.
    node.answer = () => ({ status: 404, json: { error: 'NOT_FOUND', message: 'no route' } });
    await expect(c.moveApp('a-1', 'o-2', {}, passkey)).rejects.toMatchObject({ status: 404 });
  });

  it("lists an organization's members' lockout risk for its admins (core #4902)", async () => {
    const c = client();
    const MEMBERS = [
      { account: 'acc-1', name: 'Ana', role: 'admin', teams: ['t1'], passkeys: '3+', recoveryCode: true, lastActiveDay: '2026-11-10', sessions: 2 },
      { account: 'acc-2', name: null, role: 'guest', teams: [], passkeys: 1, recoveryCode: false, lastActiveDay: null, sessions: 0 },
    ];
    node.answer = (head) =>
      head.path.startsWith('/orgs/o%2F1/members') ? { status: 200, json: { orgId: 'o/1', members: MEMBERS } } : { status: 200, json: {} };
    expect(await c.orgMembersSecurity('o/1')).toEqual(MEMBERS);
    expect(sent()).toEqual([['GET', '/orgs/o%2F1/members?detail=security']]);
  });

  it("lists what the account's passkeys did (core #4901)", async () => {
    const c = client();
    const ACTIVITY = [
      { at: 30, passkey: 'cred', kind: 'approval', app: null, origin: null, method: '__create_api_key', subject: 'account:acc-1' },
      { at: 10, passkey: 'cred', kind: 'signIn', app: 'com.example.kv', origin: 'https://kv.example', method: null, subject: null },
    ];
    node.answer = (head) =>
      head.path.startsWith('/auth/activity') ? { status: 200, json: { activity: ACTIVITY } } : { status: 200, json: {} };
    expect(await c.listActivity()).toEqual(ACTIVITY);
    await c.listActivity(20);
    expect(sent()).toEqual([
      ['GET', '/auth/activity'],
      ['GET', '/auth/activity?after=20'],
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
