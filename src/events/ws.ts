import type { GroupMembershipEventData } from './group';

export type { GroupMembershipEventData };

export interface WsEventData {
  contextId: string;
  /** The context-event discriminator (core serializes it as a sibling of
   * `data`, e.g. `"AppVersionChanged"`). Undefined for events without a tag. */
  type?: string;
  data: unknown;
}

type WsEventHandler = (event: WsEventData | GroupMembershipEventData) => void;
type WsConnectHandler = () => void;
type WsErrorHandler = (error: Error) => void;

interface WsListeners {
  connect: WsConnectHandler[];
  event: WsEventHandler[];
  error: WsErrorHandler[];
}

/**
 * @experimental WebSocket event client. The SSE client (`SseClient`) is the
 * recommended transport for production — use `MeroJs.events` instead of `MeroJs.ws`.
 */
export class WsClient {
  private baseUrl: string;
  private getAuthToken: () => Promise<string>;
  private ws: WebSocket | null = null;
  private closed = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private subscribedContextIds: Set<string> = new Set();
  private subscribedGroupIds: Set<string> = new Set();
  private listeners: WsListeners = { connect: [], event: [], error: [] };

  private static readonly MAX_BACKOFF_MS = 30000;

  constructor(opts: {
    baseUrl: string;
    getAuthToken: () => Promise<string>;
  }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.getAuthToken = opts.getAuthToken;
  }

  on(event: 'connect', handler: WsConnectHandler): void;
  on(event: 'event', handler: WsEventHandler): void;
  on(event: 'error', handler: WsErrorHandler): void;
  on(event: string, handler: WsConnectHandler | WsEventHandler | WsErrorHandler): void {
    const key = event as keyof WsListeners;
    if (key in this.listeners) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arr = this.listeners[key] as any[];
      if (!arr.includes(handler)) arr.push(handler);
    }
  }

  off(event: 'connect', handler: WsConnectHandler): void;
  off(event: 'event', handler: WsEventHandler): void;
  off(event: 'error', handler: WsErrorHandler): void;
  off(event: string, handler: WsConnectHandler | WsEventHandler | WsErrorHandler): void {
    const key = event as keyof WsListeners;
    if (key in this.listeners) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arr = this.listeners[key] as any[];
      const idx = arr.indexOf(handler);
      if (idx !== -1) arr.splice(idx, 1);
    }
  }

  private emit(event: 'connect'): void;
  private emit(event: 'event', data: WsEventData | GroupMembershipEventData): void;
  private emit(event: 'error', error: Error): void;
  private emit(event: string, arg?: WsEventData | GroupMembershipEventData | Error): void {
    const key = event as keyof WsListeners;
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
    if (this.ws && (this.ws.readyState === 0 /* CONNECTING */ || this.ws.readyState === 1 /* OPEN */)) {
      return;
    }
    this.closed = false;

    try {
      const token = await this.getAuthToken();
      if (!token) {
        throw new Error('No authentication token available for WebSocket connection');
      }
      // Browser WebSocket API can't set headers, use query param
      const wsUrl = this.baseUrl.replace(/^http/, 'ws');
      this.ws = new WebSocket(`${wsUrl}/ws?token=${encodeURIComponent(token)}`);

      this.ws.onopen = () => {
        this.reconnectAttempt = 0;
        this.emit('connect');
        this.resubscribeAfterReconnect();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = () => {
        this.emit('error', new Error('WebSocket error'));
      };

      this.ws.onclose = () => {
        if (!this.closed) {
          this.scheduleReconnect();
        }
      };
    } catch (err) {
      if (this.closed) return;
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('error', error);
      this.scheduleReconnect();
    }
  }

  private handleMessage(raw: string | ArrayBuffer | Blob): void {
    if (typeof raw !== 'string') return;

    try {
      const msg = JSON.parse(raw);

      if (!msg.result) return;

      let eventData = msg.result.data;
      if (Array.isArray(eventData)) {
        try {
          const bytes = new Uint8Array(eventData);
          const text = new TextDecoder().decode(bytes);
          eventData = JSON.parse(text);
        } catch {
          // Keep raw data
        }
      }

      if (msg.result.contextId) {
        this.emit('event', {
          contextId: msg.result.contextId,
          // Forward the event tag (sibling of `data` in core's flattened
          // payload) so consumers can discriminate, matching `SseClient`.
          type: msg.result.type,
          data: eventData,
        });
        return;
      }

      // Group-membership event message (untagged NodeEvent's group variant)
      if (msg.result.groupId) {
        this.emit('event', {
          groupId: msg.result.groupId,
          type: msg.result.type,
          data: eventData,
        });
      }
    } catch {
      // Invalid JSON, ignore
    }
  }

  subscribe(idsOrOpts: string[] | { contextIds?: string[]; groupIds?: string[] }): void {
    const opts = Array.isArray(idsOrOpts) ? { contextIds: idsOrOpts } : idsOrOpts;
    for (const id of opts.contextIds ?? []) {
      this.subscribedContextIds.add(id);
    }
    for (const id of opts.groupIds ?? []) {
      this.subscribedGroupIds.add(id);
    }

    if (this.ws && this.ws.readyState === 1 /* OPEN */) {
      this.sendMessage({
        id: null,
        method: 'subscribe',
        params: this.buildSubscriptionParams(opts.contextIds ?? [], opts.groupIds ?? []),
      });
    }
  }

  unsubscribe(idsOrOpts: string[] | { contextIds?: string[]; groupIds?: string[] }): void {
    const opts = Array.isArray(idsOrOpts) ? { contextIds: idsOrOpts } : idsOrOpts;
    for (const id of opts.contextIds ?? []) {
      this.subscribedContextIds.delete(id);
    }
    for (const id of opts.groupIds ?? []) {
      this.subscribedGroupIds.delete(id);
    }

    if (this.ws && this.ws.readyState === 1 /* OPEN */) {
      this.sendMessage({
        id: null,
        method: 'unsubscribe',
        params: this.buildSubscriptionParams(opts.contextIds ?? [], opts.groupIds ?? []),
      });
    }
  }

  private resubscribeAfterReconnect(): void {
    if (this.subscribedContextIds.size === 0 && this.subscribedGroupIds.size === 0) return;
    this.sendMessage({
      id: null,
      method: 'subscribe',
      params: this.buildSubscriptionParams([...this.subscribedContextIds], [...this.subscribedGroupIds]),
    });
  }

  private buildSubscriptionParams(
    contextIds: string[],
    groupIds: string[],
  ): { contextIds?: string[]; groupIds?: string[] } {
    const params: { contextIds?: string[]; groupIds?: string[] } = {};
    if (contextIds.length > 0) params.contextIds = contextIds;
    if (groupIds.length > 0) params.groupIds = groupIds;
    return params;
  }

  private sendMessage(msg: unknown): void {
    if (this.ws && this.ws.readyState === 1 /* OPEN */) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempt),
      WsClient.MAX_BACKOFF_MS,
    );
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.subscribedContextIds.clear();
    this.subscribedGroupIds.clear();
  }
}
