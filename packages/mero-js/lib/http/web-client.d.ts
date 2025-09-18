import { ResponseData } from '../types/api-response';
import { HttpClient, Transport, RequestOptions } from './types';
export declare class HTTPError extends Error {
  status: number;
  statusText: string;
  body?: string | undefined;
  headers?: Headers | undefined;
  constructor(
    status: number,
    statusText: string,
    body?: string | undefined,
    headers?: Headers | undefined,
  );
}
export declare class WebHttpClient implements HttpClient {
  private transport;
  private isRefreshing;
  private failedQueue;
  constructor(transport: Transport);
  private makeRequest;
  private detectParseMode;
  private parseResponse;
  private handleTokenRefresh;
  private processQueue;
  get<T>(path: string, init?: RequestOptions): Promise<ResponseData<T>>;
  post<T>(
    path: string,
    body?: unknown,
    init?: RequestOptions,
  ): Promise<ResponseData<T>>;
  put<T>(
    path: string,
    body?: unknown,
    init?: RequestOptions,
  ): Promise<ResponseData<T>>;
  delete<T>(path: string, init?: RequestOptions): Promise<ResponseData<T>>;
  patch<T>(
    path: string,
    body?: unknown,
    init?: RequestOptions,
  ): Promise<ResponseData<T>>;
  head<T>(path: string, init?: RequestOptions): Promise<ResponseData<T>>;
  request<T>(path: string, init?: RequestOptions): Promise<ResponseData<T>>;
}
//# sourceMappingURL=web-client.d.ts.map
