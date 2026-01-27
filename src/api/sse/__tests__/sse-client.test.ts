import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SseClient } from '../client';

// Mock EventSource
class MockEventSource {
  static OPEN = 1;
  static CLOSED = 2;

  url: string;
  readyState = MockEventSource.OPEN;
  withCredentials: boolean;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  
  private eventListeners: Map<string, ((event: Event) => void)[]> = new Map();

  constructor(url: string, options?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = options?.withCredentials ?? false;
    
    // Simulate connection and connect event
    setTimeout(() => {
      this.dispatchEvent('connect', { data: 'test-session-id' });
    }, 0);
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type)!.push(listener);
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  close(): void {
    this.readyState = MockEventSource.CLOSED;
  }

  // Helper to dispatch events
  dispatchEvent(type: string, data: { data: string; lastEventId?: string }): void {
    const event = new MessageEvent(type, {
      data: data.data,
      lastEventId: data.lastEventId,
    });
    
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.forEach(listener => listener(event));
    }
    
    if (type === 'message' && this.onmessage) {
      this.onmessage(event);
    }
  }

  // Helper to simulate error
  simulateError(): void {
    this.onerror?.(new Event('error'));
  }
}

// Mock HTTP client
const createMockHttpClient = () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  patch: vi.fn(),
  head: vi.fn(),
});

// Replace global EventSource
const originalEventSource = global.EventSource;
beforeEach(() => {
  (global as unknown as { EventSource: typeof MockEventSource }).EventSource = MockEventSource;
});
afterEach(() => {
  (global as unknown as { EventSource: typeof EventSource }).EventSource = originalEventSource;
});

describe('SseClient', () => {
  describe('connect', () => {
    it('should connect and return session ID', async () => {
      const httpClient = createMockHttpClient();
      const client = new SseClient({
        baseUrl: 'http://localhost:8080',
        httpClient: httpClient as never,
      });

      const sessionId = await client.connect();

      expect(sessionId).toBe('test-session-id');
      expect(client.isConnected()).toBe(true);
      expect(client.getSessionId()).toBe('test-session-id');
    });

    it('should throw if already connected', async () => {
      const httpClient = createMockHttpClient();
      const client = new SseClient({
        baseUrl: 'http://localhost:8080',
        httpClient: httpClient as never,
      });

      await client.connect();

      await expect(client.connect()).rejects.toThrow('Already connected');
    });
  });

  describe('disconnect', () => {
    it('should disconnect and clear session', async () => {
      const httpClient = createMockHttpClient();
      const client = new SseClient({
        baseUrl: 'http://localhost:8080',
        httpClient: httpClient as never,
      });

      await client.connect();
      client.disconnect();

      expect(client.isConnected()).toBe(false);
      expect(client.getSessionId()).toBeNull();
    });
  });

  describe('subscribe', () => {
    it('should send subscribe request', async () => {
      const httpClient = createMockHttpClient();
      httpClient.post.mockResolvedValue({ data: { subscribedContextIds: ['ctx1'] } });
      
      const client = new SseClient({
        baseUrl: 'http://localhost:8080',
        httpClient: httpClient as never,
      });

      await client.connect();
      await client.subscribe(['ctx1']);

      expect(httpClient.post).toHaveBeenCalledWith('/sse/subscription', {
        id: 'test-session-id',
        method: 'subscribe',
        params: { contextIds: ['ctx1'] },
      });
    });

    it('should track subscribed contexts', async () => {
      const httpClient = createMockHttpClient();
      httpClient.post.mockResolvedValue({ data: { subscribedContextIds: ['ctx1', 'ctx2'] } });
      
      const client = new SseClient({
        baseUrl: 'http://localhost:8080',
        httpClient: httpClient as never,
      });

      await client.connect();
      await client.subscribe(['ctx1', 'ctx2']);

      expect(client.getSubscribedContexts()).toEqual(['ctx1', 'ctx2']);
    });

    it('should throw if not connected', async () => {
      const httpClient = createMockHttpClient();
      const client = new SseClient({
        baseUrl: 'http://localhost:8080',
        httpClient: httpClient as never,
      });

      await expect(client.subscribe(['ctx1'])).rejects.toThrow('Not connected');
    });
  });

  describe('unsubscribe', () => {
    it('should send unsubscribe request', async () => {
      const httpClient = createMockHttpClient();
      httpClient.post.mockResolvedValue({ data: { unsubscribedContextIds: ['ctx1'] } });
      
      const client = new SseClient({
        baseUrl: 'http://localhost:8080',
        httpClient: httpClient as never,
      });

      await client.connect();
      await client.subscribe(['ctx1', 'ctx2']);
      await client.unsubscribe(['ctx1']);

      expect(httpClient.post).toHaveBeenLastCalledWith('/sse/subscription', {
        id: 'test-session-id',
        method: 'unsubscribe',
        params: { contextIds: ['ctx1'] },
      });
      expect(client.getSubscribedContexts()).toEqual(['ctx2']);
    });
  });

  describe('getSession', () => {
    it('should get session information', async () => {
      const httpClient = createMockHttpClient();
      httpClient.get.mockResolvedValue({
        data: {
          sessionId: 'test-session-id',
          subscribedContextIds: ['ctx1'],
          connectedAt: '2024-01-01T00:00:00Z',
        },
      });
      
      const client = new SseClient({
        baseUrl: 'http://localhost:8080',
        httpClient: httpClient as never,
      });

      await client.connect();
      const session = await client.getSession();

      expect(httpClient.get).toHaveBeenCalledWith('/sse/session/test-session-id');
      expect(session.data?.sessionId).toBe('test-session-id');
    });

    it('should throw if not connected', async () => {
      const httpClient = createMockHttpClient();
      const client = new SseClient({
        baseUrl: 'http://localhost:8080',
        httpClient: httpClient as never,
      });

      await expect(client.getSession()).rejects.toThrow('Not connected');
    });
  });

  describe('event handling', () => {
    it('should call event handlers on message', async () => {
      const httpClient = createMockHttpClient();
      const client = new SseClient({
        baseUrl: 'http://localhost:8080',
        httpClient: httpClient as never,
      });

      await client.connect();

      const handler = vi.fn();
      client.onEvent(handler);

      // Get the EventSource and simulate a message
      const es = (client as unknown as { eventSource: MockEventSource }).eventSource;
      es.dispatchEvent('message', {
        data: JSON.stringify({ key: 'value' }),
        lastEventId: '1',
      });

      expect(handler).toHaveBeenCalledWith({
        id: '1',
        event: 'message',
        data: { key: 'value' },
      });
    });

    it('should handle non-JSON messages', async () => {
      const httpClient = createMockHttpClient();
      const client = new SseClient({
        baseUrl: 'http://localhost:8080',
        httpClient: httpClient as never,
      });

      await client.connect();

      const handler = vi.fn();
      client.onEvent(handler);

      const es = (client as unknown as { eventSource: MockEventSource }).eventSource;
      es.dispatchEvent('message', {
        data: 'plain text message',
        lastEventId: '2',
      });

      expect(handler).toHaveBeenCalledWith({
        id: '2',
        event: 'message',
        data: 'plain text message',
      });
    });

    it('should allow unsubscribing from events', async () => {
      const httpClient = createMockHttpClient();
      const client = new SseClient({
        baseUrl: 'http://localhost:8080',
        httpClient: httpClient as never,
      });

      await client.connect();

      const handler = vi.fn();
      const unsubscribe = client.onEvent(handler);
      unsubscribe();

      const es = (client as unknown as { eventSource: MockEventSource }).eventSource;
      es.dispatchEvent('message', { data: '{}' });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should call error handlers on EventSource error', async () => {
      const httpClient = createMockHttpClient();
      const client = new SseClient({
        baseUrl: 'http://localhost:8080',
        httpClient: httpClient as never,
      });

      await client.connect();

      const handler = vi.fn();
      client.onError(handler);

      const es = (client as unknown as { eventSource: MockEventSource }).eventSource;
      es.simulateError();

      expect(handler).toHaveBeenCalled();
    });
  });
});
