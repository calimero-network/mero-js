import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WsClient } from './ws';

describe('WsClient', () => {
  let client: WsClient;

  beforeEach(() => {
    client = new WsClient({
      baseUrl: 'http://localhost:4001',
      getAuthToken: async () => 'test-token',
    });
  });

  afterEach(() => {
    client.close();
  });

  describe('handleMessage', () => {
    // Core serializes context events with `type` as a SIBLING of `data` (the
    // tag is flattened): `result: { contextId, type, data }`. Drive the tests
    // through handleMessage with that real wire shape, matching SseClient.
    it('forwards the event type tag from msg.result.type', () => {
      const handler = vi.fn();
      client.on('event', handler);

      (client as any).handleMessage(JSON.stringify({
        result: {
          contextId: 'ctx-1',
          type: 'AppVersionChanged',
          data: { fromVersion: '1.0.0', toVersion: '2.0.0' },
        },
      }));

      expect(handler).toHaveBeenCalledWith({
        contextId: 'ctx-1',
        type: 'AppVersionChanged',
        data: { fromVersion: '1.0.0', toVersion: '2.0.0' },
      });
    });

    it('emits event on context event message (type undefined when absent)', () => {
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
        type: undefined,
        data: { action: 'updated' },
      });
    });

    it('decodes byte-array data while still forwarding type', () => {
      const handler = vi.fn();
      client.on('event', handler);

      const encoded = Array.from(new TextEncoder().encode('{"name":"test"}'));

      (client as any).handleMessage(JSON.stringify({
        result: {
          contextId: 'ctx-1',
          type: 'StateMutation',
          data: encoded,
        },
      }));

      expect(handler).toHaveBeenCalledWith({
        contextId: 'ctx-1',
        type: 'StateMutation',
        data: { name: 'test' },
      });
    });
  });
});
