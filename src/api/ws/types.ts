/**
 * WebSocket Types
 * Based on OpenAPI spec: /ws endpoint
 */

export interface SubscribeParams {
  contextIds: string[];
}

export interface UnsubscribeParams {
  contextIds: string[];
}

export interface WebSocketRequest {
  id: number | null;
  method: 'subscribe' | 'unsubscribe';
  params: SubscribeParams | UnsubscribeParams;
}

export interface WebSocketResponse {
  id: number | null;
  result?: unknown;
  error?: {
    type: string;
    data?: string | Record<string, unknown>;
  };
}

export interface WebSocketEvent {
  contextId: string;
  type: string;
  data: unknown;
}

export type WebSocketEventHandler = (event: WebSocketEvent) => void;
export type WebSocketErrorHandler = (error: Error) => void;
export type WebSocketCloseHandler = (code: number, reason: string) => void;
