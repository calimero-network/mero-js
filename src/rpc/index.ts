import type { HttpClient } from '../http-client/index.js';

/** Result of the owner-driven `migrate_my_entries` convert (counts are u32). */
export interface MigrateMyEntriesSummary {
  converted: number;
  remaining: number;
}

export interface ExecuteParams {
  contextId: string;
  method: string;
  argsJson?: Record<string, unknown>;
  /** @deprecated No longer used by the server. Ignored if provided. */
  executorPublicKey?: string;
}

export class RpcError extends Error {
  code: number;
  type?: string;
  data?: unknown;

  constructor(code: number, message: string, data?: unknown, type?: string) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.data = data;
    this.type = type;
  }
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: {
    output?: unknown;
    [key: string]: unknown;
  };
  error?: {
    // Standard JSON-RPC fields
    code?: number;
    message?: string;
    // Server-specific fields
    type?: string;
    data?: unknown;
  };
}

/**
 * POST a JSON-RPC call and unwrap `result`, converting an `error` payload into
 * an `RpcError`. The node returns `{ type, data }` (not always `{ code,
 * message }`), so this is the one place that normalization lives — every
 * JSON-RPC caller in this SDK shares it rather than re-deriving a bare
 * `Error(message)` and dropping the typed detail.
 */
export async function jsonRpcCall<T>(
  httpClient: HttpClient,
  method: string,
  params: unknown,
): Promise<T> {
  const response = await httpClient.post<JsonRpcResponse>('/jsonrpc', {
    jsonrpc: '2.0',
    id: 1,
    method,
    params,
  });

  if (response.error) {
    const err = response.error;
    throw new RpcError(err.code ?? -1, err.message ?? err.type ?? 'RPC error', err.data, err.type);
  }

  return response.result as T;
}

export class RpcClient {
  private httpClient: HttpClient;

  constructor(opts: { httpClient: HttpClient }) {
    this.httpClient = opts.httpClient;
  }

  async execute<T = unknown>(params: ExecuteParams): Promise<T> {
    const result = await jsonRpcCall<JsonRpcResponse['result']>(this.httpClient, 'execute', {
      contextId: params.contextId,
      method: params.method,
      argsJson: params.argsJson ?? {},
    });

    if (result && 'output' in result) {
      return result.output as T;
    }

    return result as T;
  }

  /**
   * One-tap owner-driven convert: re-signs the caller's identity-gated entries
   * to the current schema. The export converts all of the caller's
   * below-target entries in a single sweep, so this issues one call and returns
   * the resulting summary — it does not loop.
   */
  async migrateMyEntries(contextId: string): Promise<MigrateMyEntriesSummary> {
    return this.execute<MigrateMyEntriesSummary>({ contextId, method: 'migrate_my_entries' });
  }

  /** Read-only count of the caller's entries still below the target schema. */
  async countMyPending(contextId: string): Promise<number> {
    return this.execute<number>({ contextId, method: 'count_my_pending' });
  }
}
