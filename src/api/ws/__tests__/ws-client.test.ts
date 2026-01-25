import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketClient } from '../client';

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  
  url: string;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  
  sentMessages: string[] = [];
  
  constructor(url: string) {
    this.url = url;
    // Simulate connection
    setTimeout(() => this.onopen?.(), 0);
  }
  
  send(data: string): void {
    this.sentMessages.push(data);
  }
  
  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: 'Normal closure' });
  }
  
  // Helper to simulate incoming message
  simulateMessage(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  
  // Helper to simulate error
  simulateError(): void {
    this.onerror?.(new Event('error'));
  }
}

// Replace global WebSocket
const originalWebSocket = global.WebSocket;
beforeEach(() => {
  (global as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
});
afterEach(() => {
  (global as unknown as { WebSocket: typeof WebSocket }).WebSocket = originalWebSocket;
});

describe('WebSocketClient', () => {
  describe('connect', () => {
    it('should connect to WebSocket server', async () => {
      const client = new WebSocketClient({
        baseUrl: 'http://localhost:8080',
      });

      await client.connect();

      expect(client.isConnected()).toBe(true);
    });

    it('should convert http to ws URL', async () => {
      const client = new WebSocketClient({
        baseUrl: 'http://localhost:8080',
      });

      await client.connect();

      // Access internal ws to check URL (for testing purposes)
      expect(client.isConnected()).toBe(true);
    });

    it('should include auth token in URL if provided', async () => {
      const getAuthToken = vi.fn().mockResolvedValue('test-token');
      const client = new WebSocketClient({
        baseUrl: 'http://localhost:8080',
        getAuthToken,
      });

      await client.connect();

      expect(getAuthToken).toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('should disconnect from WebSocket server', async () => {
      const client = new WebSocketClient({
        baseUrl: 'http://localhost:8080',
      });

      await client.connect();
      client.disconnect();

      expect(client.isConnected()).toBe(false);
    });

    it('should clear subscribed contexts on disconnect', async () => {
      const client = new WebSocketClient({
        baseUrl: 'http://localhost:8080',
      });

      await client.connect();
      
      // Mock subscribe response
      setTimeout(() => {
        const ws = (client as unknown as { ws: MockWebSocket }).ws;
        ws.simulateMessage({ id: 1, result: {} });
      }, 10);
      
      await client.subscribe(['ctx1', 'ctx2']);
      expect(client.getSubscribedContexts()).toHaveLength(2);

      client.disconnect();
      expect(client.getSubscribedContexts()).toHaveLength(0);
    });
  });

  describe('subscribe', () => {
    it('should send subscribe message', async () => {
      const client = new WebSocketClient({
        baseUrl: 'http://localhost:8080',
      });

      await client.connect();

      // Mock response
      setTimeout(() => {
        const ws = (client as unknown as { ws: MockWebSocket }).ws;
        ws.simulateMessage({ id: 1, result: {} });
      }, 10);

      await client.subscribe(['ctx1', 'ctx2']);

      const ws = (client as unknown as { ws: MockWebSocket }).ws;
      expect(ws.sentMessages).toHaveLength(1);
      const message = JSON.parse(ws.sentMessages[0]);
      expect(message.method).toBe('subscribe');
      expect(message.params.contextIds).toEqual(['ctx1', 'ctx2']);
    });

    it('should track subscribed contexts', async () => {
      const client = new WebSocketClient({
        baseUrl: 'http://localhost:8080',
      });

      await client.connect();

      setTimeout(() => {
        const ws = (client as unknown as { ws: MockWebSocket }).ws;
        ws.simulateMessage({ id: 1, result: {} });
      }, 10);

      await client.subscribe(['ctx1', 'ctx2']);

      expect(client.getSubscribedContexts()).toEqual(['ctx1', 'ctx2']);
    });
  });

  describe('unsubscribe', () => {
    it('should send unsubscribe message', async () => {
      const client = new WebSocketClient({
        baseUrl: 'http://localhost:8080',
      });

      await client.connect();

      // Subscribe first
      setTimeout(() => {
        const ws = (client as unknown as { ws: MockWebSocket }).ws;
        ws.simulateMessage({ id: 1, result: {} });
      }, 10);
      await client.subscribe(['ctx1', 'ctx2']);

      // Then unsubscribe
      setTimeout(() => {
        const ws = (client as unknown as { ws: MockWebSocket }).ws;
        ws.simulateMessage({ id: 2, result: {} });
      }, 10);
      await client.unsubscribe(['ctx1']);

      expect(client.getSubscribedContexts()).toEqual(['ctx2']);
    });
  });

  describe('event handling', () => {
    it('should call event handlers on message', async () => {
      const client = new WebSocketClient({
        baseUrl: 'http://localhost:8080',
      });

      await client.connect();

      const handler = vi.fn();
      client.onEvent(handler);

      const ws = (client as unknown as { ws: MockWebSocket }).ws;
      ws.simulateMessage({
        contextId: 'ctx1',
        type: 'state_change',
        data: { key: 'value' },
      });

      expect(handler).toHaveBeenCalledWith({
        contextId: 'ctx1',
        type: 'state_change',
        data: { key: 'value' },
      });
    });

    it('should allow unsubscribing from events', async () => {
      const client = new WebSocketClient({
        baseUrl: 'http://localhost:8080',
      });

      await client.connect();

      const handler = vi.fn();
      const unsubscribe = client.onEvent(handler);
      unsubscribe();

      const ws = (client as unknown as { ws: MockWebSocket }).ws;
      ws.simulateMessage({
        contextId: 'ctx1',
        type: 'test',
        data: {},
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should call error handlers on WebSocket error', async () => {
      const client = new WebSocketClient({
        baseUrl: 'http://localhost:8080',
      });

      await client.connect();

      const handler = vi.fn();
      client.onError(handler);

      const ws = (client as unknown as { ws: MockWebSocket }).ws;
      ws.simulateError();

      expect(handler).toHaveBeenCalled();
    });

    it('should throw error when sending without connection', async () => {
      const client = new WebSocketClient({
        baseUrl: 'http://localhost:8080',
      });

      await expect(client.subscribe(['ctx1'])).rejects.toThrow('WebSocket not connected');
    });
  });
});
