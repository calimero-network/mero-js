import { describe, it, expect, vi } from 'vitest';
import { RelayClient, IntentRefusedError } from './relay-client.js';
import { createMemoryNonceSource } from './nonce-source.js';
import { HTTPError } from '../http-client/web-client.js';
import { parseWarrant } from '../warrant/warrant.js';
import { creationInitHash, parseCreationWarrant } from '../warrant/creation-warrant.js';

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

const hexOf = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
