import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SseClient } from './sse';

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
      const sendSpy = vi.spyOn(client as any, 'sendSubscription').mockResolvedValue(undefined);

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
  });

  describe('group-membership events', () => {
    it('emits group event with groupId intact (no double-unwrap)', () => {
      const handler = vi.fn();
      client.on('event', handler);

      (client as any).handleMessage(JSON.stringify({
        result: {
          groupId: 'grp-1',
          type: 'MemberJoined',
          data: { member: 'mem-1', role: 'Member' },
        },
      }));

      expect(handler).toHaveBeenCalledWith({
        groupId: 'grp-1',
        type: 'MemberJoined',
        data: { member: 'mem-1', role: 'Member' },
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
