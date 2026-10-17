/**
 * Tokens in a login callback are only adopted for a login this browser began.
 *
 * Anyone can send a link to the app with tokens of their choosing in the fragment;
 * adopting them signs the person in to the sender's node and account.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildAuthLoginUrl, parseAuthCallback } from './index.js';
import { cloudLinkUrl } from '../cloud/link-redirect.js';
import { MeroJs } from '../mero-js.js';

const NODE = 'https://node.example';
const TOKENS = 'access_token=a&refresh_token=r&node_url=https%3A%2F%2Fnode.example';
const ATTACKER = 'access_token=att&refresh_token=att&node_url=https%3A%2F%2Fevil.example';

function fakeStorage(): void {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
}

/** What the node's login page sends the person back to: our callback URL plus the tokens. */
function callbackFor(loginUrl: string, fragment = TOKENS): string {
  const back = new URL(new URL(loginUrl).searchParams.get('callback-url')!);
  back.hash = fragment;
  return back.toString();
}

function beginLogin(callbackUrl = 'https://app.example/cb'): string {
  return buildAuthLoginUrl(NODE, { callbackUrl, mode: 'admin' });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  fakeStorage();
});

describe('parseAuthCallback', () => {
  it('refuses tokens when this browser began no login', () => {
    expect(parseAuthCallback(`https://app.example/cb#${ATTACKER}`)).toBeNull();
  });

  it('refuses tokens carrying a state this browser did not begin', () => {
    beginLogin();
    expect(parseAuthCallback(`https://app.example/cb?auth_state=guessed#${ATTACKER}`)).toBeNull();
  });

  it('adopts the tokens of the login this browser began, and keeps the callback query', () => {
    const back = callbackFor(beginLogin('https://app.example/cb?tab=files'));
    expect(new URL(back).searchParams.get('tab')).toBe('files');
    expect(parseAuthCallback(back)).toMatchObject({
      accessToken: 'a',
      refreshToken: 'r',
      nodeUrl: NODE,
    });
  });

  it('adopts a callback once', () => {
    const back = callbackFor(beginLogin());
    expect(parseAuthCallback(back)).not.toBeNull();
    expect(parseAuthCallback(back)).toBeNull();
  });

  it('refuses a callback for a login begun too long ago', () => {
    vi.useFakeTimers();
    const back = callbackFor(beginLogin());
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    expect(parseAuthCallback(back)).toBeNull();
  });

  it('does not accept the state of an account link as a login', async () => {
    const consent = await cloudLinkUrl({ accountId: '1f'.repeat(32), returnTo: 'https://app.example/cb' });
    const linkState = new URL(new URL(consent).searchParams.get('callback-url')!).searchParams.get(
      'link_state',
    );
    expect(parseAuthCallback(`https://app.example/cb?auth_state=${linkState}#${TOKENS}`)).toBeNull();
  });

  it('refuses when there is no storage to remember the login in', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(parseAuthCallback(callbackFor(beginLogin()))).toBeNull();
  });

  it('accepts unsolicited tokens only when the caller opts in for a host that injects them', () => {
    const desktop = `https://app.example/#${TOKENS}`;
    expect(MeroJs.parseAuthCallback(desktop)).toBeNull();
    expect(MeroJs.parseAuthCallback(desktop, { allowUnsolicited: true })).toMatchObject({
      accessToken: 'a',
      nodeUrl: NODE,
    });
  });
});
