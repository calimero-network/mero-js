/**
 * A link grant is bound to the browser that asked for it: the consent URL
 * carries sha256(verifier), and only the spend reveals the verifier.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudClient } from './cloud-client.js';
import { cloudLinkUrl, completeCloudLink, readCloudLinkCallback } from './link-redirect.js';

const ROOT_SECRET = '5b6b8a1e9f2c47d3a80e6f14c2b9d75380af4e21c6d3b95f7e08a1c4d2f63b97';
const ACCOUNT = 'ca7645ffd4d0621d00c6c88743aeace5797135ab298c49e77de066206090b778';
const RETURN_TO = 'https://app.example/connected';
const PENDING_KEY = 'calimero.cloud.link.pending';

let store: Map<string, string>;

beforeEach(() => {
  vi.unstubAllGlobals();
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
});

async function sha256Hex(hexValue: string): Promise<string> {
  const bytes = Uint8Array.from(hexValue.match(/../g)!, (b) => parseInt(b, 16));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A grant shaped as the cloud seals one: base64url(JSON claims) and a tag. */
function grantFor(claims: Record<string, unknown>): string {
  const body = btoa(JSON.stringify({ use: 'account-link-grant', sub: 'owner@example.com', exp: 1, ...claims }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${body}.dGFn`;
}

function callback(consentUrl: string, grant: string): URL {
  const back = new URL(new URL(consentUrl).searchParams.get('callback-url')!);
  back.hash = `grant=${grant}&account=${ACCOUNT}`;
  return back;
}

function jsonFetch(body: unknown) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(body));
}

describe('the consent URL', () => {
  it('carries sha256 of the verifier the callback hands back, as 64 lowercase hex', async () => {
    const consent = await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO });
    const challenge = new URL(consent).searchParams.get('challenge')!;
    expect(challenge).toMatch(/^[0-9a-f]{64}$/);

    const back = callback(consent, grantFor({ acc: ACCOUNT, chal: challenge }));
    const got = readCloudLinkCallback({ hash: back.hash, search: back.search })!;
    expect(got.verifier).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex(got.verifier)).toBe(challenge);
  });

  it('carries the challenge on the CloudClient handoff too', async () => {
    const { url } = await CloudClient.accountLinkHandoff({
      portalUrl: 'https://cloud.calimero.network',
      accountId: ACCOUNT,
      callbackUrl: RETURN_TO,
    });
    const challenge = new URL(url).searchParams.get('challenge')!;
    const out = CloudClient.readAccountLinkCallback(
      callback(url, grantFor({ acc: ACCOUNT, chal: challenge })).toString(),
    );
    expect(await sha256Hex(out.verifier!)).toBe(challenge);
  });

  it('never carries the verifier itself', async () => {
    const consent = await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO });
    const challenge = new URL(consent).searchParams.get('challenge')!;
    const back = callback(consent, grantFor({ acc: ACCOUNT, chal: challenge }));
    const { verifier } = readCloudLinkCallback({ hash: back.hash, search: back.search })!;
    expect(verifier).toMatch(/^[0-9a-f]{64}$/);
    expect(consent).not.toContain(verifier);
  });

  it('gives each flow a fresh verifier', async () => {
    const a = new URL(await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }));
    const b = new URL(await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }));
    expect(a.searchParams.get('challenge')).not.toBe(b.searchParams.get('challenge'));
  });
});

describe('the stored verifier', () => {
  it('is removed from storage once the callback is read', async () => {
    const consent = await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO });
    const challenge = new URL(consent).searchParams.get('challenge')!;
    const back = callback(consent, grantFor({ acc: ACCOUNT, chal: challenge }));
    const { verifier } = readCloudLinkCallback({ hash: back.hash, search: back.search })!;
    expect(verifier).toMatch(/^[0-9a-f]{64}$/);
    expect(store.get(PENDING_KEY) ?? '').not.toContain(verifier);
  });

  it('is removed when the consent was declined', async () => {
    const consent = await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO });
    const back = callback(consent, 'x');
    expect(store.get(PENDING_KEY)).toMatch(/"verifier":"[0-9a-f]{64}"/);
    expect(() => readCloudLinkCallback({ hash: '#error=denied', search: back.search })).toThrow(/declined/);
    expect(JSON.parse(store.get(PENDING_KEY)!)).toEqual({});
  });

  it('is removed when a callback is refused for naming another account', async () => {
    const consent = await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO });
    const back = callback(consent, 'x');
    back.hash = `grant=${grantFor({ acc: 'aa'.repeat(32), chal: 'bb'.repeat(32) })}&account=${'aa'.repeat(32)}`;
    expect(store.get(PENDING_KEY)).toMatch(/"verifier":"[0-9a-f]{64}"/);
    expect(() => readCloudLinkCallback({ hash: back.hash, search: back.search })).toThrow(/did not make/);
    expect(JSON.parse(store.get(PENDING_KEY)!)).toEqual({});
  });

  it('is required: a pending link stored without one is refused', async () => {
    const consent = await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO });
    const challenge = new URL(consent).searchParams.get('challenge')!;
    const pending = JSON.parse(store.get(PENDING_KEY)!) as Record<string, Record<string, unknown>>;
    for (const entry of Object.values(pending)) delete entry.verifier;
    store.set(PENDING_KEY, JSON.stringify(pending));

    const back = callback(consent, grantFor({ acc: ACCOUNT, chal: challenge }));
    expect(() => readCloudLinkCallback({ hash: back.hash, search: back.search })).toThrow(/did not make/);
    expect(CloudClient.readAccountLinkCallback(back.toString()).error).toBe('unexpected_callback');
  });
});

describe('reading the grant', () => {
  it('names the cloud login that consented, to show before spending', async () => {
    const consent = await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO });
    const challenge = new URL(consent).searchParams.get('challenge')!;
    const back = callback(consent, grantFor({ acc: ACCOUNT, chal: challenge, sub: 'someone@example.com' }));
    expect(readCloudLinkCallback({ hash: back.hash, search: back.search })!.login).toBe('someone@example.com');
  });

  it('refuses a grant that is not a link grant', async () => {
    const consent = await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO });
    for (const grant of ['not-a-grant', grantFor({ use: 'account-create-grant', chal: 'aa'.repeat(32) })]) {
      const { url } = await CloudClient.accountLinkHandoff({
        portalUrl: 'https://cloud.calimero.network',
        accountId: ACCOUNT,
        callbackUrl: RETURN_TO,
      });
      expect(CloudClient.readAccountLinkCallback(callback(url, grant).toString()).error).toBe(
        'unexpected_callback',
      );
      const back = callback(consent, grant);
      expect(() => readCloudLinkCallback({ hash: back.hash, search: back.search })).toThrow(/did not make/);
    }
  });
});

describe('spending the grant', () => {
  async function begun(): Promise<{ grant: string; verifier: string }> {
    const consent = await cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO });
    const challenge = new URL(consent).searchParams.get('challenge')!;
    const back = callback(consent, grantFor({ acc: ACCOUNT, chal: challenge }));
    const got = readCloudLinkCallback({ hash: back.hash, search: back.search })!;
    expect(got.verifier).toMatch(/^[0-9a-f]{64}$/);
    return got;
  }

  it('sends the verifier with the grant', async () => {
    const { grant, verifier } = await begun();
    const fetchSpy = jsonFetch({ account_id: ACCOUNT });
    await completeCloudLink({ grant, verifier, account: ACCOUNT, login: 'owner@example.com', root: ROOT_SECRET, cloudBaseUrl: 'https://cloud.test', fetch: fetchSpy as unknown as typeof fetch });

    const sent = JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body)) as Record<string, unknown>;
    expect(sent.verifier).toBe(verifier);
    expect(sent.grant).toBe(grant);
  });

  it('refuses without a verifier, before anything is sent', async () => {
    const { grant } = await begun();
    for (const verifier of [undefined, '', 'zz'.repeat(32)]) {
      const fetchSpy = jsonFetch({});
      await expect(
        new CloudClient({ cloudBaseUrl: 'https://cloud.test', fetch: fetchSpy as unknown as typeof fetch }).linkAccountWithGrant({
          grant,
          verifier: verifier as string,
          rootSecret: ROOT_SECRET,
        }),
      ).rejects.toThrow(/verifier/);
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  });

  it('refuses a grant minted for another verifier, before the root signs', async () => {
    const { verifier } = await begun();
    const foreign = grantFor({ acc: ACCOUNT, chal: 'cc'.repeat(32) });
    const fetchSpy = jsonFetch({});
    await expect(
      new CloudClient({ cloudBaseUrl: 'https://cloud.test', fetch: fetchSpy as unknown as typeof fetch }).linkAccountWithGrant({
        grant: foreign,
        verifier,
        rootSecret: ROOT_SECRET,
      }),
    ).rejects.toThrow(/not issued to this link request/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a grant naming an account the root does not derive, before the root signs', async () => {
    const { verifier } = await begun();
    const grant = grantFor({ acc: 'aa'.repeat(32), chal: await sha256Hex(verifier) });
    const fetchSpy = jsonFetch({});
    await expect(
      new CloudClient({ cloudBaseUrl: 'https://cloud.test', fetch: fetchSpy as unknown as typeof fetch }).linkAccountWithGrant({
        grant,
        verifier,
        rootSecret: ROOT_SECRET,
      }),
    ).rejects.toThrow(/different account/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
