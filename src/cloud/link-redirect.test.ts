/**
 * The redirect half of account linking.
 *
 * Every check here is about a way the flow can go wrong *silently* — a grant
 * replayed on reload, a grant spent for the wrong account, a refusal treated as
 * a pending state. The happy path is one line and is the least of it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cloudLinkUrl,
  readCloudLinkCallback,
  completeCloudLink,
} from './link-redirect.js';

const ACCOUNT = '1f'.repeat(32);

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  });
});

describe('cloudLinkUrl', () => {
  it('names the account and where to come back to', async () => {
    const url = new URL(
      await cloudLinkUrl({ accountId: ACCOUNT, returnTo: 'https://app.example/back' }),
    );
    expect(url.origin).toBe('https://cloud.calimero.network');
    expect(url.searchParams.get('link-account')).toBe(ACCOUNT);
    const back = new URL(url.searchParams.get('callback-url')!);
    expect(back.origin + back.pathname).toBe('https://app.example/back');
    expect(back.searchParams.get('link_state')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('refuses an account id the cloud would reject anyway', async () => {
    // The consent page validates /^[0-9a-f]{64}$/ and renders nothing
    // otherwise, so an uppercase id would strand the person on a blank screen.
    await expect(
      cloudLinkUrl({ accountId: ACCOUNT.toUpperCase(), returnTo: 'https://app.example' }),
    ).rejects.toThrow(/64 lowercase hex/);
  });
});

describe('readCloudLinkCallback', () => {
  it('is null on an ordinary page load', () => {
    expect(readCloudLinkCallback({ hash: '' })).toBeNull();
  });

  it('reads the grant the cloud handed back', async () => {
    const consent = await cloudLinkUrl({ accountId: ACCOUNT, returnTo: 'https://app.example/back' });
    const back = new URL(new URL(consent).searchParams.get('callback-url')!);
    const claims = { use: 'account-link-grant', sub: 'owner@example.com', acc: ACCOUNT, chal: 'ab'.repeat(32), exp: 1 };
    const grant = `${btoa(JSON.stringify(claims)).replace(/=+$/, '')}.dGFn`;
    const got = readCloudLinkCallback({
      hash: `#grant=${grant}&account=${ACCOUNT}`,
      search: back.search,
    });
    expect(got).toEqual({
      grant,
      account: ACCOUNT,
      login: 'owner@example.com',
      verifier: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('throws when the person declined, rather than waiting forever', () => {
    expect(() => readCloudLinkCallback({ hash: '#error=denied' })).toThrow(/declined/);
  });
});

describe('completeCloudLink', () => {
  it('refuses a grant minted for a different account, before sending anything', async () => {
    const fetchSpy = vi.fn();
    await expect(
      completeCloudLink({
        grant: 'abc.def',
        account: 'aa'.repeat(32),
        login: 'owner@example.com',
        verifier: 'cd'.repeat(32),
        root: '07'.repeat(32),
        fetch: fetchSpy as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/minted for a different account/);

    // The point of checking locally: the cloud would 403 this, but the message
    // would not say which two accounts disagreed.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
