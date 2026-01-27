/**
 * WebSocket Client
 *
 * Real-time event subscriptions via WebSocket.
 * Events are pushed from server to client.
 * For queries/mutations, use the JSON-RPC endpoint.
 */

import type {
  WebSocketRequest,
  WebSocketResponse,
  WebSocketEvent,
  WebSocketEventHandler,
  WebSocketErrorHandler,
  WebSocketCloseHandler,
} from './types';

export interface WebSocketClientOptions {
  /** Base URL (will be converted to ws:// or wss://) */
  baseUrl: string;
  /** Function to get current auth token */
  getAuthToken?: () => Promise<string | null>;
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;
  /** Reconnect delay in ms */
  reconnectDelay?: number;
  /** Max reconnect attempts */
  maxReconnectAttempts?: number;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private options: Required<WebSocketClientOptions>;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: WebSocketResponse) => void;
    reject: (error: Error) => void;
  }>();
  private eventHandlers: WebSocketEventHandler[] = [];
  private errorHandlers: WebSocketErrorHandler[] = [];
  private closeHandlers: WebSocketCloseHandler[] = [];
  private reconnectAttempts = 0;
  private subscribedContexts = new Set<string>();

  constructor(options: WebSocketClientOptions) {
    this.options = {
      autoReconnect: true,
      reconnectDelay: 1000,
      maxReconnectAttempts: 5,
      getAuthToken: async () => null,
      ...options,
    };
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    const wsUrl = this.options.baseUrl
      .replace(/^http:/, 'ws:')
      .replace(/^https:/, 'wss:')
      .replace(/\/$/, '') + '/ws';

    const token = await this.options.getAuthToken();

    return new Promise((resolve, reject) => {
      // Note: Browser WebSocket doesn't support custom headers
      // Token is passed via query param or subprotocol
      const url = token ? `${wsUrl}?token=${encodeURIComponent(token)}` : wsUrl;
      
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        resolve();
      };

      this.ws.onerror = (_event) => {
        const error = new Error('WebSocket error');
        this.errorHandlers.forEach(h => h(error));
        reject(error);
      };

      this.ws.onclose = (event) => {
        this.closeHandlers.forEach(h => h(event.code, event.reason));
        this.handleDisconnect();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };
    });
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    this.options.autoReconnect = false;
    this.ws?.close();
    this.ws = null;
    this.subscribedContexts.clear();
  }

  /**
   * Subscribe to context events
   */
  async subscribe(contextIds: string[]): Promise<WebSocketResponse> {
    const response = await this.send({
      id: ++this.requestId,
      method: 'subscribe',
      params: { contextIds },
    });
    
    if (!response.error) {
      contextIds.forEach(id => this.subscribedContexts.add(id));
    }
    
    return response;
  }

  /**
   * Unsubscribe from context events
   */
  async unsubscribe(contextIds: string[]): Promise<WebSocketResponse> {
    const response = await this.send({
      id: ++this.requestId,
      method: 'unsubscribe',
      params: { contextIds },
    });
    
    if (!response.error) {
      contextIds.forEach(id => this.subscribedContexts.delete(id));
    }
    
    return response;
  }

  /**
   * Add event handler
   */
  onEvent(handler: WebSocketEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      this.eventHandlers = this.eventHandlers.filter(h => h !== handler);
    };
  }

  /**
   * Add error handler
   */
  onError(handler: WebSocketErrorHandler): () => void {
    this.errorHandlers.push(handler);
    return () => {
      this.errorHandlers = this.errorHandlers.filter(h => h !== handler);
    };
  }

  /**
   * Add close handler
   */
  onClose(handler: WebSocketCloseHandler): () => void {
    this.closeHandlers.push(handler);
    return () => {
      this.closeHandlers = this.closeHandlers.filter(h => h !== handler);
    };
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get subscribed context IDs
   */
  getSubscribedContexts(): string[] {
    return Array.from(this.subscribedContexts);
  }

  private async send(request: WebSocketRequest): Promise<WebSocketResponse> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    return new Promise((resolve, reject) => {
      const id = request.id;
      if (id !== null) {
        this.pendingRequests.set(id, { resolve, reject });
      }

      this.ws!.send(JSON.stringify(request));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (id !== null && this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('WebSocket request timeout'));
        }
      }, 30000);
    });
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // Check if it's a response to a request
      if (message.id !== undefined && this.pendingRequests.has(message.id)) {
        const { resolve } = this.pendingRequests.get(message.id)!;
        this.pendingRequests.delete(message.id);
        resolve(message as WebSocketResponse);
        return;
      }

      // Otherwise it's an event
      const event: WebSocketEvent = {
        contextId: message.contextId || message.context_id,
        type: message.type || message.event,
        data: message.data || message.payload,
      };
      this.eventHandlers.forEach(h => h(event));
    } catch (error) {
      this.errorHandlers.forEach(h => h(error instanceof Error ? error : new Error(String(error))));
    }
  }

  private handleDisconnect(): void {
    if (!this.options.autoReconnect) {
      return;
    }

    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.errorHandlers.forEach(h => h(new Error('Max reconnect attempts reached')));
      return;
    }

    this.reconnectAttempts++;
    const delay = this.options.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    setTimeout(async () => {
      try {
        await this.connect();
        // Resubscribe to previous contexts
        if (this.subscribedContexts.size > 0) {
          await this.subscribe(Array.from(this.subscribedContexts));
        }
      } catch {
        // Will retry via handleDisconnect
      }
    }, delay);
  }
}
