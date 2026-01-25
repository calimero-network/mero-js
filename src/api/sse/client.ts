/**
 * SSE Client
 *
 * Server-Sent Events for real-time event streaming.
 * Uses standard EventSource with manual subscription management.
 */

import type { HttpClient } from '../../http-client';
import type {
  SseSubscriptionRequest,
  SseSubscriptionResponse,
  SseSessionResponse,
  SseEvent,
  SseEventHandler,
  SseErrorHandler,
} from './types';

export interface SseClientOptions {
  /** Base URL */
  baseUrl: string;
  /** HTTP client for subscription requests */
  httpClient: HttpClient;
  /** Function to get current auth token */
  getAuthToken?: () => Promise<string | null>;
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;
  /** Reconnect delay in ms */
  reconnectDelay?: number;
}

export class SseClient {
  private eventSource: EventSource | null = null;
  private options: Required<SseClientOptions>;
  private sessionId: string | null = null;
  private eventHandlers: SseEventHandler[] = [];
  private errorHandlers: SseErrorHandler[] = [];
  private subscribedContexts = new Set<string>();
  // Track last event ID for reconnection (used for resumable streams)
  private _lastEventId: string | null = null;

  constructor(options: SseClientOptions) {
    this.options = {
      autoReconnect: true,
      reconnectDelay: 1000,
      getAuthToken: async () => null,
      ...options,
    };
  }

  /**
   * Connect to the SSE stream
   */
  async connect(): Promise<string> {
    if (this.eventSource) {
      throw new Error('Already connected');
    }

    const token = await this.options.getAuthToken();
    let url = `${this.options.baseUrl}/sse`;
    
    if (token) {
      url += `?token=${encodeURIComponent(token)}`;
    }

    return new Promise((resolve, reject) => {
      this.eventSource = new EventSource(url, {
        withCredentials: true,
      });

      // Handle connect event (first event with session_id)
      this.eventSource.addEventListener('connect', (event) => {
        const messageEvent = event as MessageEvent;
        try {
          // Session ID may be in data or as plain string
          const data = messageEvent.data;
          this.sessionId = typeof data === 'string' && data.startsWith('{') 
            ? JSON.parse(data).session_id || JSON.parse(data).sessionId
            : data;
          resolve(this.sessionId!);
        } catch {
          this.sessionId = messageEvent.data;
          resolve(this.sessionId!);
        }
      });

      this.eventSource.onmessage = (event) => {
        this._lastEventId = event.lastEventId;
        try {
          const data = JSON.parse(event.data);
          const sseEvent: SseEvent = {
            id: event.lastEventId,
            event: 'message',
            data,
          };
          this.eventHandlers.forEach(h => h(sseEvent));
        } catch {
          // Non-JSON message
          const sseEvent: SseEvent = {
            id: event.lastEventId,
            event: 'message',
            data: event.data,
          };
          this.eventHandlers.forEach(h => h(sseEvent));
        }
      };

      this.eventSource.onerror = (_event) => {
        const error = new Error('SSE connection error');
        this.errorHandlers.forEach(h => h(error));
        
        if (this.eventSource?.readyState === EventSource.CLOSED) {
          this.handleDisconnect();
          if (!this.sessionId) {
            reject(error);
          }
        }
      };
    });
  }

  /**
   * Disconnect from the SSE stream
   */
  disconnect(): void {
    this.options.autoReconnect = false;
    this.eventSource?.close();
    this.eventSource = null;
    this.sessionId = null;
    this.subscribedContexts.clear();
  }

  /**
   * Subscribe to context events
   */
  async subscribe(contextIds: string[]): Promise<SseSubscriptionResponse> {
    if (!this.sessionId) {
      throw new Error('Not connected');
    }

    const request: SseSubscriptionRequest = {
      id: this.sessionId,
      method: 'subscribe',
      params: { contextIds },
    };

    const response = await this.options.httpClient.post<SseSubscriptionResponse>(
      '/sse/subscription',
      request,
    );

    if (!response.error) {
      contextIds.forEach(id => this.subscribedContexts.add(id));
    }

    return response;
  }

  /**
   * Unsubscribe from context events
   */
  async unsubscribe(contextIds: string[]): Promise<SseSubscriptionResponse> {
    if (!this.sessionId) {
      throw new Error('Not connected');
    }

    const request: SseSubscriptionRequest = {
      id: this.sessionId,
      method: 'unsubscribe',
      params: { contextIds },
    };

    const response = await this.options.httpClient.post<SseSubscriptionResponse>(
      '/sse/subscription',
      request,
    );

    if (!response.error) {
      contextIds.forEach(id => this.subscribedContexts.delete(id));
    }

    return response;
  }

  /**
   * Get session information
   */
  async getSession(): Promise<SseSessionResponse> {
    if (!this.sessionId) {
      throw new Error('Not connected');
    }

    return this.options.httpClient.get<SseSessionResponse>(
      `/sse/session/${this.sessionId}`,
    );
  }

  /**
   * Add event handler
   */
  onEvent(handler: SseEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      this.eventHandlers = this.eventHandlers.filter(h => h !== handler);
    };
  }

  /**
   * Add error handler
   */
  onError(handler: SseErrorHandler): () => void {
    this.errorHandlers.push(handler);
    return () => {
      this.errorHandlers = this.errorHandlers.filter(h => h !== handler);
    };
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.eventSource?.readyState === EventSource.OPEN;
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Get subscribed context IDs
   */
  getSubscribedContexts(): string[] {
    return Array.from(this.subscribedContexts);
  }

  /**
   * Get the last event ID (useful for resumable connections)
   */
  getLastEventId(): string | null {
    return this._lastEventId;
  }

  private handleDisconnect(): void {
    if (!this.options.autoReconnect) {
      return;
    }

    setTimeout(async () => {
      try {
        await this.connect();
        // Resubscribe to previous contexts
        if (this.subscribedContexts.size > 0) {
          await this.subscribe(Array.from(this.subscribedContexts));
        }
      } catch {
        // Will retry via handleDisconnect on next error
      }
    }, this.options.reconnectDelay);
  }
}
