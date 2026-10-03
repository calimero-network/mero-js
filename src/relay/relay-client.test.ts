import { describe, it, expect, vi } from 'vitest';
import { RelayClient, IntentRefusedError } from './relay-client.js';
import { createMemoryNonceSource } from './nonce-source.js';
import { HTTPError } from '../http-client/web-client.js';
import { parseWarrant } from '../warrant/warrant.js';
import { creationInitHash, parseCreationWarrant } from '../warrant/creation-warrant.js';
import { governanceOpHash, parseGovernanceWarrant } from '../warrant/governance-warrant.js';
import {
  defaultCapabilitiesSetOp,
  targetApplicationSetOp,
  foundedNamespaceId,
  groupCreatedOp,
  memberAddedOp,
  namespaceCreatedOp,
} from '../warrant/governance-op.js';
import { signerFromCryptoKey, signerFromSecret } from '../signer/signer.js';

const CONTEXT = '01'.repeat(32);
const AUTHOR = '0e'.repeat(32);
const EXECUTOR = '4d'.repeat(32);
const GROUP = 'ab'.repeat(32);
/** Any 32-byte seed; the signature is not what these tests are about. */
const DEVICE_SECRET = '77'.repeat(32);

/** A `fetch` that answers a scripted queue and records what it was asked. */
function scriptedFetch(
  responses: Array<{ status?: number; body?: unknown; text?: string }>,
): { fetch: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const queue = [...responses];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = queue.shift();
    if (!next) throw new Error('unexpected extra fetch');
    const status = next.status ?? 200;
    const text = next.text ?? JSON.stringify(next.body ?? {});
    return new Response(text, {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

function client(fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) {
  return new RelayClient({
    relayUrl: 'https://relay.example/',
    authorAccount: AUTHOR,
    authorProof: 'aa',
    deviceSecret: DEVICE_SECRET,
    nonces: createMemoryNonceSource(1),
    fetch: fetchImpl,
    ...overrides,
  });
}

describe('RelayClient.describe', () => {
  it('reads the executor account and the grant from the intents route', async () => {
    const { fetch, calls } = scriptedFetch([
      { body: { data: { executorAccount: EXECUTOR, canAuthorOnBehalf: true, groupId: GROUP } } },
    ]);

    const described = await client(fetch).describe(CONTEXT);

    expect(described).toEqual({
      executorAccount: EXECUTOR,
      canAuthorOnBehalf: true,
      groupId: GROUP,
    });
    expect(calls[0].url).toBe(`https://relay.example/admin-api/contexts/${CONTEXT}/intents`);
    expect(calls[0].init?.method).toBe('GET');
  });

  /**
   * `canAuthorOnBehalf: false` is the default state of every context — the
   * capability is implied by nothing — so it has to come back as an answer
   * rather than an error. A client reads it to say "ask an admin of this group"
   * instead of presenting a warrant it has already burned a nonce on.
   */
  it('reports a missing grant as an answer, not a failure', async () => {
    const { fetch } = scriptedFetch([
      { body: { data: { executorAccount: EXECUTOR, canAuthorOnBehalf: false, groupId: GROUP } } },
    ]);
    await expect(client(fetch).describe(CONTEXT)).resolves.toMatchObject({
      canAuthorOnBehalf: false,
      groupId: GROUP,
    });
  });
});

describe('RelayClient.execute', () => {
  it('mints a warrant naming the configured executor and posts it with the intent', async () => {
    const { fetch, calls } = scriptedFetch([
      { body: { data: { rootHash: 'root-1', returns: 'ok' } } },
    ]);

    const result = await client(fetch, { executorAccount: EXECUTOR }).execute<string>(
      CONTEXT,
      'set',
      { key: 'k', value: 'v' },
    );

    expect(result).toEqual({ rootHash: 'root-1', returns: 'ok' });
    expect(calls).toHaveLength(1);
    expect(calls[0].init?.method).toBe('POST');

    const sent = JSON.parse(String(calls[0].init?.body)) as Record<string, string>;
    expect(sent.method).toBe('set');
    expect(sent.authorProof).toBe('aa');
    // The encoding IS the canonical form — the signature covers exactly these
    // bytes — so the shape is worth pinning here. It is no longer a constant
    // length: warrant v2 carries the method as a string and two cited-head
    // lists as vectors, so `parseWarrant` reads it rather than a fixed offset,
    // which would find a neighbouring field instead of failing.
    expect(sent.warrant).toMatch(/^[0-9a-f]+$/);
    expect(parseWarrant(sent.warrant).executor).toBe(EXECUTOR);
  });

  /**
   * A client that was handed the relay's URL but not its account must not have
   * to make the discovery call itself — and must not guess. One `describe`,
   * then the write.
   */
  it('discovers the executor account when none was configured', async () => {
    const { fetch, calls } = scriptedFetch([
      { body: { data: { executorAccount: EXECUTOR, canAuthorOnBehalf: true, groupId: GROUP } } },
      { body: { data: { rootHash: 'root-2', returns: null } } },
    ]);

    await client(fetch).execute(CONTEXT, 'set', {});

    expect(calls.map((c) => c.init?.method)).toEqual(['GET', 'POST']);
    const sent = JSON.parse(String(calls[1].init?.body)) as Record<string, string>;
    expect(parseWarrant(sent.warrant).executor).toBe(EXECUTOR);
  });

  it('does not re-discover once the account is known', async () => {
    const { fetch, calls } = scriptedFetch([
      { body: { data: { executorAccount: EXECUTOR, canAuthorOnBehalf: true, groupId: GROUP } } },
      { body: { data: { rootHash: 'r1', returns: null } } },
      { body: { data: { rootHash: 'r2', returns: null } } },
    ]);

    const relay = client(fetch);
    await relay.execute(CONTEXT, 'set', {});
    await relay.execute(CONTEXT, 'set', {});

    expect(calls.map((c) => c.init?.method)).toEqual(['GET', 'POST', 'POST']);
  });

  /**
   * A warrant authorizes one intent, once, and the nonce is spent by the
   * network on apply. Two writes reusing a number would have the second refused
   * as a replay — which is why the source is consulted per call and not per
   * client.
   */
  it('spends a fresh nonce per intent', async () => {
    const { fetch, calls } = scriptedFetch([
      { body: { data: { rootHash: 'r1', returns: null } } },
      { body: { data: { rootHash: 'r2', returns: null } } },
    ]);

    const relay = client(fetch, { executorAccount: EXECUTOR });
    await relay.execute(CONTEXT, 'set', {});
    await relay.execute(CONTEXT, 'set', {});

    // Nonce is a u64 little-endian, read by name rather than by offset.
    const nonceOf = (call: (typeof calls)[number]) =>
      parseWarrant(
        (JSON.parse(String(call.init?.body)) as { warrant: string }).warrant,
      ).nonce;
    expect(nonceOf(calls[0])).toBe('0100000000000000');
    expect(nonceOf(calls[1])).toBe('0200000000000000');
  });

  it('commits to the arguments, so two different args differ in the warrant', async () => {
    const { fetch, calls } = scriptedFetch([
      { body: { data: { rootHash: 'r1', returns: null } } },
      { body: { data: { rootHash: 'r2', returns: null } } },
    ]);

    const relay = client(fetch, { executorAccount: EXECUTOR });
    await relay.execute(CONTEXT, 'set', { key: 'a' });
    await relay.execute(CONTEXT, 'set', { key: 'b' });

    const intentHashOf = (call: (typeof calls)[number]) =>
      parseWarrant(
        (JSON.parse(String(call.init?.body)) as { warrant: string }).warrant,
      ).intentHash;
    expect(intentHashOf(calls[0])).not.toBe(intentHashOf(calls[1]));
  });

  /**
   * The three refusals a relay can return all arrive as 403 and mean entirely
   * different things. Only a spent nonce is worth retrying, and only under a
   * fresh warrant — so the flag has to distinguish them or a caller retries a
   * missing capability forever.
   */
  it('surfaces a missing grant as a non-retryable refusal', async () => {
    const { fetch } = scriptedFetch([
      {
        status: 403,
        text: JSON.stringify({
          error:
            'this node holds no authorship grant on the group owning this context, so it cannot act for a member here — an admin must grant CAN_AUTHOR_ON_BEHALF to abc',
        }),
      },
    ]);

    const err = await client(fetch, { executorAccount: EXECUTOR })
      .execute(CONTEXT, 'set', {})
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(IntentRefusedError);
    expect((err as IntentRefusedError).reason).toContain('CAN_AUTHOR_ON_BEHALF');
    expect((err as IntentRefusedError).retryable).toBe(false);
    expect((err as IntentRefusedError).status).toBe(403);
  });

  /**
   * Core refuses a relay intent over a ROLE with a 403 before anything runs:
   * the relay is a TEE replica or a read-only member, or the author is
   * read-only. None changes on retry, so none may read as the retryable replay.
   */
  it.each([
    'this node is a TEE replica (ReadOnlyTee) and does not relay writes; the namespace must admit relays with mode=relay',
    "this node's role in this context is read-only (ReadOnly), so it does not relay writes",
    "the author's role in this context is read-only",
  ])('surfaces a role refusal as non-retryable: %s', async (error) => {
    const { fetch } = scriptedFetch([{ status: 403, text: JSON.stringify({ error }) }]);

    const err = await client(fetch, { executorAccount: EXECUTOR })
      .execute(CONTEXT, 'set', {})
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(IntentRefusedError);
    expect((err as IntentRefusedError).status).toBe(403);
    expect((err as IntentRefusedError).retryable).toBe(false);
    expect((err as IntentRefusedError).reason).toBe(error);
  });

  it('surfaces a spent nonce as retryable', async () => {
    const { fetch } = scriptedFetch([
      {
        status: 403,
        text: JSON.stringify({
          error: "this warrant's nonce has already been spent by this author device",
        }),
      },
    ]);

    const err = await client(fetch, { executorAccount: EXECUTOR })
      .execute(CONTEXT, 'set', {})
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(IntentRefusedError);
    expect((err as IntentRefusedError).retryable).toBe(true);
  });

  it('treats a malformed request (400) as a refusal too, never retryable', async () => {
    const { fetch } = scriptedFetch([
      { status: 400, text: JSON.stringify({ error: 'authorProof is not hex' }) },
    ]);

    const err = await client(fetch, { executorAccount: EXECUTOR })
      .execute(CONTEXT, 'set', {})
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(IntentRefusedError);
    expect((err as IntentRefusedError).status).toBe(400);
    expect((err as IntentRefusedError).retryable).toBe(false);
  });

  it('leaves a server fault as an HTTPError, not a refusal', async () => {
    const { fetch } = scriptedFetch([{ status: 500, text: 'boom' }]);

    const err = await client(fetch, { executorAccount: EXECUTOR })
      .execute(CONTEXT, 'set', {})
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HTTPError);
    expect(err).not.toBeInstanceOf(IntentRefusedError);
  });

  it('wraps a transport failure as an HTTPError with status 0', async () => {
    const failing = (async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch;

    const err = await client(failing, { executorAccount: EXECUTOR })
      .execute(CONTEXT, 'set', {})
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HTTPError);
    expect((err as HTTPError).status).toBe(0);
  });

  /**
   * The injected fetch is typically `createAttestedSealedFetch`, which throws
   * a sentence saying why sealing failed. That sentence is the whole report:
   * losing it leaves the caller with a bare "HTTP 0 Error".
   */
  it('keeps the reason when the injected fetch throws', async () => {
    const reason = 'The node refused to attest: HTTP 404';
    const failing = (async () => {
      throw new Error(reason);
    }) as unknown as typeof fetch;
    const relay = client(failing, { executorAccount: EXECUTOR });

    for (const call of [
      () => relay.describe(CONTEXT),
      () => relay.execute(CONTEXT, 'set', {}),
    ]) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HTTPError);
      expect((err as HTTPError).status).toBe(0);
      expect((err as HTTPError).bodyText).toBe(reason);
      expect((err as HTTPError).message).toContain(reason);
    }
  });

  it('binds the warrant to a not-after in the future', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    try {
      const { fetch, calls } = scriptedFetch([
        { body: { data: { rootHash: 'r', returns: null } } },
      ]);
      await client(fetch, { executorAccount: EXECUTOR, ttlSeconds: 60 }).execute(
        CONTEXT,
        'set',
        {},
      );

      const warrant = (JSON.parse(String(calls[0].init?.body)) as { warrant: string }).warrant;
      const notAfterLe = parseWarrant(warrant).notAfter;
      const bytes = notAfterLe.match(/../g) as string[];
      const notAfter = bytes
        .reverse()
        .reduce((acc, byte) => (acc << 8n) + BigInt(parseInt(byte, 16)), 0n);
      expect(notAfter).toBe(BigInt(Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000) + 60));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('RelayClient.describeCreation', () => {
  it('reads the group route, with the author when given', async () => {
    const data = {
      executorAccount: EXECUTOR,
      groupId: GROUP,
      canCreateOnBehalf: true,
      authorMayCreate: true,
    };
    const { fetch, calls } = scriptedFetch([{ body: { data } }, { body: { data } }]);
    const relay = client(fetch);

    await expect(relay.describeCreation(GROUP)).resolves.toEqual(data);
    await relay.describeCreation(GROUP, { author: AUTHOR });

    expect(calls[0].url).toBe(`https://relay.example/admin-api/groups/${GROUP}/context-intents`);
    expect(calls[0].init?.method).toBe('GET');
    expect(calls[1].url).toBe(
      `https://relay.example/admin-api/groups/${GROUP}/context-intents?author=${AUTHOR}`,
    );
  });

  it('leaves an unknown group as a 404 HTTPError', async () => {
    const { fetch } = scriptedFetch([{ status: 404, text: 'group not found' }]);
    const err = await client(fetch).describeCreation(GROUP).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HTTPError);
    expect((err as HTTPError).status).toBe(404);
  });
});

describe('RelayClient.createContext', () => {
  const APPLICATION = '5a'.repeat(32);
  const NEW_CONTEXT = 'c0'.repeat(32);
  const MEMBER_KEY = 'd1'.repeat(32);
  const described = (over: Record<string, unknown> = {}) => ({
    body: {
      data: {
        executorAccount: EXECUTOR,
        groupId: GROUP,
        canCreateOnBehalf: true,
        authorMayCreate: true,
        ...over,
      },
    },
  });
  const created = {
    body: { data: { contextId: NEW_CONTEXT, groupId: GROUP, memberPublicKey: MEMBER_KEY } },
  };

  it('describes, signs and posts a creation warrant', async () => {
    const { fetch, calls } = scriptedFetch([described(), created]);

    const result = await client(fetch).createContext({
      groupId: GROUP,
      applicationId: APPLICATION,
      initArgs: { name: 'general' },
      name: 'general',
    });

    expect(result).toEqual({ contextId: NEW_CONTEXT, groupId: GROUP, memberPublicKey: MEMBER_KEY });
    expect(calls.map((c) => c.init?.method)).toEqual(['GET', 'POST']);
    expect(calls[0].url).toBe(
      `https://relay.example/admin-api/groups/${GROUP}/context-intents?author=${AUTHOR}`,
    );
    expect(calls[1].url).toBe(`https://relay.example/admin-api/groups/${GROUP}/context-intents`);

    const sent = JSON.parse(String(calls[1].init?.body)) as {
      warrant: string;
      authorProof: string;
      initArgs: unknown;
    };
    expect(Object.keys(sent).sort()).toEqual(['authorProof', 'initArgs', 'warrant']);
    expect(sent.authorProof).toBe('aa');
    expect(sent.initArgs).toEqual({ name: 'general' });

    const fields = parseCreationWarrant(sent.warrant);
    expect(fields.group).toBe(GROUP);
    expect(fields.authorAccount).toBe(AUTHOR);
    expect(fields.executor).toBe(EXECUTOR);
    expect(fields.applicationId).toBe(APPLICATION);
    expect(fields.name).toBe('general');
    expect(fields.serviceName).toBeNull();
    expect(fields.nonce).toBe(1n);
    // The warrant commits to exactly the initArgs that were sent.
    expect(fields.initHash).toBe(hexOf(await creationInitHash(sent.initArgs)));
  });

  it('passes the seed through and defaults initArgs to {}', async () => {
    const { fetch, calls } = scriptedFetch([described(), created]);
    const seed = '12'.repeat(32);

    await client(fetch).createContext({ groupId: GROUP, applicationId: APPLICATION, seed });

    const sent = JSON.parse(String(calls[1].init?.body)) as { warrant: string; initArgs: unknown };
    expect(sent.initArgs).toEqual({});
    expect(parseCreationWarrant(sent.warrant).seed).toBe(seed);
  });

  it.each([
    ['the relay has no standing', { canCreateOnBehalf: false }, /no standing to act for members/],
    ['the author may not create', { authorMayCreate: false }, /may not create contexts/],
  ])('refuses before spending a nonce when %s', async (_why, over, message) => {
    const { fetch, calls } = scriptedFetch([described(over), described(), created]);
    const relay = client(fetch);

    const err = await relay
      .createContext({ groupId: GROUP, applicationId: APPLICATION })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(IntentRefusedError);
    expect((err as IntentRefusedError).reason).toMatch(message);
    expect((err as IntentRefusedError).retryable).toBe(false);
    expect(calls).toHaveLength(1);

    // The number the refused call would have used is still the next one.
    await relay.createContext({ groupId: GROUP, applicationId: APPLICATION });
    const sent = JSON.parse(String(calls[2].init?.body)) as { warrant: string };
    expect(parseCreationWarrant(sent.warrant).nonce).toBe(1n);
  });

  it('refuses a configured executor the relay does not answer to', async () => {
    const { fetch, calls } = scriptedFetch([described()]);
    const err = await client(fetch, { executorAccount: 'ee'.repeat(32) })
      .createContext({ groupId: GROUP, applicationId: APPLICATION })
      .catch((e: unknown) => e);

    expect(String(err)).toMatch(/would be unspendable/);
    expect(calls).toHaveLength(1);
  });

  it('surfaces a 403 from the relay with its message', async () => {
    const error = 'the author lacks CAN_CREATE_CONTEXT in this group';
    const { fetch } = scriptedFetch([described(), { status: 403, text: JSON.stringify({ error }) }]);

    const err = await client(fetch)
      .createContext({ groupId: GROUP, applicationId: APPLICATION })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(IntentRefusedError);
    expect((err as IntentRefusedError).status).toBe(403);
    expect((err as IntentRefusedError).reason).toBe(error);
    expect((err as IntentRefusedError).retryable).toBe(false);
  });

  it('leaves an unknown application as a 404 HTTPError', async () => {
    const { fetch } = scriptedFetch([described(), { status: 404, text: 'application not found' }]);
    const err = await client(fetch)
      .createContext({ groupId: GROUP, applicationId: APPLICATION })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HTTPError);
    expect((err as HTTPError).status).toBe(404);
  });
});

describe('RelayClient.describeGovernance', () => {
  it('reads the group governance route', async () => {
    const data = { executorAccount: EXECUTOR, groupId: GROUP, canActOnBehalf: true };
    const { fetch, calls } = scriptedFetch([{ body: { data } }]);

    await expect(client(fetch).describeGovernance(GROUP)).resolves.toEqual(data);
    expect(calls[0].url).toBe(`https://relay.example/admin-api/groups/${GROUP}/governance-intents`);
    expect(calls[0].init?.method).toBe('GET');
  });

  it('leaves an unknown group as a 404 HTTPError', async () => {
    const { fetch } = scriptedFetch([{ status: 404, text: 'this node knows no such group' }]);
    const err = await client(fetch).describeGovernance(GROUP).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HTTPError);
    expect((err as HTTPError).status).toBe(404);
  });
});

describe('RelayClient.govern', () => {
  const MEMBER = '44'.repeat(32);
  const described = (over: Record<string, unknown> = {}) => ({
    body: { data: { executorAccount: EXECUTOR, groupId: GROUP, canActOnBehalf: true, ...over } },
  });
  const governed = (groupId = GROUP) => ({ body: { data: { groupId } } });

  it('describes, signs and posts a warrant over the exact op bytes', async () => {
    const { fetch, calls } = scriptedFetch([described(), governed()]);
    const op = memberAddedOp(MEMBER, 'Member');

    await expect(client(fetch).govern({ groupId: GROUP, op })).resolves.toEqual({ groupId: GROUP });

    expect(calls.map((c) => c.init?.method)).toEqual(['GET', 'POST']);
    expect(calls[1].url).toBe(`https://relay.example/admin-api/groups/${GROUP}/governance-intents`);
    const sent = JSON.parse(String(calls[1].init?.body)) as {
      warrant: string;
      authorProof: string;
      op: string;
    };
    expect(Object.keys(sent).sort()).toEqual(['authorProof', 'op', 'warrant']);
    expect(sent.authorProof).toBe('aa');
    expect(sent.op).toBe(hexOf(op.bytes));

    const fields = parseGovernanceWarrant(sent.warrant);
    expect(fields.scope).toBe(GROUP);
    expect(fields.kind).toBe('group');
    expect(fields.authorAccount).toBe(AUTHOR);
    expect(fields.executor).toBe(EXECUTOR);
    expect(fields.nonce).toBe(1n);
    expect(fields.opHash).toBe(hexOf(await governanceOpHash(op)));
    expect(fields.notAfter).toBeGreaterThan(BigInt(Math.floor(Date.now() / 1000)));
  });

  it('signs a root op on the root plane, and returns the group it acted on', async () => {
    const created = 'c5'.repeat(32);
    const { fetch, calls } = scriptedFetch([described(), governed(created)]);
    const op = groupCreatedOp({
      groupId: created,
      parentId: GROUP,
      restricted: true,
      admin: AUTHOR,
      salt: '00'.repeat(32),
    });

    await expect(client(fetch).govern({ groupId: GROUP, op })).resolves.toEqual({ groupId: created });

    const sent = JSON.parse(String(calls[1].init?.body)) as { warrant: string };
    expect(parseGovernanceWarrant(sent.warrant).kind).toBe('root');
  });

  it('refuses before spending a nonce when the relay has no standing', async () => {
    const { fetch, calls } = scriptedFetch([described({ canActOnBehalf: false }), described(), governed()]);
    const relay = client(fetch);
    const op = memberAddedOp(MEMBER, 'Member');

    const err = await relay.govern({ groupId: GROUP, op }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IntentRefusedError);
    expect((err as IntentRefusedError).reason).toMatch(/no standing to act for members/);
    expect((err as IntentRefusedError).retryable).toBe(false);
    expect(calls).toHaveLength(1);

    await relay.govern({ groupId: GROUP, op });
    const sent = JSON.parse(String(calls[2].init?.body)) as { warrant: string };
    expect(parseGovernanceWarrant(sent.warrant).nonce).toBe(1n);
  });

  it('refuses a configured executor the relay does not answer to', async () => {
    const { fetch, calls } = scriptedFetch([described()]);
    const err = await client(fetch, { executorAccount: 'ee'.repeat(32) })
      .govern({ groupId: GROUP, op: memberAddedOp(MEMBER, 'Member') })
      .catch((e: unknown) => e);
    expect(String(err)).toMatch(/would be unspendable/);
    expect(calls).toHaveLength(1);
  });

  it('surfaces the author lacking the right as a refusal with the relay\'s message', async () => {
    const error = 'the author lacks MANAGE_MEMBERS in this group';
    const { fetch } = scriptedFetch([described(), { status: 403, text: JSON.stringify({ error }) }]);
    const err = await client(fetch)
      .govern({ groupId: GROUP, op: memberAddedOp(MEMBER, 'Member') })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IntentRefusedError);
    expect((err as IntentRefusedError).status).toBe(403);
    expect((err as IntentRefusedError).reason).toBe(error);
  });
});

describe('RelayClient.foundNamespace', () => {
  const SALT = '5c'.repeat(32);
  const founded = (data: Record<string, unknown>) => ({ body: { data } });

  it('signs the genesis under a root warrant scoped to the derived id, and posts it there', async () => {
    const namespaceId = await foundedNamespaceId(AUTHOR, SALT);
    const { fetch, calls } = scriptedFetch([
      founded({ groupId: namespaceId, teeEnabled: true }),
    ]);

    await expect(
      client(fetch, { executorAccount: EXECUTOR }).foundNamespace({ salt: SALT.toUpperCase() }),
    ).resolves.toEqual({ namespaceId, salt: SALT, teeEnabled: true });

    // No describe: the namespace does not exist yet, so there is nothing to ask.
    expect(calls.map((c) => c.init?.method)).toEqual(['POST']);
    expect(calls[0].url).toBe(
      `https://relay.example/admin-api/groups/${namespaceId}/governance-intents`,
    );
    const sent = JSON.parse(String(calls[0].init?.body)) as {
      warrant: string;
      authorProof: string;
      op: string;
    };
    const op = namespaceCreatedOp({ founder: AUTHOR, credential: 'aa', salt: SALT });
    expect(sent.op).toBe(hexOf(op.bytes));
    expect(sent.op).toBe('09' + AUTHOR + 'aa' + SALT);
    expect(sent.authorProof).toBe('aa');

    const fields = parseGovernanceWarrant(sent.warrant);
    expect(fields.scope).toBe(namespaceId);
    expect(fields.kind).toBe('root');
    expect(fields.authorAccount).toBe(AUTHOR);
    expect(fields.executor).toBe(EXECUTOR);
    expect(fields.nonce).toBe(1n);
    expect(fields.opHash).toBe(hexOf(await governanceOpHash(op)));
  });

  it('reports a failed attestation, and a relay that is not a TEE, as teeEnabled false', async () => {
    const { fetch } = scriptedFetch([
      founded({ groupId: 'f1'.repeat(32), teeEnabled: false, teeError: 'no quote' }),
      founded({ groupId: 'f2'.repeat(32), teeEnabled: false }),
      founded({ groupId: 'f3'.repeat(32) }),
    ]);
    const relay = client(fetch, { executorAccount: EXECUTOR });
    await expect(relay.foundNamespace()).resolves.toMatchObject({
      teeEnabled: false,
      teeError: 'no quote',
    });
    const plain = await relay.foundNamespace();
    expect(plain.teeEnabled).toBe(false);
    expect(plain).not.toHaveProperty('teeError');
    await expect(relay.foundNamespace()).resolves.toMatchObject({ teeEnabled: false });
  });

  it('draws a fresh random salt each time, and derives the id from it', async () => {
    const { fetch, calls } = scriptedFetch([
      founded({ groupId: 'f1'.repeat(32) }),
      founded({ groupId: 'f2'.repeat(32) }),
    ]);
    const relay = client(fetch, { executorAccount: EXECUTOR });
    const a = await relay.foundNamespace();
    const b = await relay.foundNamespace();
    expect(a.salt).toMatch(/^[0-9a-f]{64}$/);
    expect(a.salt).not.toBe(b.salt);

    const scope = (i: number) =>
      parseGovernanceWarrant((JSON.parse(String(calls[i].init?.body)) as { warrant: string }).warrant)
        .scope;
    expect(scope(0)).toBe(await foundedNamespaceId(AUTHOR, a.salt));
    expect(scope(1)).toBe(await foundedNamespaceId(AUTHOR, b.salt));
  });

  it('takes the executor from the input, and refuses one the configured account contradicts', async () => {
    const { fetch, calls } = scriptedFetch([founded({ groupId: 'f1'.repeat(32) })]);
    await client(fetch).foundNamespace({ executorAccount: EXECUTOR });
    const sent = JSON.parse(String(calls[0].init?.body)) as { warrant: string };
    expect(parseGovernanceWarrant(sent.warrant).executor).toBe(EXECUTOR);

    const err = await client(scriptedFetch([]).fetch, { executorAccount: 'ee'.repeat(32) })
      .foundNamespace({ executorAccount: EXECUTOR })
      .catch((e: unknown) => e);
    expect(String(err)).toMatch(/would be unspendable/);
  });

  it('refuses before taking a nonce when it does not know the relay\'s account', async () => {
    const nonces = createMemoryNonceSource(1);
    const next = vi.spyOn(nonces, 'next');
    const { fetch, calls } = scriptedFetch([]);
    await expect(client(fetch, { nonces }).foundNamespace()).rejects.toThrow(
      /needs the relay's account/,
    );
    expect(next).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('signs with a configured signer, and refuses a config naming both before taking a nonce', async () => {
    const pkcs8 = new Uint8Array([
      0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04,
      0x22, 0x04, 0x20, ...new Uint8Array(32).fill(0x77),
    ]);
    const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
    const signer = signerFromCryptoKey(key, (await signerFromSecret(DEVICE_SECRET)).publicKey);

    const warrantOf = async (overrides: Record<string, unknown>) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      try {
        const { fetch, calls } = scriptedFetch([founded({ groupId: 'f1'.repeat(32) })]);
        await client(fetch, { executorAccount: EXECUTOR, ...overrides }).foundNamespace({ salt: SALT });
        return (JSON.parse(String(calls[0].init?.body)) as { warrant: string }).warrant;
      } finally {
        vi.useRealTimers();
      }
    };
    expect(await warrantOf({ deviceSecret: undefined, signer })).toBe(await warrantOf({}));

    const nonces = createMemoryNonceSource(1);
    const { fetch, calls } = scriptedFetch([]);
    await expect(
      client(fetch, { executorAccount: EXECUTOR, signer, nonces }).foundNamespace(),
    ).rejects.toThrow(/not both/);
    expect(calls).toHaveLength(0);
    expect(await nonces.next()).toBe(1n);
  });

  describe('application', () => {
    const APP = { applicationId: '88'.repeat(32), package: 'com.example.app', version: '1.2.3' };
    const describedNs = (namespaceId: string) => ({
      body: { data: { executorAccount: EXECUTOR, groupId: namespaceId, canActOnBehalf: true } },
    });

    it('sets the application right after founding, before the default mask', async () => {
      const namespaceId = await foundedNamespaceId(AUTHOR, SALT);
      const { fetch, calls } = scriptedFetch([
        founded({ groupId: namespaceId, teeEnabled: true }),
        describedNs(namespaceId),
        founded({ groupId: namespaceId }),
        describedNs(namespaceId),
        founded({ groupId: namespaceId }),
      ]);

      await expect(
        client(fetch, { executorAccount: EXECUTOR }).foundNamespace({
          salt: SALT,
          application: APP,
          defaultCapabilities: 231,
        }),
      ).resolves.toEqual({
        namespaceId,
        salt: SALT,
        teeEnabled: true,
        applicationSet: true,
        defaultCapabilitiesSet: true,
      });

      expect(calls.map((c) => c.init?.method)).toEqual(['POST', 'GET', 'POST', 'GET', 'POST']);
      const appSent = JSON.parse(String(calls[2].init?.body)) as { warrant: string; op: string };
      const op = targetApplicationSetOp(APP);
      expect(appSent.op).toBe(hexOf(op.bytes));
      const fields = parseGovernanceWarrant(appSent.warrant);
      expect(fields.scope).toBe(namespaceId);
      expect(fields.kind).toBe('group');
      expect(fields.opHash).toBe(hexOf(await governanceOpHash(op)));
      const maskSent = JSON.parse(String(calls[4].init?.body)) as { op: string };
      expect(maskSent.op).toBe('06e7000000');
    });

    it('reports a refused application without throwing: the namespace is founded either way', async () => {
      const namespaceId = await foundedNamespaceId(AUTHOR, SALT);
      const error = 'a delegated TargetApplicationSet may only choose a group\'s first application';
      const { fetch } = scriptedFetch([
        founded({ groupId: namespaceId, teeEnabled: true }),
        describedNs(namespaceId),
        { status: 403, text: JSON.stringify({ error }) },
      ]);
      const got = await client(fetch, { executorAccount: EXECUTOR }).foundNamespace({ salt: SALT, application: APP });
      expect(got).toMatchObject({ namespaceId, applicationSet: false });
      expect(got.applicationError).toContain('first application');
    });
    });

  describe('defaultCapabilities', () => {
    /** mero-chat's mask: create contexts, invite, join Open subgroups, and more. */
    const MASK = 231;
    const describedNs = (namespaceId: string) => ({
      body: { data: { executorAccount: EXECUTOR, groupId: namespaceId, canActOnBehalf: true } },
    });

    it('sets the mask through the relay right after founding, as the founder', async () => {
      const namespaceId = await foundedNamespaceId(AUTHOR, SALT);
      const { fetch, calls } = scriptedFetch([
        founded({ groupId: namespaceId, teeEnabled: true }),
        describedNs(namespaceId),
        founded({ groupId: namespaceId }),
      ]);

      await expect(
        client(fetch, { executorAccount: EXECUTOR }).foundNamespace({
          salt: SALT,
          defaultCapabilities: MASK,
        }),
      ).resolves.toEqual({ namespaceId, salt: SALT, teeEnabled: true, defaultCapabilitiesSet: true });

      expect(calls.map((c) => c.init?.method)).toEqual(['POST', 'GET', 'POST']);
      expect(calls[2].url).toBe(
        `https://relay.example/admin-api/groups/${namespaceId}/governance-intents`,
      );
      const sent = JSON.parse(String(calls[2].init?.body)) as { warrant: string; op: string };
      const op = defaultCapabilitiesSetOp(MASK);
      expect(sent.op).toBe('06e7000000');
      const fields = parseGovernanceWarrant(sent.warrant);
      expect(fields.scope).toBe(namespaceId);
      expect(fields.kind).toBe('group');
      expect(fields.authorAccount).toBe(AUTHOR);
      expect(fields.nonce).toBe(2n);
      expect(fields.opHash).toBe(hexOf(await governanceOpHash(op)));
    });

    it('reports a refused mask without throwing: the namespace is founded either way', async () => {
      const namespaceId = await foundedNamespaceId(AUTHOR, SALT);
      const error = 'the author is not an admin';
      const { fetch } = scriptedFetch([
        founded({ groupId: namespaceId, teeEnabled: false }),
        describedNs(namespaceId),
        { status: 403, text: JSON.stringify({ error }) },
      ]);
      await expect(
        client(fetch, { executorAccount: EXECUTOR }).foundNamespace({
          salt: SALT,
          defaultCapabilities: MASK,
        }),
      ).resolves.toEqual({
        namespaceId,
        salt: SALT,
        teeEnabled: false,
        defaultCapabilitiesSet: false,
        defaultCapabilitiesError: expect.stringContaining(error),
      });
    });

    it('refuses a mask it could never set before founding anything', async () => {
      const nonces = createMemoryNonceSource(1);
      const { fetch, calls } = scriptedFetch([]);
      const relay = client(fetch, { executorAccount: EXECUTOR, nonces });
      await expect(relay.foundNamespace({ defaultCapabilities: MASK | 512 })).rejects.toThrow(
        /CAN_AUTHOR_ON_BEHALF/,
      );
      await expect(relay.foundNamespace({ defaultCapabilities: -1 })).rejects.toThrow(/u32/);
      await expect(relay.foundNamespace({ defaultCapabilities: 1.5 })).rejects.toThrow(/u32/);
      expect(calls).toHaveLength(0);
      expect(await nonces.next()).toBe(1n);
    });

    it('omits the fields when no mask was asked for', async () => {
      const { fetch } = scriptedFetch([founded({ groupId: 'f1'.repeat(32) })]);
      const out = await client(fetch, { executorAccount: EXECUTOR }).foundNamespace();
      expect(out).not.toHaveProperty('defaultCapabilitiesSet');
      expect(out).not.toHaveProperty('defaultCapabilitiesError');
    });
  });

  it('surfaces an existing namespace (409) as an HTTPError and a refusal (403) as a refusal', async () => {
    const { fetch } = scriptedFetch([
      { status: 409, text: JSON.stringify({ error: 'group already exists' }) },
      { status: 403, text: JSON.stringify({ error: 'not authorized' }) },
    ]);
    const relay = client(fetch, { executorAccount: EXECUTOR });
    const conflict = await relay.foundNamespace({ salt: SALT }).catch((e: unknown) => e);
    expect(conflict).toBeInstanceOf(HTTPError);
    expect((conflict as HTTPError).status).toBe(409);
    const refused = await relay.foundNamespace({ salt: SALT }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(IntentRefusedError);
  });
});

const hexOf = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

describe('RelayClient with a Signer in place of deviceSecret', () => {
  const APPLICATION = '5a'.repeat(32);
  const MEMBER = '44'.repeat(32);
  const describedCreation = {
    body: {
      data: { executorAccount: EXECUTOR, groupId: GROUP, canCreateOnBehalf: true, authorMayCreate: true },
    },
  };
  const created = {
    body: { data: { contextId: 'c0'.repeat(32), groupId: GROUP, memberPublicKey: 'd1'.repeat(32) } },
  };
  const describedGovernance = {
    body: { data: { executorAccount: EXECUTOR, groupId: GROUP, canActOnBehalf: true } },
  };
  const governed = { body: { data: { groupId: GROUP } } };

  /** The same seed as `DEVICE_SECRET`, as a key that can sign and never be exported. */
  async function unexportableSigner() {
    const pkcs8 = new Uint8Array([
      0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04,
      0x22, 0x04, 0x20, ...new Uint8Array(32).fill(0x77),
    ]);
    const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
    return signerFromCryptoKey(key, (await signerFromSecret(DEVICE_SECRET)).publicKey);
  }

  /** The warrant each client posts, with the clock pinned so `notAfter` agrees. */
  async function postedWarrants(overrides: Record<string, unknown>): Promise<string[]> {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    try {
      const { fetch, calls } = scriptedFetch([describedCreation, created, describedGovernance, governed]);
      const relay = client(fetch, overrides);
      await relay.createContext({ groupId: GROUP, applicationId: APPLICATION, seed: '12'.repeat(32) });
      await relay.govern({ groupId: GROUP, op: memberAddedOp(MEMBER, 'Member') });
      return [calls[1], calls[3]].map(
        (c) => (JSON.parse(String(c.init?.body)) as { warrant: string }).warrant,
      );
    } finally {
      vi.useRealTimers();
    }
  }

  it('posts the same creation and governance warrants as the secret it stands for', async () => {
    const viaSecret = await postedWarrants({});
    const viaSigner = await postedWarrants({ deviceSecret: undefined, signer: await unexportableSigner() });
    expect(viaSigner).toEqual(viaSecret);
  });

  it('refuses a config naming both, before spending a nonce', async () => {
    const { fetch } = scriptedFetch([describedGovernance, describedGovernance, governed]);
    const nonces = createMemoryNonceSource(1);
    const relay = client(fetch, { signer: await unexportableSigner(), nonces });
    await expect(
      relay.govern({ groupId: GROUP, op: memberAddedOp(MEMBER, 'Member') }),
    ).rejects.toThrow(/not both/);
    expect(await nonces.next()).toBe(1n);
  });
});

describe('targetApplicationSetOp', () => {
  it('encodes the delegable form: variant 7, bytecode left for the relay', () => {
    const op = targetApplicationSetOp({ applicationId: '88'.repeat(32), package: 'com.example.app', version: '1.2.3' });
    expect(op.kind).toBe('group');
    expect(hexOf(op.bytes)).toBe(
      '07' + '00'.repeat(32) + '88'.repeat(32) +
        '0f000000' + hexOf(new TextEncoder().encode('com.example.app')) +
        '05000000' + hexOf(new TextEncoder().encode('1.2.3')),
    );
  });

  it("matches core's pinned vector (delegable_target_application_set_vector_is_stable)", async () => {
    const op = targetApplicationSetOp({ applicationId: '88'.repeat(32), package: 'com.example.app', version: '1.2.3' });
    expect(hexOf(op.bytes)).toBe(
      '07000000000000000000000000000000000000000000000000000000000000000088888888888888888888888888888888888888888888888888888888888888880f000000636f6d2e6578616d706c652e61707005000000312e322e33',
    );
    expect(hexOf(await governanceOpHash(op))).toBe('904984c8f39e4172ea8864a65511faead68baa76af18d31e1d442a0b9fcb656b');
  });

  it('refuses an empty package or version', () => {
    expect(() => targetApplicationSetOp({ applicationId: '88'.repeat(32), package: '', version: '1' })).toThrow(/package/);
    expect(() => targetApplicationSetOp({ applicationId: '88'.repeat(32), package: 'p', version: '' })).toThrow(/version/);
  });
});
