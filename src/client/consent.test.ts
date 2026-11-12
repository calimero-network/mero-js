/**
 * The consent page flow (`client.consent.request`, `begin`, `resume`, `wait`)
 * against the stand-in node, with `location`, `history` and `sessionStorage`
 * stubbed.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { StandInNode } from '../../tests/support/stand-in-node.js';
import { CalimeroClient, CalimeroError } from './calimero-client.js';
import { confirmationCode } from './approvals.js';
import { CONSENT_STORAGE_KEY, withoutConsentParams, type ConsentDecision } from './consent.js';

const node = new StandInNode();
beforeAll(() => node.start());
afterAll(() => node.stop());

const client = () => new CalimeroClient({ baseUrl: node.url, policy: { allowMock: true } });
const last = () => node.requests[node.requests.length - 1];
const paths = () => node.requests.map((r) => `${r.head.method} ${r.head.path}`);

const ID = '1.AAAAAAAAAAAAAAAAAAAAAA';
const PAGE = `https://node-1.example/consent/${ID}`;
const started = async (id = ID) => ({ requestId: id, url: PAGE, code: await confirmationCode(id), expiresAt: 9e9 });

/** A browser: a page at `href`, its history and its session storage. */
function stubBrowser(href: string) {
  const store = new Map<string, string>();
  const page = {
    href,
    assigned: [] as string[],
    replaced: [] as string[],
  };
  vi.stubGlobal('location', {
    get href() {
      return page.href;
    },
    assign: (url: string) => page.assigned.push(url),
  });
  vi.stubGlobal('history', {
    state: null,
    replaceState: (_s: unknown, _u: string, url?: string) => {
      if (url) {
        page.replaced.push(url);
        page.href = url;
      }
    },
  });
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return { page, store };
}

beforeEach(() => {
  node.requests.length = 0;
  node.answer = () => ({ status: 200, json: {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('client.consent.request', () => {
  it('sends each kind as the node takes it and answers a typed ticket', async () => {
    const c = client();
    const answer = await started();
    node.answer = () => ({ status: 200, json: answer });

    const ticket = await c.consent.request({ kind: 'createOrg', subject: { name: 'Acme' }, returnTo: 'https://kv.apps.example/' });
    expect(ticket).toEqual({ ...answer, kind: 'createOrg' });
    expect(last().head.path).toBe('/consent/requests');
    expect(last().body).toEqual({ kind: 'createOrg', subject: { name: 'Acme' }, returnTo: 'https://kv.apps.example/' });

    await c.consent.request({
      kind: 'createInvite',
      subject: { org: 'org-1', role: 'member', teams: ['t-1'], ttlSecs: 3600, uses: 1, allApps: false },
      returnTo: 'https://kv.apps.example/',
    });
    expect(last().body).toEqual({
      kind: 'createInvite',
      subject: { org: 'org-1', role: 'member', teams: ['t-1'], ttlSecs: 3600, uses: 1, allApps: false },
      returnTo: 'https://kv.apps.example/',
    });

    await c.consent.request({ kind: 'acceptInvite', subject: { token: 'inv-secret' }, returnTo: 'https://kv.apps.example/' });
    expect(last().body).toEqual({ kind: 'acceptInvite', subject: { token: 'inv-secret' }, returnTo: 'https://kv.apps.example/' });

    await c.consent.request({ kind: 'release', scope: { org: 'org-1' }, subject: { version: '2.3.130' }, returnTo: 'https://x/' });
    expect(last().body).toMatchObject({ kind: 'release', scope: { org: 'org-1' } });
  });

  it("refuses a code that is not the request's", async () => {
    const c = client();
    node.answer = () => ({ status: 200, json: { requestId: ID, url: PAGE, code: '54E-429', expiresAt: 9e9 } });
    const refused = await c.consent
      .request({ kind: 'acceptInvite', subject: { token: 'inv-secret' }, returnTo: 'https://x/' })
      .catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(CalimeroError);
    expect(refused).toMatchObject({ code: 'CONSENT_CODE_MISMATCH' });
    // The token is in no error.
    expect(JSON.stringify((refused as CalimeroError).details)).not.toContain('inv-secret');
    expect((refused as Error).message).not.toContain('inv-secret');
  });
});

describe('client.consent.begin', () => {
  it('returns to this page without the old parameters, stores the request and navigates', async () => {
    const { page, store } = stubBrowser('https://kv.apps.example/settings?tab=org&request_id=old&result=declined#top');
    const c = client();
    const answer = await started();
    node.answer = () => ({ status: 200, json: answer });

    const ticket = await c.consent.begin({ kind: 'acceptInvite', subject: { token: 'inv-secret' } });
    expect(ticket.kind).toBe('acceptInvite');
    expect(last().body).toEqual({
      kind: 'acceptInvite',
      subject: { token: 'inv-secret' },
      returnTo: 'https://kv.apps.example/settings?tab=org#top',
    });
    expect(JSON.parse(store.get(CONSENT_STORAGE_KEY) ?? '')).toEqual({ requestId: ID, kind: 'acceptInvite' });
    expect(store.get(CONSENT_STORAGE_KEY)).not.toContain('inv-secret');
    expect(page.assigned).toEqual([PAGE]);
  });

  it('takes `returnTo`, and opens nothing when `confirm` declines', async () => {
    const { page, store } = stubBrowser('https://kv.apps.example/');
    const c = client();
    const answer = await started();
    node.answer = () => ({ status: 200, json: answer });

    const shown: string[] = [];
    await c.consent.begin(
      { kind: 'createOrg', subject: { name: 'Acme' } },
      { returnTo: 'https://kv.apps.example/orgs', confirm: (t) => (shown.push(t.code), false) },
    );
    expect(last().body).toMatchObject({ returnTo: 'https://kv.apps.example/orgs' });
    expect(shown).toEqual([answer.code]);
    expect(page.assigned).toEqual([]);
    expect(store.has(CONSENT_STORAGE_KEY)).toBe(false);

    const opened: string[] = [];
    await c.consent.begin({ kind: 'createOrg', subject: { name: 'Acme' }, returnTo: 'https://kv.apps.example/x' }, { navigate: (u) => opened.push(u) });
    expect(last().body).toMatchObject({ returnTo: 'https://kv.apps.example/x' });
    expect(opened).toEqual([PAGE]);
    expect(page.assigned).toEqual([]);
  });
});

describe('client.consent.resume', () => {
  const decided = (status: string, kind = 'createOrg', outcome?: object) => ({
    requestId: ID,
    kind,
    status,
    decidedAt: status === 'pending' ? null : 7,
    ...(outcome ? { outcome } : {}),
  });

  it('reads an approval from the node, typed by kind, and tidies the URL and storage', async () => {
    const { page, store } = stubBrowser(`https://kv.apps.example/orgs?tab=1&request_id=${ID}&result=approved`);
    store.set(CONSENT_STORAGE_KEY, JSON.stringify({ requestId: ID, kind: 'createOrg' }));
    node.answer = () => ({ status: 200, json: decided('approved', 'createOrg', { orgId: 'org-9' }) });

    const d = await client().consent.resume();
    expect(d).toEqual({ requestId: ID, kind: 'createOrg', status: 'approved', decidedAt: 7, outcome: { orgId: 'org-9' } });
    if (d?.kind === 'createOrg') expect(d.outcome?.orgId).toBe('org-9');
    expect(paths()).toEqual([`GET /consent/${ID}/result`]);
    expect(page.replaced).toEqual(['https://kv.apps.example/orgs?tab=1']);
    expect(store.has(CONSENT_STORAGE_KEY)).toBe(false);
  });

  it("answers the node's status, not the URL's `result`", async () => {
    const { page, store } = stubBrowser(`https://kv.apps.example/?request_id=${ID}&result=approved`);
    store.set(CONSENT_STORAGE_KEY, JSON.stringify({ requestId: ID, kind: 'createOrg' }));
    node.answer = () => ({ status: 200, json: decided('declined') });
    expect(await client().consent.resume()).toMatchObject({ status: 'declined' });
    expect(page.replaced).toEqual(['https://kv.apps.example/']);
    expect(store.has(CONSENT_STORAGE_KEY)).toBe(false);

    // Still pending (a hand-typed URL): answered as pending, the stored request kept for `wait`.
    const again = stubBrowser(`https://kv.apps.example/?request_id=${ID}&result=approved`);
    again.store.set(CONSENT_STORAGE_KEY, JSON.stringify({ requestId: ID, kind: 'createOrg' }));
    node.answer = () => ({ status: 200, json: decided('pending') });
    expect(await client().consent.resume()).toMatchObject({ status: 'pending' });
    expect(again.store.has(CONSENT_STORAGE_KEY)).toBe(true);
  });

  it('answers a declined invite with no outcome', async () => {
    stubBrowser(`https://kv.apps.example/?request_id=${ID}&result=declined`);
    node.answer = () => ({ status: 200, json: decided('declined', 'acceptInvite') });
    const d: ConsentDecision | null = await client().consent.resume();
    expect(d).toEqual({ requestId: ID, kind: 'acceptInvite', status: 'declined', decidedAt: 7 });
  });

  it('answers null, and asks nothing, without the parameters', async () => {
    const { page } = stubBrowser('https://kv.apps.example/?result=approved');
    expect(await client().consent.resume()).toBeNull();
    expect(await client().consent.resume('https://kv.apps.example/')).toBeNull();
    expect(node.requests).toEqual([]);
    expect(page.replaced).toEqual([]);
  });

  it('ignores a request id this tab did not begin', async () => {
    const { page, store } = stubBrowser('https://kv.apps.example/?request_id=1.other&result=approved');
    store.set(CONSENT_STORAGE_KEY, JSON.stringify({ requestId: ID, kind: 'createOrg' }));
    expect(await client().consent.resume()).toBeNull();
    expect(node.requests).toEqual([]);
    expect(page.replaced).toEqual(['https://kv.apps.example/']);
    expect(store.has(CONSENT_STORAGE_KEY)).toBe(true);
  });

  it('refuses a result of another kind than the one begun', async () => {
    const { store } = stubBrowser(`https://kv.apps.example/?request_id=${ID}&result=approved`);
    store.set(CONSENT_STORAGE_KEY, JSON.stringify({ requestId: ID, kind: 'createOrg' }));
    node.answer = () => ({ status: 200, json: decided('approved', 'createInvite', { token: 'inv-secret' }) });
    const refused = await client().consent.resume().catch((e: unknown) => e);
    expect(refused).toMatchObject({ code: 'CONSENT_KIND_MISMATCH' });
    expect(JSON.stringify(refused)).not.toContain('inv-secret');
    expect(store.has(CONSENT_STORAGE_KEY)).toBe(false);
  });

  it('reads a given URL without touching history', async () => {
    const { page } = stubBrowser('https://kv.apps.example/');
    node.answer = () => ({ status: 200, json: decided('approved', 'createInvite', { token: 'inv-1' }) });
    const d = await client().consent.resume(`https://kv.apps.example/?request_id=${ID}&result=approved`);
    if (d?.kind === 'createInvite') expect(d.outcome?.token).toBe('inv-1');
    else expect.unreachable();
    expect(page.replaced).toEqual([]);
  });

  it('strips only the consent parameters', () => {
    expect(withoutConsentParams('https://a.example/p?x=1&request_id=r&result=approved&y=2#h')).toBe('https://a.example/p?x=1&y=2#h');
  });
});

describe('client.consent.wait', () => {
  it('polls until decided', async () => {
    let polls = 0;
    node.answer = () => {
      polls += 1;
      return {
        status: 200,
        json:
          polls < 3
            ? { requestId: ID, kind: 'createInvite', status: 'pending', decidedAt: null }
            : { requestId: ID, kind: 'createInvite', status: 'approved', decidedAt: 5, outcome: { token: 'inv-1' } },
      };
    };
    const ticket = { ...(await started()), kind: 'createInvite' as const };
    const d = await client().consent.wait(ticket, { pollMs: 1 });
    expect(d.outcome?.token).toBe('inv-1');
    expect(polls).toBe(3);
    expect(last().head.path).toBe(`/consent/${ID}/result`);
  });

  it('gives up after `timeoutMs`, and when the ticket expires', async () => {
    node.answer = () => ({ status: 200, json: { requestId: ID, kind: 'createOrg', status: 'pending', decidedAt: null } });
    const c = client();
    const timedOut = await c.consent.wait(ID, { pollMs: 5, timeoutMs: 30 }).catch((e: unknown) => e);
    expect(timedOut).toMatchObject({ name: 'TimeoutError' });
    expect(node.requests.length).toBeGreaterThan(1);

    node.requests.length = 0;
    const expired = { ...(await started()), expiresAt: Date.now() / 1000 - 1, kind: 'createOrg' as const };
    expect(await c.consent.wait(expired, { pollMs: 5 }).catch((e: unknown) => e)).toMatchObject({ name: 'TimeoutError' });
    expect(node.requests.length).toBe(1);
  });

  it('stops when the signal aborts', async () => {
    node.answer = () => ({ status: 200, json: { requestId: ID, kind: 'createOrg', status: 'pending', decidedAt: null } });
    const c = client();
    const controller = new AbortController();
    const waiting = c.consent.wait(ID, { pollMs: 10_000, signal: controller.signal }).catch((e: unknown) => e);
    await vi.waitFor(() => expect(node.requests.length).toBe(1));
    const reason = new Error('left the page');
    controller.abort(reason);
    expect(await waiting).toBe(reason);
    expect(node.requests.length).toBe(1);

    const aborted = AbortSignal.abort();
    expect(await c.consent.wait(ID, { signal: aborted }).catch((e: unknown) => e)).toMatchObject({ name: 'AbortError' });
    expect(node.requests.length).toBe(1);
  });
});
