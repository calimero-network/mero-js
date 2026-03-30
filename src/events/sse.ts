export interface SseEventData {
  contextId: string;
  data: unknown;
}

type SseEventHandler = (event: SseEventData) => void;
type SseConnectHandler = (sessionId: string) => void;
type SseErrorHandler = (error: Error) => void;

interface SseListeners {
  connect: SseConnectHandler[];
  event: SseEventHandler[];
  error: SseErrorHandler[];
}

export class SseClient {
  private baseUrl: string;
  private getAuthToken: () => Promise<string>;
  private reconnectDelayMs: number;
  private sessionId: string | null = null;
  private abortController: AbortController | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private subscribedContextIds: Set<string> = new Set();
  private closed = false;
  private listeners: SseListeners = { connect: [], event: [], error: [] };

  constructor(opts: {
    baseUrl: string;
    getAuthToken: () => Promise<string>;
    reconnectDelayMs?: number;
  }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.getAuthToken = opts.getAuthToken;
    this.reconnectDelayMs = opts.reconnectDelayMs ?? 3000;
  }

  on(event: 'connect', handler: SseConnectHandler): void;
  on(event: 'event', handler: SseEventHandler): void;
  on(event: 'error', handler: SseErrorHandler): void;
  on(event: string, handler: SseConnectHandler | SseEventHandler | SseErrorHandler): void {
    const key = event as keyof SseListeners;
    if (key in this.listeners) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arr = this.listeners[key] as any[];
      if (!arr.includes(handler)) arr.push(handler);
    }
  }

  off(event: 'connect', handler: SseConnectHandler): void;
  off(event: 'event', handler: SseEventHandler): void;
  off(event: 'error', handler: SseErrorHandler): void;
  off(event: string, handler: SseConnectHandler | SseEventHandler | SseErrorHandler): void {
    const key = event as keyof SseListeners;
    if (key in this.listeners) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arr = this.listeners[key] as any[];
      const idx = arr.indexOf(handler);
      if (idx !== -1) arr.splice(idx, 1);
    }
  }

  private emit(event: 'connect', sessionId: string): void;
  private emit(event: 'event', data: SseEventData): void;
  private emit(event: 'error', error: Error): void;
  private emit(event: string, arg?: string | SseEventData | Error): void {
    const key = event as keyof SseListeners;
    if (key in this.listeners) {
      for (const handler of this.listeners[key]) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (handler as any)(arg);
        } catch {
          // Swallow handler errors
        }
      }
    }
  }

  async connect(): Promise<void> {
    // Abort any existing connection before reconnecting
    if (this.abortController) {
      this.abortController.abort();
    }
    this.closed = false;
    this.abortController = new AbortController();

    try {
      const token = await this.getAuthToken();
      const response = await fetch(`${this.baseUrl}/sse`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'text/event-stream',
        },
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('SSE response has no body');
      }

      this.readStream(response.body).catch((err) => {
        if (this.closed) return;
        const error = err instanceof Error ? err : new Error(String(err));
        this.emit('error', error);
        this.scheduleReconnect();
      });
    } catch (err) {
      if (this.closed) return;
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('error', error);
      this.scheduleReconnect();
    }
  }

  private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        // Keep the last partial line in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data:')) {
            const jsonStr = line.slice(5).trim();
            if (jsonStr) {
              this.handleMessage(jsonStr);
            }
          }
        }
      }
      // Flush remaining bytes from the decoder
      buffer += decoder.decode();
      if (buffer.startsWith('data:')) {
        const jsonStr = buffer.slice(5).trim();
        if (jsonStr) {
          this.handleMessage(jsonStr);
        }
      }
    } catch (err) {
      if (this.closed) return;
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('error', error);
    }

    // Stream ended, reconnect
    if (!this.closed) {
      this.scheduleReconnect();
    }
  }

  private handleMessage(jsonStr: string): void {
    try {
      const msg = JSON.parse(jsonStr);

      // Connection message
      if (msg.type === 'connect' && msg.session_id) {
        this.sessionId = msg.session_id;
        this.emit('connect', msg.session_id);
        // Re-subscribe after reconnect
        if (this.subscribedContextIds.size > 0) {
          this.sendSubscription('subscribe', [...this.subscribedContextIds]);
        }
        return;
      }

      // Context event message
      if (msg.result && msg.result.contextId) {
        let eventData = msg.result.data;
        // Decode byte-array data if needed
        if (Array.isArray(eventData)) {
          try {
            const bytes = new Uint8Array(eventData);
            const text = new TextDecoder().decode(bytes);
            eventData = JSON.parse(text);
          } catch {
            // Keep raw data
          }
        }

        this.emit('event', {
          contextId: msg.result.contextId,
          data: eventData,
        });
      }
    } catch {
      // Invalid JSON, ignore
    }
  }

  async subscribe(contextIds: string[]): Promise<void> {
    for (const id of contextIds) {
      this.subscribedContextIds.add(id);
    }

    if (this.sessionId) {
      await this.sendSubscription('subscribe', contextIds);
    }
  }

  async unsubscribe(contextIds: string[]): Promise<void> {
    for (const id of contextIds) {
      this.subscribedContextIds.delete(id);
    }

    if (this.sessionId) {
      await this.sendSubscription('unsubscribe', contextIds);
    }
  }

  private async sendSubscription(method: 'subscribe' | 'unsubscribe', contextIds: string[]): Promise<void> {
    try {
      const token = await this.getAuthToken();
      const response = await fetch(`${this.baseUrl}/sse/subscription`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: this.sessionId,
          method,
          params: { contextIds },
        }),
      });
      if (!response.ok) {
        this.emit('error', new Error(`SSE ${method} failed: ${response.status}`));
      }
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(`SSE ${method} failed`));
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelayMs);
  }

  close(): void {
    this.closed = true;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.sessionId = null;
    this.subscribedContextIds.clear();
  }
}
