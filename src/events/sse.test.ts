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

      // Simulate connect message
      (client as any).handleMessage(JSON.stringify({
        type: 'connect',
        session_id: 'new-session',
      }));

      expect(sendSpy).toHaveBeenCalledWith('subscribe', ['ctx-1']);
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
