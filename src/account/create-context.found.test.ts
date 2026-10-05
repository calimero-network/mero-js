// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccountLinkedToSeveralUsersError,
  AccountNotLinkedError,
  CloudClient,
  HaRequestPendingError,
  RelayNotDialableError,
  UnknownRelayError,
} from '../cloud/index.js';
import {
  HTTPError,
} from '../http-client/index.js';
import {
  RelayClient,
} from '../relay/index.js';
import { foundDelegatedNamespace, HA_ACCOUNT_NOT_LINKED_MESSAGE, HA_REFUSAL_MESSAGES } from './create-context.js';
import { rememberRelay } from './session.js';

const ACCOUNT = 'aa'.repeat(32);
const EXECUTOR = '6a'.repeat(32);
const RELAY = 'https://relay.example';
const session = (extra: Record<string, unknown> = {}) =>
  ({ account: ACCOUNT, credential: 'cc', deviceSecret: '11'.repeat(32), relayUrl: RELAY, ...extra }) as never;

let found: any;
let describe_: any;
let enableHa: any;

beforeEach(() => {
  localStorage.clear();
  found = vi
    .spyOn(RelayClient.prototype, 'foundNamespace')
    .mockResolvedValue({ namespaceId: 'ab'.repeat(32), salt: 'cd'.repeat(32), teeEnabled: true } as never);
  describe_ = vi
    .spyOn(RelayClient.prototype, 'describeGovernance')
    .mockResolvedValue({ executorAccount: 'de'.repeat(32) } as never);
  // Never the real cloud: every test that founds reaches the HA call.
  enableHa = vi.spyOn(CloudClient.prototype, 'enableHaAsAccount').mockResolvedValue({ status: 'enabled' });
});
afterEach(() => vi.restoreAllMocks());

describe('foundDelegatedNamespace', () => {
  // A brand-new account is in nothing, so no namespace can tell it the relay's
  // account. When the app knows it (the cloud's machine page names it), the
  // account founds with it directly: the documented mero-js path, no join first.
  it('founds with the executor account the session names, without joining anything first', async () => {
    await expect(foundDelegatedNamespace(session({ executorAccount: EXECUTOR }))).resolves.toEqual({
      namespaceId: 'ab'.repeat(32),
      teeEnabled: true,
      haEnabled: true,
    });
    expect(found).toHaveBeenCalledWith(expect.objectContaining({ executorAccount: EXECUTOR }));
    expect(describe_).not.toHaveBeenCalled();
  });

  it('still learns the account from a namespace it is in, when the session names none', async () => {
    rememberRelay(ACCOUNT, RELAY, { namespaceId: 'ee'.repeat(32) });
    await foundDelegatedNamespace(session());
    expect(describe_).toHaveBeenCalledWith('ee'.repeat(32));
    expect(found).toHaveBeenCalledWith(expect.objectContaining({ executorAccount: 'de'.repeat(32) }));
  });

  it('tells a brand-new account with no known executor how to get one', async () => {
    await expect(foundDelegatedNamespace(session())).rejects.toThrow(/executor account/);
    expect(found).not.toHaveBeenCalled();
    expect(enableHa).not.toHaveBeenCalled();
  });

  it('remembers the founded namespace on the relay', async () => {
    await foundDelegatedNamespace(session({ executorAccount: EXECUTOR }));
    const map = JSON.parse(localStorage.getItem(`calimero.delegated.relays.${ACCOUNT}`) ?? '{}');
    expect(map.namespaces['ab'.repeat(32)]).toBe(RELAY);
  });

  describe('enabling HA right after founding', () => {
    const SALT = 'cd'.repeat(32);

    it('asks the cloud as the founding account, with the founded id and salt', async () => {
      await foundDelegatedNamespace(session({ executorAccount: EXECUTOR }));
      expect(enableHa).toHaveBeenCalledTimes(1);
      expect(enableHa).toHaveBeenCalledWith({
        namespaceId: 'ab'.repeat(32),
        salt: SALT,
        accountId: ACCOUNT,
        credential: 'cc',
        deviceSecret: '11'.repeat(32),
        relayUrl: RELAY,
      });
    });

    // The relay is the fleet node's only admitter: founding attests it as the
    // namespace's first TEE and sets the admission policy. When that did not
    // happen, no fleet node can ever be admitted, and asking for HA would only
    // hold the account's one pending slot forever.
    it('is not asked for when the relay did not attest the founding', async () => {
      found.mockResolvedValue({ namespaceId: 'ab'.repeat(32), salt: SALT, teeEnabled: false, teeError: 'no quote' });
      const out = await foundDelegatedNamespace(session({ executorAccount: EXECUTOR }));
      expect(enableHa).not.toHaveBeenCalled();
      expect(out).toMatchObject({ namespaceId: 'ab'.repeat(32), teeEnabled: false, haEnabled: false });
      expect(out.haError).toMatch(/did not attest/);
      expect(out.haError).toMatch(/no quote/);
    });

    it("posts to the provider's cloud, anonymously", async () => {
      enableHa.mockRestore();
      const calls: string[] = [];
      const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(`${init?.method} ${String(input)}`);
        expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }) as unknown as typeof globalThis.fetch;
      const out = await foundDelegatedNamespace(session({ executorAccount: EXECUTOR }), {}, {
        fetch,
        cloudBaseUrl: 'https://cloud.local',
      });
      expect(out.haEnabled).toBe(true);
      expect(calls).toEqual([
        `POST https://cloud.local/api/cloud/accounts/${ACCOUNT}/namespaces/${'ab'.repeat(32)}/enable-ha`,
      ]);
    });

    it('still founds when the cloud refuses, and says why', async () => {
      enableHa.mockRejectedValue(new Error('HTTP 402: quota exceeded'));
      await expect(foundDelegatedNamespace(session({ executorAccount: EXECUTOR }))).resolves.toEqual({
        namespaceId: 'ab'.repeat(32),
        teeEnabled: true,
        haEnabled: false,
        haError: 'HTTP 402: quota exceeded',
      });
      const map = JSON.parse(localStorage.getItem(`calimero.delegated.relays.${ACCOUNT}`) ?? '{}');
      expect(map.namespaces['ab'.repeat(32)]).toBe(RELAY);
    });

    it('tells an unlinked account to link it in the wallet', async () => {
      enableHa.mockRejectedValue(
        new AccountNotLinkedError('account_not_linked', 409, 'Conflict', 'https://cloud', new Headers(), '{"error":"account_not_linked"}'),
      );
      const out = await foundDelegatedNamespace(session({ executorAccount: EXECUTOR }));
      expect(out.haEnabled).toBe(false);
      expect(out.haError).toBe(HA_ACCOUNT_NOT_LINKED_MESSAGE);
      expect(out.haError).toBe('link this account to your cloud user in the wallet so invitees can find this namespace');
    });

    // Each refusal the cloud names gets a sentence saying what to do, never a
    // bare "HTTP 409".
    it.each([
      [HaRequestPendingError, 409, 'ha_request_pending'],
      [AccountLinkedToSeveralUsersError, 409, 'account_linked_to_several_users'],
      [UnknownRelayError, 422, 'unknown_relay'],
      [RelayNotDialableError, 422, 'relay_not_dialable'],
    ] as const)('names the %s refusal in words', async (Typed, status, code) => {
      enableHa.mockRejectedValue(new Typed(code, status, 'x', 'https://cloud', new Headers(), JSON.stringify({ detail: { error: code } })));
      const out = await foundDelegatedNamespace(session({ executorAccount: EXECUTOR }));
      expect(out.haEnabled).toBe(false);
      expect(out.haError).toBe(HA_REFUSAL_MESSAGES[code]);
      expect(out.haError).not.toMatch(/HTTP \d{3}/);
    });

    it('says which namespace is pending when the cloud names it', async () => {
      const blocking = 'ef'.repeat(32);
      enableHa.mockRejectedValue(
        new HaRequestPendingError('ha_request_pending', 409, 'Conflict', 'https://cloud', new Headers(),
          JSON.stringify({ detail: { error: 'ha_request_pending', namespace_id: blocking } })),
      );
      const out = await foundDelegatedNamespace(session({ executorAccount: EXECUTOR }));
      expect(out.haError).toContain(blocking);
    });

    it('reports a non-Error rejection and a plain HTTPError without throwing', async () => {
      enableHa.mockRejectedValueOnce(new HTTPError(403, 'Forbidden', 'u', new Headers(), '{"detail":"Ownership proof failed: x"}'));
      expect((await foundDelegatedNamespace(session({ executorAccount: EXECUTOR }))).haError).toMatch(/Ownership proof failed/);
      enableHa.mockRejectedValueOnce('offline');
      expect((await foundDelegatedNamespace(session({ executorAccount: EXECUTOR }))).haError).toBe('offline');
    });

    it('is not attempted when founding fails', async () => {
      found.mockRejectedValue(new Error('relay refused the warrant'));
      await expect(foundDelegatedNamespace(session({ executorAccount: EXECUTOR }))).rejects.toThrow(/refused/);
      expect(enableHa).not.toHaveBeenCalled();
    });
  });
});
