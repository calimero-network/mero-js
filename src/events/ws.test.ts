import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WsClient } from './ws.js';

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
  });

  describe('subscribe with groupIds', () => {
    it('tracks group ids and sends groupIds on the wire', () => {
      const sendSpy = vi.fn();
      (client as any).ws = { readyState: 1 /* WebSocket.OPEN */, send: sendSpy, close: vi.fn() };

      client.subscribe({ groupIds: ['grp-1'] });

      expect((client as any).subscribedGroupIds.has('grp-1')).toBe(true);
      expect(sendSpy).toHaveBeenCalledWith(
        JSON.stringify({ id: null, method: 'subscribe', params: { groupIds: ['grp-1'] } }),
      );
    });

    it('re-subscribes both context and group ids on reconnect', () => {
      (client as any).subscribedContextIds.add('ctx-1');
      (client as any).subscribedGroupIds.add('grp-1');
      const sendSpy = vi.fn();
      (client as any).ws = { readyState: 1 /* WebSocket.OPEN */, send: sendSpy, close: vi.fn() };

      (client as any).resubscribeAfterReconnect();

      expect(sendSpy).toHaveBeenCalledWith(
        JSON.stringify({ id: null, method: 'subscribe', params: { contextIds: ['ctx-1'], groupIds: ['grp-1'] } }),
      );
    });
  });
});
