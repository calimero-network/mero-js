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
import { beginDeviceEnrolment, completeDeviceEnrolment } from '../cloud/enrol-redirect.js';
import { accountForRootPublicKey, mintDeviceId, signDeviceCert } from '../device-cert/index.js';

async function enrolledDevice() {
  const begun = await beginDeviceEnrolment();
  const root = await signerFromSecret('11'.repeat(32));
  const account = await accountForRootPublicKey(root.publicKey);
  const device = await mintDeviceId(account, new Uint8Array(16).fill(1));
  const credential = await signDeviceCert({ signer: root, device, signPublicKey: begun.devicePublicKey, kemPublicKey: begun.kemPublicKey, deviceEpoch: 1 });
  return completeDeviceEnrolment({ credential, account, device, state: begun.state });
}

/** What another tab's forgetAccount leaves behind here: an empty store, and no local sign-out. */
function clearStoreFromAnotherTab(): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('calimero');
    open.onsuccess = () => {
      const tx = open.result.transaction('device', 'readwrite');
      tx.objectStore('device').clear();
      tx.oncomplete = () => (open.result.close(), resolve());
      tx.onerror = () => reject(tx.error);
    };
  });
}

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

  it("stops presenting the token once another tab has signed this device out", async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ data: { contexts: [] } }), { headers: { 'Content-Type': 'application/json' } }),
    );
    pinRelayNodeKey(RELAY, 'ef'.repeat(32));
    const device = await enrolledDevice();
    const client = buildDelegatedClient({ ...device, relayUrl: RELAY }, null)!;
    const bearer = () => new Request(...(fetchSpy.mock.calls.at(-1) as [RequestInfo, RequestInit?])).headers.get('authorization');

    await client.admin.getContexts().catch(() => {});
    expect(bearer()).toBe('Bearer relay-session-token');

    await clearStoreFromAnotherTab();
    await client.admin.getContexts().catch(() => {});
    expect(bearer()).toBeNull();
  });
});
