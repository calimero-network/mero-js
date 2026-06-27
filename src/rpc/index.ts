import type { HttpClient } from '../http-client';

/** Result of the owner-driven `migrate_my_entries` convert (counts are u32). */
export interface MigrateMyEntriesSummary {
  converted: number;
  remaining: number;
}

export interface ExecuteParams {
  contextId: string;
  method: string;
  argsJson?: Record<string, unknown>;
  /**
   * Alias substitutions applied to the call (core `substitute: Vec<Alias>`):
   * each entry is an alias name resolved to a public key server-side. Omit when
   * not using aliases.
   */
  substitute?: string[];
  /** @deprecated No longer used by the server. Ignored if provided. */
  executorPublicKey?: string;
}

/**
 * Coarse state-sync phase, internally tagged on `state` (mirrors core's
 * `SyncState`). Data-carrying variants add their fields alongside the tag.
 */
export type SyncState =
  | { state: 'idle' }
  | { state: 'waitingForPeers' }
  | { state: 'syncing' }
  | {
      state: 'receivingSnapshot';
      recordsReceived: number;
      percent?: number;
      etaSecs?: number;
    }
  | { state: 'backingOff'; retryInSecs: number };

/** Response of the `sync_status` JSON-RPC method. */
export interface SyncStatus {
  contextId: string;
  /** `true` once the context has adopted initial state (`execute` no longer returns `Uninitialized`). */
  isInitialized: boolean;
  syncState: SyncState;
  /** Consecutive failed sync attempts (0 when healthy). */
  failureCount: number;
  /** Most recent sync error, when the last attempt failed. */
  lastError?: string;
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
        // Omit when unused — core defaults `substitute` to an empty list.
        ...(params.substitute ? { substitute: params.substitute } : {}),
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

  /**
   * Query a context's state-sync status. Lets a client that hit `Uninitialized`
   * on `execute` tell whether sync is running, waiting for a peer, or wedged —
   * instead of guessing from one opaque error.
   */
  async syncStatus(contextId: string): Promise<SyncStatus> {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'sync_status',
      params: { contextId },
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

    // sync_status returns the response object directly (no `output` wrapper).
    return response.result as unknown as SyncStatus;
  }
}
