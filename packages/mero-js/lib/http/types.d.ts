import { ResponseData } from '../types/api-response';
export type FetchLike = (input: RequestInfo, init?: RequestInit) => Promise<Response>;
export interface Transport {
    fetch: FetchLike;
    baseUrl: string;
    defaultHeaders?: Record<string, string>;
    getAuthToken?: () => Promise<string | undefined>;
    onTokenRefresh?: (newToken: string) => Promise<void>;
    timeoutMs?: number;
    credentials?: RequestCredentials;
    defaultAbortSignal?: AbortSignal;
}
export type ResponseParser = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'response';
export interface RequestOptions extends RequestInit {
    parse?: ResponseParser;
    timeoutMs?: number;
}
export interface HttpClient {
    get<T>(path: string, init?: RequestOptions): Promise<ResponseData<T>>;
    post<T>(path: string, body?: unknown, init?: RequestOptions): Promise<ResponseData<T>>;
    put<T>(path: string, body?: unknown, init?: RequestOptions): Promise<ResponseData<T>>;
    delete<T>(path: string, init?: RequestOptions): Promise<ResponseData<T>>;
    patch<T>(path: string, body?: unknown, init?: RequestOptions): Promise<ResponseData<T>>;
    head<T>(path: string, init?: RequestOptions): Promise<ResponseData<T>>;
    request<T>(path: string, init?: RequestOptions): Promise<ResponseData<T>>;
}
export interface Header {
    [key: string]: string;
}
export interface ProgressCallback {
    (progress: number): void;
}
export interface HeadResponse {
    headers: Record<string, string>;
    status: number;
}
export interface RequestOptions {
    responseType?: 'arraybuffer' | 'blob' | 'json';
}
//# sourceMappingURL=types.d.ts.map