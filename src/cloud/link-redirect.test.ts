/**
 * The redirect half of account linking.
 *
 * Every check here is about a way the flow can go wrong *silently* — a grant
 * replayed on reload, a grant spent for the wrong account, a refusal treated as
 * a pending state. The happy path is one line and is the least of it.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  cloudLinkUrl,
  readCloudLinkCallback,
  completeCloudLink,
} from './link-redirect.js';

const ACCOUNT = '1f'.repeat(32);

describe('cloudLinkUrl', () => {
  it('names the account and where to come back to', () => {
    const url = new URL(
      cloudLinkUrl({ accountId: ACCOUNT, returnTo: 'https://app.example/back' }),
    );
    expect(url.origin).toBe('https://cloud.calimero.network');
    expect(url.searchParams.get('link-account')).toBe(ACCOUNT);
    expect(url.searchParams.get('callback-url')).toBe('https://app.example/back');
  });

  it('refuses an account id the cloud would reject anyway', () => {
    // The consent page validates /^[0-9a-f]{64}$/ and renders nothing
    // otherwise, so an uppercase id would strand the person on a blank screen.
    expect(() =>
      cloudLinkUrl({ accountId: ACCOUNT.toUpperCase(), returnTo: 'https://app.example' }),
    ).toThrow(/64 lowercase hex/);
  });
});

describe('readCloudLinkCallback', () => {
  it('is null on an ordinary page load', () => {
    expect(readCloudLinkCallback({ hash: '' })).toBeNull();
  });

  it('reads the grant the cloud handed back', () => {
    const got = readCloudLinkCallback({ hash: `#grant=abc.def&account=${ACCOUNT}` });
    expect(got).toEqual({ grant: 'abc.def', account: ACCOUNT });
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
        root: '07'.repeat(32),
        fetch: fetchSpy as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/minted for a different account/);

    // The point of checking locally: the cloud would 403 this, but the message
    // would not say which two accounts disagreed.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
