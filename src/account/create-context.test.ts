// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RelayClient,
} from '../relay/index.js';
import { createDelegatedContext } from './create-context.js';

const ACCOUNT = 'aa'.repeat(32);
const NS = 'ab'.repeat(32);
const APP = 'ap'.repeat(32);
const CTX = 'cd'.repeat(32);
const session = { account: ACCOUNT, credential: 'cc', deviceSecret: '11'.repeat(32), relayUrl: 'https://relay.example' } as never;

let created: any;

beforeEach(() => {
  localStorage.clear();
  created = vi
    .spyOn(RelayClient.prototype, 'createContext')
    .mockResolvedValue({ contextId: CTX, groupId: NS, memberPublicKey: 'ee'.repeat(32) } as never);
});
afterEach(() => vi.restoreAllMocks());

describe('createDelegatedContext', () => {
  // A multi-service bundle (mero-docs: `registry` and `docs`) has one `init`
  // per service. The creation warrant names the service, so the relay runs the
  // right one; dropped, the bundle's default service was created instead and
  // its `init` refused the registry's arguments (a 500 from the relay).
  it('names the bundle service the context is for in the relay call', async () => {
    await expect(
      createDelegatedContext(session, { namespaceId: NS, applicationId: APP, serviceName: 'registry', name: 'Registry', initializationParams: [] }),
    ).resolves.toEqual({ contextId: CTX });
    expect(created).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: NS, applicationId: APP, serviceName: 'registry', name: 'Registry', initArgs: {} }),
    );
  });

  it('forwards the seed the caller derives the context id from', async () => {
    const seed = 'ff'.repeat(32);
    await createDelegatedContext(session, { namespaceId: NS, applicationId: APP, contextSeed: seed });
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ seed }));
  });

  it('leaves the service and seed absent (not null) when the caller names none', async () => {
    await createDelegatedContext(session, { namespaceId: NS, applicationId: APP });
    const input = created.mock.calls[0][0] as Record<string, unknown>;
    expect(input.serviceName).toBeUndefined();
    expect(input.seed).toBeUndefined();
    expect(input).toMatchObject({ groupId: NS, applicationId: APP, initArgs: {} });
  });
});
