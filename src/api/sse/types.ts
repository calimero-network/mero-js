/**
 * SSE Types
 * Based on OpenAPI spec: /sse endpoints
 */

export interface SseSubscriptionRequest {
  /** Session ID from connect event */
  id: string;
  method: 'subscribe' | 'unsubscribe';
  params: {
    contextIds: string[];
  };
}

export interface SseSubscriptionResponse {
  data?: {
    subscribedContextIds?: string[];
    unsubscribedContextIds?: string[];
  };
  error?: string;
}

export interface SseSessionResponse {
  data?: {
    sessionId: string;
    subscribedContextIds: string[];
    connectedAt: string;
  };
  error?: string;
}

export interface SseEvent {
  id?: string;
  event: string;
  data: unknown;
}

export type SseEventHandler = (event: SseEvent) => void;
export type SseErrorHandler = (error: Error) => void;
