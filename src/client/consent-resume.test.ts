/**
 * The consent page's organization kinds (core#5014: `createOrg`,
 * `createInvite`, `acceptInvite`), their typed outcomes, and
 * `resumeConsent` on the page the consent page sends the person back to,
 * against the stand-in node with `location`, `history` and `sessionStorage`
 * stubbed.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { StandInNode } from '../../tests/support/stand-in-node.js';
import { CalimeroClient, CalimeroError } from './calimero-client.js';
import {
  CONSENT_STORAGE_KEY,
  acceptInviteConsent,
  confirmationCode,
  createInviteConsent,
  createOrgConsent,
  withoutConsentReturn,
  type ConsentResult,
} from './approvals.js';

const node = new StandInNode();
beforeAll(() => node.start());
afterAll(() => node.stop());

const client = () => new CalimeroClient({ baseUrl: node.url, policy: { allowMock: true } });
const last = () => node.requests[node.requests.length - 1];
const paths = () => node.requests.map((r) => `${r.head.method} ${r.head.path}`);

const ID = '1.AAAAAAAAAAAAAAAAAAAAAA';
const PAGE = `https://node-1.example/consent/${ID}`;
const RETURN = 'https://kv.apps.example/orgs';

/** A browser tab: a page at `href`, its history and its session storage. */
function stubBrowser(href: string) {
  const store = new Map<string, string>();
  const page = { href, assigned: [] as string[], replaced: [] as string[] };
  vi.stubGlobal('location', {
    get href() {
      return page.href;
    },
    assign: (url: string) => page.assigned.push(url),
  });
  vi.stubGlobal('window', { location: { assign: (url: string) => page.assigned.push(url) } });
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

const result = (status: string, kind = 'createOrg', outcome?: object, requestId = ID) => ({
  requestId,
  kind,
  status,
  decidedAt: status === 'pending' ? null : 7,
  ...(outcome ? { outcome } : {}),
});

beforeEach(() => {
  node.requests.length = 0;
  node.answer = () => ({ status: 200, json: {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('organization consent requests', () => {
  it('sends createOrg, createInvite and acceptInvite as the node takes them', async () => {
    const c = client();
    const started = { requestId: ID, url: PAGE, code: await confirmationCode(ID), expiresAt: 9e9 };
    node.answer = () => ({ status: 200, json: started });
    const opened: string[] = [];
    const navigate = (url: string) => void opened.push(url);

    expect(await c.openConsentPage(createOrgConsent('Acme', RETURN), navigate)).toEqual(started);
    expect(last().head.path).toBe('/consent/requests');
    expect(last().body).toEqual({ kind: 'createOrg', subject: { name: 'Acme' }, returnTo: RETURN });

    await c.openConsentPage(
      createInviteConsent({ org: 'org-1', role: 'member', teams: ['t-1'], ttlSecs: 3600, uses: 1, allApps: false }, RETURN),
      navigate,
    );
    expect(last().body).toEqual({
      kind: 'createInvite',
      subject: { org: 'org-1', role: 'member', teams: ['t-1'], ttlSecs: 3600, uses: 1, allApps: false },
      returnTo: RETURN,
    });

    await c.openConsentPage(acceptInviteConsent('inv-secret', RETURN), navigate);
    expect(last().body).toEqual({ kind: 'acceptInvite', subject: { token: 'inv-secret' }, returnTo: RETURN });
    expect(opened).toEqual([PAGE, PAGE, PAGE]);
  });

  it("types the result's outcome by kind", async () => {
    const c = client();
    node.answer = () => ({ status: 200, json: result('approved', 'createInvite', { token: 'inv-1' }) });
    const r: ConsentResult = await c.waitForConsent(ID, { intervalMs: 1 });
    if (r.kind === 'createInvite') expect(r.outcome?.token).toBe('inv-1');
    else expect.unreachable();
  });

  it('stores the started request id for resumeConsent, and nothing of the request', async () => {
    const { page, store } = stubBrowser(`${RETURN}?tab=1`);
    const started = { requestId: ID, url: PAGE, code: await confirmationCode(ID), expiresAt: 9e9 };
    node.answer = () => ({ status: 200, json: started });
    await client().openConsentPage(acceptInviteConsent('inv-secret', RETURN));
    expect(store.get(CONSENT_STORAGE_KEY)).toBe(ID);
    expect(page.assigned).toEqual([PAGE]);

    // Declined in `confirm`: nothing stored, nothing opened.
    store.clear();
    await client().openConsentPage(acceptInviteConsent('inv-secret', RETURN), { confirm: () => false });
    expect(store.size).toBe(0);
    expect(page.assigned).toEqual([PAGE]);
  });
});

describe('client.resumeConsent', () => {
  const back = (result = 'approved', id = ID) => `${RETURN}?tab=1&request_id=${id}&result=${result}`;

  it("answers this page's request as the node decided it, and tidies the URL and storage", async () => {
    const { page, store } = stubBrowser(back());
    store.set(CONSENT_STORAGE_KEY, ID);
    node.answer = () => ({ status: 200, json: result('approved', 'createOrg', { orgId: 'org-9' }) });

    const r = await client().resumeConsent();
    expect(r).toEqual({ requestId: ID, kind: 'createOrg', status: 'approved', decidedAt: 7, outcome: { orgId: 'org-9' } });
    if (r?.kind === 'createOrg') expect(r.outcome?.orgId).toBe('org-9');
    expect(paths()).toEqual([`GET /consent/${ID}/result`]);
    expect(page.replaced).toEqual([`${RETURN}?tab=1`]);
    expect(store.has(CONSENT_STORAGE_KEY)).toBe(false);
  });

  it("trusts the node's status over the URL's `result`", async () => {
    const { store } = stubBrowser(back('approved'));
    store.set(CONSENT_STORAGE_KEY, ID);
    node.answer = () => ({ status: 200, json: result('declined', 'acceptInvite') });
    expect(await client().resumeConsent()).toEqual({ requestId: ID, kind: 'acceptInvite', status: 'declined', decidedAt: 7 });
  });

  it('answers null without a request_id, and asks nothing', async () => {
    const { page } = stubBrowser(`${RETURN}?result=approved`);
    expect(await client().resumeConsent()).toBeNull();
    expect(node.requests).toEqual([]);
    expect(page.replaced).toEqual([]);
  });

  it('refuses a return when this page started no request', async () => {
    stubBrowser(back());
    const refused = await client().resumeConsent().catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(CalimeroError);
    expect(refused).toMatchObject({ code: 'CONSENT_NOT_STARTED' });
    expect(node.requests).toEqual([]);
  });

  it('refuses a return for another request than this page started', async () => {
    const { page, store } = stubBrowser(back('approved', '1.forged'));
    store.set(CONSENT_STORAGE_KEY, ID);
    const refused = await client().resumeConsent().catch((e: unknown) => e);
    expect(refused).toMatchObject({ code: 'CONSENT_REQUEST_MISMATCH', details: { requestId: ID, returned: '1.forged' } });
    expect(node.requests).toEqual([]);
    expect(page.replaced).toEqual([`${RETURN}?tab=1`]);
    expect(store.get(CONSENT_STORAGE_KEY)).toBe(ID);
  });

  it("refuses a return while this page's request is still pending", async () => {
    const { store } = stubBrowser(back('approved'));
    store.set(CONSENT_STORAGE_KEY, ID);
    node.answer = () => ({ status: 200, json: result('pending') });
    const refused = await client().resumeConsent().catch((e: unknown) => e);
    expect(refused).toMatchObject({ code: 'CONSENT_NOT_DECIDED', details: { requestId: ID } });
    expect(store.get(CONSENT_STORAGE_KEY)).toBe(ID);
  });

  it('refuses an answer for another request', async () => {
    stubBrowser(back());
    node.answer = () => ({ status: 200, json: result('approved', 'createOrg', { orgId: 'o' }, '1.other') });
    const refused = await client().resumeConsent({ requestId: ID }).catch((e: unknown) => e);
    expect(refused).toMatchObject({ code: 'CONSENT_REQUEST_MISMATCH' });
  });

  it('reads a given URL and request id without touching history, and keeps the token out of errors', async () => {
    const { page } = stubBrowser(RETURN);
    node.answer = () => ({ status: 200, json: result('approved', 'createInvite', { token: 'inv-secret' }) });
    const r = await client().resumeConsent({ requestId: ID, href: back() });
    if (r?.kind === 'createInvite') expect(r.outcome?.token).toBe('inv-secret');
    else expect.unreachable();
    expect(page.replaced).toEqual([]);

    node.answer = () => ({ status: 200, json: result('pending', 'createInvite') });
    const refused = await client().resumeConsent({ requestId: ID, href: back() }).catch((e: unknown) => e);
    expect(JSON.stringify((refused as CalimeroError).details)).not.toContain('inv-secret');
  });

  it('strips only the consent parameters', () => {
    expect(withoutConsentReturn('https://a.example/p?x=1&request_id=r&result=approved&y=2#h')).toBe('https://a.example/p?x=1&y=2#h');
  });
});
