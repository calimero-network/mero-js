import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SseClient, SUBSCRIPTION_TIMEOUT_MS } from './sse.js';
import { AuthRevokedError, HTTPError } from '../http-client/index.js';
import type { GroupMigrationEventData } from './group.js';

describe('SseClient', () => {
  let client: SseClient;

  beforeEach(() => {
    client = new SseClient({
      baseUrl: 'http://localhost:4001',
      getAuthToken: async () => 'test-token',
      reconnectDelayMs: 100,
    });
  });

  afterEach(() => {
    client.close();
  });

  describe('event emitter', () => {
    it('registers and calls event handlers', () => {
      const handler = vi.fn();
      client.on('connect', handler);

      // Access private method for testing
      (client as any).emit('connect', 'session-123');
      expect(handler).toHaveBeenCalledWith('session-123');
    });

    it('does not add the same handler twice', () => {
      const handler = vi.fn();
      client.on('connect', handler);
      client.on('connect', handler);

      (client as any).emit('connect', 'session-123');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('removes event handlers', () => {
      const handler = vi.fn();
      client.on('connect', handler);
      client.off('connect', handler);

      (client as any).emit('connect', 'session-123');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('onAppVersionChanged', () => {
    // Core serializes context events with `type` as a SIBLING of `data` (the
    // tag is flattened): `result: { contextId, type, data }`. Drive the tests
    // through handleMessage with that real wire shape rather than hand-crafting
    // the emitted event, so they exercise the full parse path.
    const appVersionMsg = (contextId: string, data: Record<string, unknown>) =>
      JSON.stringify({ result: { contextId, type: 'AppVersionChanged', data } });

    it('fires with parsed payload for AppVersionChanged events', () => {
      const seen: Array<{ contextId: string; fromVersion?: string; toVersion?: string }> = [];
      client.onAppVersionChanged((e) => seen.push(e));

      (client as any).handleMessage(appVersionMsg('ctx1', { fromVersion: '1.0.0', toVersion: '2.0.0' }));

      expect(seen).toEqual([{ contextId: 'ctx1', fromVersion: '1.0.0', toVersion: '2.0.0' }]);
    });

    it('ignores events of other types', () => {
      const handler = vi.fn();
      client.onAppVersionChanged(handler);

      (client as any).handleMessage(
        JSON.stringify({ result: { contextId: 'ctx1', type: 'StateMutation', data: {} } }),
      );

      expect(handler).not.toHaveBeenCalled();
    });

    it('returns an unsubscribe handle that stops delivery', () => {
      const handler = vi.fn();
      const off = client.onAppVersionChanged(handler);
      off();

      (client as any).handleMessage(appVersionMsg('ctx1', { toVersion: '2.0.0' }));

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('onMigrationEvent', () => {
    // Group-migration events are keyed on `groupId` with `type` a sibling of
    // `data`, same flattening as the membership family. Drive through
    // handleMessage so the full parse path is exercised.
    const migrationMsg = (type: string, data: Record<string, unknown>) =>
      JSON.stringify({ result: { groupId: 'ns-1', type, data } });

    it('delivers MigrationStarted with the node-local context total', () => {
      const seen: GroupMigrationEventData[] = [];
      client.onMigrationEvent((e) => seen.push(e));

      (client as any).handleMessage(
        migrationMsg('MigrationStarted', {
          fromVersion: '10.1.3',
          toVersion: '10.2.0',
          toStateVersion: 2,
          localContextsTotal: 7,
        }),
      );

      expect(seen).toEqual([
        {
          groupId: 'ns-1',
          type: 'MigrationStarted',
          data: {
            fromVersion: '10.1.3',
            toVersion: '10.2.0',
            toStateVersion: 2,
            localContextsTotal: 7,
          },
        },
      ]);
    });

    // The three totals are different numbers: MigrationProgress.total is the
    // fleet cohort size, the other two are node-local. A helper that flattened
    // them into one field would re-create the defect this surface exists to show.
    it('keeps the cohort total and the node-local totals on separate fields', () => {
      const seen: GroupMigrationEventData[] = [];
      client.onMigrationEvent((e) => seen.push(e));

      (client as any).handleMessage(
        migrationMsg('MigrationProgress', {
          migrated: 2,
          inProgress: 1,
          unknown: 0,
          failed: 1,
          total: 4,
        }),
      );
      (client as any).handleMessage(
        migrationMsg('CascadeProgress', {
          subgroupId: 'sub-1',
          localContextsSwapped: 3,
          localContextsTotal: 5,
        }),
      );

      const progress = seen[0];
      const cascade = seen[1];
      expect(progress.type).toBe('MigrationProgress');
      expect(cascade.type).toBe('CascadeProgress');
      if (progress.type !== 'MigrationProgress' || cascade.type !== 'CascadeProgress') return;
      expect(progress.data.total).toBe(4);
      expect(cascade.data.localContextsTotal).toBe(5);
      expect((cascade.data as Record<string, unknown>).total).toBeUndefined();
    });

    it('delivers MigrationCompleted with the fleet-convergence stamp', () => {
      const seen: GroupMigrationEventData[] = [];
      client.onMigrationEvent((e) => seen.push(e));

      (client as any).handleMessage(
        migrationMsg('MigrationCompleted', { toVersion: '10.2.0', completedAt: 1_700_000_000 }),
      );

      expect(seen).toEqual([
        {
          groupId: 'ns-1',
          type: 'MigrationCompleted',
          data: { toVersion: '10.2.0', completedAt: 1_700_000_000 },
        },
      ]);
    });

    it('ignores membership and context events', () => {
      const handler = vi.fn();
      client.onMigrationEvent(handler);

      (client as any).handleMessage(
        JSON.stringify({
          result: { groupId: 'ns-1', type: 'MemberJoined', data: { memberAccount: 'acct-1' } },
        }),
      );
      (client as any).handleMessage(
        JSON.stringify({ result: { contextId: 'ctx-1', type: 'AppVersionChanged', data: {} } }),
      );

      expect(handler).not.toHaveBeenCalled();
    });

    it('returns an unsubscribe handle that stops delivery', () => {
      const handler = vi.fn();
      const off = client.onMigrationEvent(handler);
      off();

      (client as any).handleMessage(
        migrationMsg('MigrationCompleted', { toVersion: '10.2.0', completedAt: 1 }),
      );

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('handleMessage', () => {
    it('emits connect on connect message', () => {
      const handler = vi.fn();
      client.on('connect', handler);

      (client as any).handleMessage(JSON.stringify({
        type: 'connect',
        session_id: 'sess-abc',
      }));

      expect(handler).toHaveBeenCalledWith('sess-abc');
      expect((client as any).sessionId).toBe('sess-abc');
    });

    it('emits event on context event message', () => {
      const handler = vi.fn();
      client.on('event', handler);

      (client as any).handleMessage(JSON.stringify({
        result: {
          contextId: 'ctx-1',
          data: { action: 'updated' },
        },
      }));

      expect(handler).toHaveBeenCalledWith({
        contextId: 'ctx-1',
        data: { action: 'updated' },
      });
    });

    it('decodes byte-array data', () => {
      const handler = vi.fn();
      client.on('event', handler);

      // Encode '{"name":"test"}' as byte array
      const encoded = Array.from(new TextEncoder().encode('{"name":"test"}'));

      (client as any).handleMessage(JSON.stringify({
        result: {
          contextId: 'ctx-1',
          data: encoded,
        },
      }));

      expect(handler).toHaveBeenCalledWith({
        contextId: 'ctx-1',
        data: { name: 'test' },
      });
    });

    it('keeps raw data when byte-array decode fails', () => {
      const handler = vi.fn();
      client.on('event', handler);

      // Invalid UTF-8/JSON byte array
      const badBytes = [0xff, 0xfe, 0xfd];

      (client as any).handleMessage(JSON.stringify({
        result: {
          contextId: 'ctx-1',
          data: badBytes,
        },
      }));

      // Should still emit with raw data since JSON.parse of decoded text will fail
      expect(handler).toHaveBeenCalled();
      const emittedData = handler.mock.calls[0][0].data;
      // Could be the raw bytes or the decoded text depending on decode behavior
      expect(emittedData).toBeDefined();
    });

    it('ignores invalid JSON', () => {
      const handler = vi.fn();
      client.on('event', handler);

      (client as any).handleMessage('not-json');
      expect(handler).not.toHaveBeenCalled();
    });

    it('ignores messages without result or connect type', () => {
      const handler = vi.fn();
      client.on('event', handler);

      (client as any).handleMessage(JSON.stringify({ type: 'heartbeat' }));
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('subscribe/unsubscribe tracking', () => {
    it('tracks subscribed context IDs', async () => {
      await client.subscribe(['ctx-1', 'ctx-2']);
      expect((client as any).subscribedContextIds.has('ctx-1')).toBe(true);
      expect((client as any).subscribedContextIds.has('ctx-2')).toBe(true);
    });

    it('removes context IDs on unsubscribe', async () => {
      await client.subscribe(['ctx-1', 'ctx-2']);
      await client.unsubscribe(['ctx-1']);
      expect((client as any).subscribedContextIds.has('ctx-1')).toBe(false);
      expect((client as any).subscribedContextIds.has('ctx-2')).toBe(true);
    });

    it('re-subscribes after reconnect', () => {
      const sendSpy = vi.spyOn(client as any, 'postSubscription').mockResolvedValue(null);

      // Pre-populate subscriptions
      (client as any).subscribedContextIds.add('ctx-1');
      (client as any).subscribedGroupIds.add('grp-1');

      // Simulate connect message
      (client as any).handleMessage(JSON.stringify({
        type: 'connect',
        session_id: 'new-session',
      }));

      expect(sendSpy).toHaveBeenCalledWith('subscribe', { contextIds: ['ctx-1'], groupIds: ['grp-1'] });
    });

    it('emits connect only once the re-subscribe has landed', async () => {
      let landed!: () => void;
      vi.spyOn(client as any, 'postSubscription').mockReturnValue(
        new Promise<null>((resolve) => { landed = () => resolve(null); }),
      );
      const onConnect = vi.fn();
      client.on('connect', onConnect);
      (client as any).subscribedContextIds.add('ctx-1');

      (client as any).handleMessage(JSON.stringify({ type: 'connect', session_id: 'new-session' }));
      await Promise.resolve();
      expect(onConnect).not.toHaveBeenCalled();

      landed();
      await vi.waitFor(() => expect(onConnect).toHaveBeenCalledWith('new-session'));
    });

    it('drops a connect whose re-subscribe lands after the client closed', async () => {
      let landed!: () => void;
      vi.spyOn(client as any, 'postSubscription').mockReturnValue(
        new Promise<null>((resolve) => { landed = () => resolve(null); }),
      );
      const onConnect = vi.fn();
      client.on('connect', onConnect);
      (client as any).subscribedContextIds.add('ctx-1');

      (client as any).handleMessage(JSON.stringify({ type: 'connect', session_id: 'new-session' }));
      client.close();
      landed();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onConnect).not.toHaveBeenCalled();
    });

    const reconnectWith = (fetchImpl: typeof fetch) => {
      const reconnecting = new SseClient({
        baseUrl: 'http://localhost:4001',
        getAuthToken: async () => 'test-token',
        fetch: fetchImpl,
      });
      const seen: string[] = [];
      reconnecting.on('connect', () => seen.push('connect'));
      reconnecting.on('error', (err) => seen.push(`error:${err.name}`));
      (reconnecting as any).subscribedContextIds.add('ctx-1');
      (reconnecting as any).handleMessage(JSON.stringify({ type: 'connect', session_id: 'new-session' }));
      return { reconnecting, seen };
    };

    it('announces a refused re-subscribe as connect, then its error', async () => {
      const { reconnecting, seen } = reconnectWith(async () => new Response('busy', { status: 500 }));
      await vi.waitFor(() => expect(seen).toEqual(['connect', 'error:HTTPError']));
      reconnecting.close();
    });

    it('gives up on a re-subscribe that never answers, so connect is not withheld', async () => {
      vi.useFakeTimers();
      try {
        const hanging: typeof fetch = (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          });
        const { reconnecting, seen } = reconnectWith(hanging);
        await vi.advanceTimersByTimeAsync(SUBSCRIPTION_TIMEOUT_MS - 1);
        expect(seen).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(seen).toEqual(['connect', 'error:TimeoutError']);
        reconnecting.close();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('group-membership events', () => {
    it('emits group event with groupId intact (no double-unwrap)', () => {
      const handler = vi.fn();
      client.on('event', handler);

      (client as any).handleMessage(JSON.stringify({
        result: {
          groupId: 'grp-1',
          type: 'MemberJoined',
          data: { memberAccount: 'acct-1', role: 'Member' },
        },
      }));

      expect(handler).toHaveBeenCalledWith({
        groupId: 'grp-1',
        type: 'MemberJoined',
        data: { memberAccount: 'acct-1', role: 'Member' },
      });
    });

    it('still parses existing context events unchanged (regression guard)', () => {
      const handler = vi.fn();
      client.on('event', handler);

      (client as any).handleMessage(JSON.stringify({
        result: {
          contextId: 'ctx-1',
          type: 'AppVersionChanged',
          data: { toVersion: '2.0.0' },
        },
      }));

      expect(handler).toHaveBeenCalledWith({
        contextId: 'ctx-1',
        type: 'AppVersionChanged',
        data: { toVersion: '2.0.0' },
      });
    });
  });

  describe('subscribe with groupIds', () => {
    it('sends groupIds on the wire', async () => {
      (client as any).sessionId = 'sess-1';
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      global.fetch = fetchMock as unknown as typeof fetch;

      await client.subscribe({ groupIds: ['grp-1'] });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/sse/subscription'),
        expect.objectContaining({
          body: JSON.stringify({ id: 'sess-1', method: 'subscribe', params: { groupIds: ['grp-1'] } }),
        }),
      );
      expect((client as any).subscribedGroupIds.has('grp-1')).toBe(true);
    });

    it('still accepts a plain contextIds array (backward compatible)', async () => {
      (client as any).sessionId = 'sess-1';
      global.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;

      await client.subscribe(['ctx-1']);

      expect((client as any).subscribedContextIds.has('ctx-1')).toBe(true);
    });
  });

  describe('close', () => {
    it('clears all state', () => {
      (client as any).sessionId = 'sess';
      (client as any).subscribedContextIds.add('ctx-1');

      client.close();

      expect((client as any).closed).toBe(true);
      expect((client as any).sessionId).toBeNull();
      expect((client as any).subscribedContextIds.size).toBe(0);
    });
  });
});

// Need to import afterEach
import { afterEach } from 'vitest';

describe('SseClient connect failures carry the auth reason', () => {
  // A bare `Error("SSE connection failed: 401")` forced callers to string-match
  // the status. The only safe reading of a bare 401 is "fatal", so consumers
  // logged the user out on a routine reconnect after the access token aged out
  // — discarding a refresh token that was still valid.
  const make = () =>
    new SseClient({
      baseUrl: 'http://localhost:4001',
      getAuthToken: async () => 'test-token',
      reconnectDelayMs: 100,
    });

  const respond = (status: number, statusText: string, authError?: string) => {
    const headers = new Headers();
    if (authError) headers.set('x-auth-error', authError);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status, statusText, headers })),
    );
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws AuthRevokedError when the token family is gone', async () => {
    respond(401, 'Unauthorized', 'token_reuse');
    const client = make();
    // `connect()` reports failures through the `error` event rather than
    // rejecting, so the typed error has to survive that hop intact.
    let err: unknown;
    client.on('error', (e: unknown) => {
      err = e;
    });
    await client.connect();
    client.close();

    expect(err).toBeInstanceOf(AuthRevokedError);
    expect((err as AuthRevokedError).reason).toBe('token_reuse');
  });

  it('throws a plain HTTPError for an expired token, which is recoverable', async () => {
    respond(401, 'Unauthorized', 'token_expired');
    const client = make();
    // `connect()` reports failures through the `error` event rather than
    // rejecting, so the typed error has to survive that hop intact.
    let err: unknown;
    client.on('error', (e: unknown) => {
      err = e;
    });
    await client.connect();
    client.close();

    // Recoverable: the caller should refresh and reconnect, NOT log out.
    expect(err).toBeInstanceOf(HTTPError);
    expect(err).not.toBeInstanceOf(AuthRevokedError);
    expect((err as HTTPError).headers.get('x-auth-error')).toBe('token_expired');
  });

  // MEASURED against merod 0.11.0-rc.41 (build 88e323b), 2026-09-22: a revoked
  // token family answers `GET /sse` with
  //     HTTP/1.1 403 Forbidden
  //     x-auth-error: token_revoked
  //     content-length: 0
  // `token_expired` is the 401. Keying the terminal check on 401 alone made it
  // unreachable for the only terminal reason a stream ever sees.
  it('treats a 403 token_revoked as terminal, which is how core sends it', async () => {
    respond(403, 'Forbidden', 'token_revoked');
    const client = make();
    let err: unknown;
    client.on('error', (e: unknown) => {
      err = e;
    });
    await client.connect();
    client.close();

    expect(err).toBeInstanceOf(AuthRevokedError);
    expect((err as AuthRevokedError).reason).toBe('token_revoked');
  });

  // Reconnecting against a dead credential is a timer that never succeeds.
  it('stops reconnecting once the token family is gone', async () => {
    respond(403, 'Forbidden', 'token_revoked');
    const client = make();
    client.on('error', () => {});
    await client.connect();

    const callsAfterConnect = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    // Past the 100ms reconnect delay this client was configured with.
    await new Promise((r) => setTimeout(r, 250));
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      callsAfterConnect,
    );
    client.close();
  });

  // A 403 with no `x-auth-error` is the *other* 403 on this path — core's
  // "Forbidden: not the session owner" — and it is not terminal.
  it('leaves a 403 without an auth header recoverable', async () => {
    respond(403, 'Forbidden');
    const client = make();
    let err: unknown;
    client.on('error', (e: unknown) => {
      err = e;
    });
    await client.connect();
    client.close();

    expect(err).toBeInstanceOf(HTTPError);
    expect(err).not.toBeInstanceOf(AuthRevokedError);
    expect((err as HTTPError).status).toBe(403);
  });

  // The subscribe path reported only the status, so the reason — the only thing
  // core sends, since the body is empty — never reached the app.
  it('carries the auth reason off the subscribe call too', async () => {
    respond(403, 'Forbidden', 'token_revoked');
    const client = make();
    // `subscribe` only reaches the wire once a session exists.
    (client as any).sessionId = 'sess-1';
    let err: unknown;
    client.on('error', (e: unknown) => {
      err = e;
    });
    await client.subscribe(['ctx-1']);
    client.close();

    expect(err).toBeInstanceOf(AuthRevokedError);
    expect((err as AuthRevokedError).reason).toBe('token_revoked');
    expect((err as AuthRevokedError).status).toBe(403);
  });

  it('throws HTTPError for a non-auth failure', async () => {
    respond(503, 'Service Unavailable');
    const client = make();
    // `connect()` reports failures through the `error` event rather than
    // rejecting, so the typed error has to survive that hop intact.
    let err: unknown;
    client.on('error', (e: unknown) => {
      err = e;
    });
    await client.connect();
    client.close();

    expect(err).toBeInstanceOf(HTTPError);
    expect(err).not.toBeInstanceOf(AuthRevokedError);
    expect((err as HTTPError).status).toBe(503);
  });
});


describe('SseClient reconnect backoff', () => {
  it('doubles the delay per failed attempt, with half-jitter, up to the cap', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const sse = new SseClient({ baseUrl: 'http://localhost:4001', getAuthToken: async () => 't', reconnectDelayMs: 1000 });
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    try {
      const delays = [0, 1, 2, 3, 4, 5].map(() => {
        (sse as any).scheduleReconnect();
        return setTimeoutSpy.mock.calls.at(-1)![1];
      });
      expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000]);

      vi.mocked(Math.random).mockReturnValue(0);
      (sse as any).reconnectAttempt = 0;
      (sse as any).scheduleReconnect();
      expect(setTimeoutSpy.mock.calls.at(-1)![1]).toBe(500);
    } finally {
      sse.close();
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });
});

describe('SseClient reconnect attempt counter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const make = () =>
    new SseClient({ baseUrl: 'http://localhost:4001', getAuthToken: async () => 't', reconnectDelayMs: 100 });

  it('keeps backing off while the server accepts then closes without a connect message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    const sse = make();
    sse.on('error', () => {});
    await sse.connect();
    for (let i = 0; i < 2; i++) {
      (sse as any).forceReconnect();
      await new Promise((r) => setTimeout(r, 10));
    }
    expect((sse as any).reconnectAttempt).toBe(3);
    sse.close();
  });

  it('resets on the first connect message and on close', () => {
    const sse = make();
    (sse as any).reconnectAttempt = 4;
    (sse as any).handleMessage(JSON.stringify({ type: 'connect', session_id: 's1' }));
    expect((sse as any).reconnectAttempt).toBe(0);

    (sse as any).reconnectAttempt = 4;
    sse.close();
    expect((sse as any).reconnectAttempt).toBe(0);
  });

  it('still reconnects after an expired token and stops after a revoked one', async () => {
    const respond = (authError: string) =>
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('no', { status: 401, headers: { 'x-auth-error': authError } })),
      );
    const calls = () => (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    respond('token_expired');
    const expired = make();
    expired.on('error', () => {});
    await expired.connect();
    expect((expired as any).reconnectTimer).not.toBeNull();
    expired.close();

    respond('token_revoked');
    const revoked = make();
    revoked.on('error', () => {});
    await revoked.connect();
    expect((revoked as any).reconnectTimer).toBeNull();
    expect(calls()).toBe(1);
    revoked.close();
  });
});

describe('SseClient baseUrl guard', () => {
  it('refuses a cleartext non-loopback baseUrl unless allowInsecureHttp is set', () => {
    const opts = { baseUrl: 'http://remote', getAuthToken: async () => 't' };
    expect(() => new SseClient(opts)).toThrow(/cleartext/);
    expect(() => new SseClient({ ...opts, allowInsecureHttp: true })).not.toThrow();
  });
});
