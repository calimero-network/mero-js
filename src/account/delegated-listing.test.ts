// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { answers, createMeroClient } = vi.hoisted(() => {
  // Per relay: what `getContexts` / `listNamespaces` do there.
  const answers = new Map<string, { contexts?: () => Promise<unknown>; namespaces?: () => Promise<unknown> }>();
  const createMeroClient = vi.fn((config: { relay: { relayUrl: string } }) => {
    const at = () => answers.get(config.relay.relayUrl) ?? {};
    return {
      transport: 'relay',
      rpc: { kind: 'relay', execute: vi.fn(), executeWithMetadata: vi.fn() },
      admin: {
        getContexts: () => at().contexts!(),
        listNamespaces: () => at().namespaces!(),
      },
      close: vi.fn(),
    };
  });
  return { answers, createMeroClient };
});

vi.mock('../transport/index.js', async (importActual) => ({
  ...(await importActual<typeof import('../transport/index.js')>()),
  createMeroClient,
}));

import {
  RelaysUnreachableError,
  listDelegatedContexts,
  listDelegatedNamespaces,
  pinRelayNodeKey,
  rememberRelay,
} from './session.js';

const LIVE = 'https://node-live.relay.cloud.calimero.network';
const GONE = 'https://node-gone.relay.cloud.calimero.network';
const S = { account: 'aa'.repeat(32), credential: 'cc', deviceSecret: '11'.repeat(32), relayUrl: GONE };
// What a browser reports for a hostname that no longer resolves.
const unresolved = () => Promise.reject(new TypeError('Failed to fetch'));

beforeEach(() => {
  localStorage.clear();
  answers.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // Pinned while the relays were alive: no attestation is fetched again.
  pinRelayNodeKey(GONE, 'ab'.repeat(32));
  pinRelayNodeKey(LIVE, 'cd'.repeat(32));
});

describe('listing an account across its relays', () => {
  it('skips a relay that is down while another answers', async () => {
    rememberRelay(S.account, LIVE, { namespaceId: 'ns1' });
    answers.set(GONE, { contexts: unresolved, namespaces: unresolved });
    answers.set(LIVE, {
      contexts: async () => ({ contexts: [{ id: 'ctx1', applicationId: 'app' }] }),
      namespaces: async () => [{ namespaceId: 'ns1' }],
    });

    await expect(listDelegatedContexts(S)).resolves.toEqual([
      { id: 'ctx1', applicationId: 'app', relayUrl: LIVE },
    ]);
    await expect(listDelegatedNamespaces(S)).resolves.toEqual([{ namespaceId: 'ns1', relayUrl: LIVE }]);
  });

  it('says so when every relay is down, rather than reporting an empty account', async () => {
    answers.set(GONE, { contexts: unresolved, namespaces: unresolved });

    await expect(listDelegatedContexts(S)).rejects.toBeInstanceOf(RelaysUnreachableError);
    const err = await listDelegatedNamespaces(S).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RelaysUnreachableError);
    expect((err as RelaysUnreachableError).relays).toEqual([GONE]);
  });

  it('an empty answer is still an empty account', async () => {
    answers.set(GONE, { contexts: async () => ({ contexts: [] }), namespaces: async () => [] });

    await expect(listDelegatedContexts(S)).resolves.toEqual([]);
    await expect(listDelegatedNamespaces(S)).resolves.toEqual([]);
  });

  it('an account that knows no relay lists nothing, without an error', async () => {
    await expect(listDelegatedContexts({ ...S, relayUrl: null })).resolves.toEqual([]);
  });
});
