/**
 * A link grant is only spent for a link this tab began.
 *
 * Whoever consents at the cloud can forward the redirect URL to someone else, so
 * a callback that arrives without the state this tab minted is somebody else's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudClient } from './cloud-client.js';
import { cloudLinkUrl, readCloudLinkCallback } from './link-redirect.js';

const ACCOUNT = '1f'.repeat(32);
const OTHER = '2e'.repeat(32);
const RETURN_TO = 'https://app.example/connected';

function fakeSessionStorage(): void {
  const map = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
}

/** What the cloud sends the person back to: our callback URL plus the fragment. */
function callbackFor(consentUrl: string, account: string): URL {
  const back = new URL(new URL(consentUrl).searchParams.get('callback-url')!);
  back.hash = `grant=attacker-grant&account=${account}`;
  return back;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  fakeSessionStorage();
});

describe('readCloudLinkCallback', () => {
  it('refuses a grant when this tab began no link', () => {
    expect(() =>
      readCloudLinkCallback({ hash: `#grant=attacker-grant&account=${ACCOUNT}`, search: '' }),
    ).toThrow(/did not make/);
  });

  it('refuses a grant that carries the wrong state', () => {
    cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO });
    expect(() =>
      readCloudLinkCallback({
        hash: `#grant=attacker-grant&account=${ACCOUNT}`,
        search: '?link_state=guessed',
      }),
    ).toThrow(/did not make/);
  });

  it('refuses a grant sealed for a different account than the one this tab began for', () => {
    const back = callbackFor(cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }), OTHER);
    expect(() => readCloudLinkCallback({ hash: back.hash, search: back.search })).toThrow(
      /did not make/,
    );
  });

  it('accepts the callback of the link this tab began, once', () => {
    const back = callbackFor(cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }), ACCOUNT);
    expect(readCloudLinkCallback({ hash: back.hash, search: back.search })).toEqual({
      grant: 'attacker-grant',
      account: ACCOUNT,
    });
    expect(() => readCloudLinkCallback({ hash: back.hash, search: back.search })).toThrow(
      /did not make/,
    );
  });

  it('keeps the pending link when a foreign grant is refused', () => {
    const back = callbackFor(cloudLinkUrl({ accountId: ACCOUNT, returnTo: RETURN_TO }), ACCOUNT);
    expect(() =>
      readCloudLinkCallback({ hash: `#grant=x&account=${ACCOUNT}`, search: '' }),
    ).toThrow(/did not make/);
    expect(readCloudLinkCallback({ hash: back.hash, search: back.search })?.grant).toBe(
      'attacker-grant',
    );
  });
});

describe('CloudClient.readAccountLinkCallback', () => {
  it('reports a grant this tab never asked for as an error, not a grant', () => {
    const out = CloudClient.readAccountLinkCallback(
      `${RETURN_TO}#grant=attacker-grant&account=${ACCOUNT}`,
    );
    expect(out.grant).toBeUndefined();
    expect(out.error).toBe('unexpected_callback');
  });

  it('accepts the callback of a handoff this tab began', () => {
    const { url } = CloudClient.accountLinkHandoff({
      portalUrl: 'https://cloud.calimero.network',
      accountId: ACCOUNT,
      callbackUrl: RETURN_TO,
    });
    const back = callbackFor(url, ACCOUNT);
    expect(CloudClient.readAccountLinkCallback(back.toString())).toEqual({
      grant: 'attacker-grant',
      accountId: ACCOUNT,
    });
  });

  it('refuses a grant sealed for a different account than the handoff named', () => {
    const { url } = CloudClient.accountLinkHandoff({
      portalUrl: 'https://cloud.calimero.network',
      accountId: ACCOUNT,
      callbackUrl: RETURN_TO,
    });
    const out = CloudClient.readAccountLinkCallback(callbackFor(url, OTHER).toString());
    expect(out.grant).toBeUndefined();
    expect(out.error).toBe('unexpected_callback');
  });
});
