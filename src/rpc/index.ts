import type { HttpClient } from '../http-client';
import type { MigrateMyEntriesSummary } from '../admin-api/admin-types';

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

export class RpcClient {
  private httpClient: HttpClient;

  constructor(opts: { httpClient: HttpClient }) {
    this.httpClient = opts.httpClient;
  }

  async execute<T = unknown>(params: ExecuteParams): Promise<T> {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'execute',
      params: {
        contextId: params.contextId,
        method: params.method,
        argsJson: params.argsJson ?? {},
      },
    };

    const response = await this.httpClient.post<JsonRpcResponse>(
      '/jsonrpc',
      body,
    );

    if (response.error) {
      const err = response.error;
      const code = err.code ?? -1;
      const message = err.message ?? err.type ?? 'RPC error';
      throw new RpcError(code, message, err.data, err.type);
    }

    if (response.result && 'output' in response.result) {
      return response.result.output as T;
    }

    return response.result as T;
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
