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
import { pinRelayNodeKey, rememberRelay } from './session.js';

const ACCOUNT = 'aa'.repeat(32);
const EXECUTOR = '6a'.repeat(32);
/** The relay's node key: the key it signs with, so the warrant's `executor_key`. */
const RELAY_KEY = '7b'.repeat(32);

/**
 * The relay's attestation, as founding asks for it: every founding attests the
 * relay now, whatever is pinned. Answers `RELAY_KEY` unless a test says the
 * quote is refused.
 */
const attested = vi.hoisted(() => ({ calls: 0, refuse: false, real: false }));
vi.mock('../relay-attestation/index.js', async (importActual) => {
  const actual = await importActual<typeof import('../relay-attestation/index.js')>();
  return {
    ...actual,
    attestRelayNodeKey: async (...args: Parameters<typeof actual.attestRelayNodeKey>) => {
      attested.calls += 1;
      if (attested.real) return actual.attestRelayNodeKey(...args);
      if (attested.refuse) throw new Error('RTMR3 is not of a signed locked-read-only release');
      return { nodeKey: '7b'.repeat(32) };
    },
  };
});
const RELAY = 'https://relay.example';
const session = (extra: Record<string, unknown> = {}) =>
  ({ account: ACCOUNT, credential: 'cc', deviceSecret: '11'.repeat(32), relayUrl: RELAY, ...extra }) as never;

let found: any;
let describe_: any;
let enableHa: any;

beforeEach(() => {
  localStorage.clear();
  attested.calls = 0;
  attested.refuse = false;
  attested.real = false;
  pinRelayNodeKey(RELAY, RELAY_KEY);
  found = vi
    .spyOn(RelayClient.prototype, 'foundNamespace')
    .mockResolvedValue({ namespaceId: 'ab'.repeat(32), salt: 'cd'.repeat(32), teeEnabled: true } as never);
  describe_ = vi
    .spyOn(RelayClient.prototype, 'describeGovernance')
    .mockResolvedValue({ executorAccount: 'de'.repeat(32), executorKey: RELAY_KEY } as never);
  // Never the real cloud: every test that founds reaches the HA call.
  enableHa = vi.spyOn(CloudClient.prototype, 'enableHaAsAccount').mockResolvedValue({ status: 'enabled' });
});
afterEach(() => vi.restoreAllMocks());

describe('foundDelegatedNamespace', () => {
  // The relay founded through becomes the namespace's first TEE and holds its
  // keys. A key pinned on an earlier day proves nothing about what answers
  // today, so founding attests the relay again, pin or no pin.
  it('attests the relay at founding even with its key pinned', async () => {
    await foundDelegatedNamespace(session({ executorAccount: EXECUTOR }));
    expect(attested.calls).toBe(1);
  });

  it('refuses to found through a relay whose attestation is refused, though its key is pinned', async () => {
    attested.refuse = true;
    await expect(foundDelegatedNamespace(session({ executorAccount: EXECUTOR }))).rejects.toThrow(
      /attestation was refused/,
    );
    expect(found).not.toHaveBeenCalled();
  });

  // A brand-new account is in nothing, so no namespace can tell it the relay's
  // account. When the app knows it (the cloud's machine page names it), the
  // account founds with it directly: the documented mero-js path, no join first.
  it("founds with the session's executor account and the relay's node key, without joining anything first", async () => {
    await expect(foundDelegatedNamespace(session({ executorAccount: EXECUTOR }))).resolves.toEqual({
      namespaceId: 'ab'.repeat(32),
      teeEnabled: true,
      haEnabled: true,
    });
    expect(found).toHaveBeenCalledWith(
      expect.objectContaining({ executor: { executorAccount: EXECUTOR, executorKey: RELAY_KEY } }),
    );
    expect(describe_).not.toHaveBeenCalled();
  });

  it('learns the account from a namespace it is in, when the session names none', async () => {
    rememberRelay(ACCOUNT, RELAY, { namespaceId: 'ee'.repeat(32) });
    await foundDelegatedNamespace(session());
    expect(describe_).toHaveBeenCalledWith('ee'.repeat(32));
    expect(found).toHaveBeenCalledWith(
      expect.objectContaining({ executor: { executorAccount: 'de'.repeat(32), executorKey: RELAY_KEY } }),
    );
  });

  // Discovery is unauthenticated, so it may name the account but never the key.
  it("refuses a namespace's discovery that names another key than the relay's node key", async () => {
    describe_.mockResolvedValue({ executorAccount: 'de'.repeat(32), executorKey: 'df'.repeat(32) });
    rememberRelay(ACCOUNT, RELAY, { namespaceId: 'ee'.repeat(32) });
    await expect(foundDelegatedNamespace(session())).rejects.toThrow(
      /names signing key (df)+, not the relay's node key/,
    );
    expect(found).not.toHaveBeenCalled();
  });

  // The relay map can name a namespace the relay has since left, whose
  // discovery would 404, so it is not asked while the session suffices.
  it("prefers the session's executor to a namespace it remembers", async () => {
    rememberRelay(ACCOUNT, RELAY, { namespaceId: 'ee'.repeat(32) });
    await foundDelegatedNamespace(session({ executorAccount: EXECUTOR }));
    expect(describe_).not.toHaveBeenCalled();
    expect(found).toHaveBeenCalledWith(
      expect.objectContaining({ executor: { executorAccount: EXECUTOR, executorKey: RELAY_KEY } }),
    );
  });

  describe("when the relay's key cannot be learned", () => {
    beforeEach(() => {
      localStorage.clear();
      // The real attestation, over the network these tests take down.
      attested.real = true;
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    // A namespace's discovery is no substitute for the attestation that failed.
    it.each([
      ['did not answer', () => vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'))],
      ['was refused', () => vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))],
    ])('does not fall back to a namespace it is in when the attestation %s', async (_why, attest) => {
      attest();
      rememberRelay(ACCOUNT, RELAY, { namespaceId: 'ee'.repeat(32) });
      for (const s of [session({ executorAccount: EXECUTOR }), session()]) {
        await expect(foundDelegatedNamespace(s)).rejects.toThrow(/attestation/);
      }
      expect(describe_).not.toHaveBeenCalled();
      expect(found).not.toHaveBeenCalled();
    });

    it('says to try again when the attestation did not answer', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
      await expect(foundDelegatedNamespace(session({ executorAccount: EXECUTOR }))).rejects.toThrow(
        /could not be learned: its attestation did not answer, try again/,
      );
      expect(found).not.toHaveBeenCalled();
    });

    it('says founding is not possible when the attestation was refused', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
      await expect(foundDelegatedNamespace(session({ executorAccount: EXECUTOR }))).rejects.toThrow(
        /attestation was refused, so founding through it is not possible/,
      );
      expect(found).not.toHaveBeenCalled();
    });
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
