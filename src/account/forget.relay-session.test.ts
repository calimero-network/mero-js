// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../login/index.js', () => ({
  login: vi.fn(async () => ({ accessToken: 'relay-session-token' })),
}));

import { forgetAccount } from './forget.js';
import { buildDelegatedClient, pinRelayNodeKey } from './session.js';
import { signerFromSecret } from '../signer/signer.js';

const RELAY = 'http://127.0.0.1:4480';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('forgetAccount and a relay client already built', () => {
  it('stops presenting the relay session token once the account is forgotten', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ data: { contexts: [] } }), { headers: { 'Content-Type': 'application/json' } }),
    );
    pinRelayNodeKey(RELAY, 'ef'.repeat(32));
    const client = buildDelegatedClient(
      { account: 'aa'.repeat(32), credential: 'cc', signer: await signerFromSecret('11'.repeat(32)), relayUrl: RELAY },
      null,
    )!;
    const bearer = () => new Request(...(fetchSpy.mock.calls.at(-1) as [RequestInfo, RequestInit?])).headers.get('authorization');

    await client.admin.getContexts().catch(() => {});
    expect(bearer()).toBe('Bearer relay-session-token');

    await forgetAccount('aa'.repeat(32));
    await client.admin.getContexts().catch(() => {});
    expect(bearer()).toBeNull();
  });
});
