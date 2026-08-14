import type { HttpClient } from '../http-client/index.js';
import type { SseClient } from '../events/index.js';
import { jsonCodec } from './codec.js';
import type { Codec, EphemeralEntry, EphemeralSnapshotEntry } from './types.js';

export { jsonCodec };
export type { Codec, EphemeralEntry, EphemeralSnapshotEntry };

interface JsonRpcResponse {
  result?: unknown;
  error?: { code?: number; message?: string; type?: string; data?: unknown };
}

/**
 * Ephemeral presence: transient, encrypted, never-persisted state (cursors,
 * typing, presence) that gossips between nodes without a WASM run or DAG
 * growth.
 *
 * The write/read asymmetry is the model, not an oversight. `set` takes no
 * author: you can only ever write your OWN slot, and the node resolves the
 * author server-side from its owned context identity — which is also why a
 * client cannot publish as somebody else. `get`/`subscribe` return everyone's
 * slots, so each carries its `author`. The store is N independent
 * single-writer registers keyed by author; there is no merge across authors.
 */
export class EphemeralClient {
  private httpClient: HttpClient;
  private sse: SseClient;

  constructor(opts: { httpClient: HttpClient; sse: SseClient }) {
    this.httpClient = opts.httpClient;
    this.sse = opts.sse;
  }

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    const response = await this.httpClient.post<JsonRpcResponse>('/jsonrpc', {
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    });
    if (response.error) {
      const err = response.error;
      throw new Error(err.message ?? err.type ?? `${method} failed`);
    }
    return response.result as T;
  }

  /** Publish your own presence slice, replacing it wholesale. */
  async set<T>(contextId: string, state: T, codec: Codec<T> = jsonCodec<T>()): Promise<void> {
    await this.rpc<Record<string, never>>('set_ephemeral', {
      contextId,
      state: codec.encode(state),
    });
  }

  /** Snapshot every live entry for a context. */
  async get<T>(
    contextId: string,
    codec: Codec<T> = jsonCodec<T>(),
  ): Promise<EphemeralSnapshotEntry<T>[]> {
    const result = await this.rpc<{ entries?: Record<string, { state: number[]; ageMs: number }> }>(
      'get_ephemeral',
      { contextId },
    );
    const entries = result?.entries ?? {};
    return Object.entries(entries).map(([author, value]) => ({
      author,
      state: codec.decode(value.state),
      ageMs: value.ageMs,
    }));
  }

  /**
   * Observe presence changes for a context.
   *
   * This adds NO transport — it is a typed filter over the existing SSE event
   * stream, which already carries `{ contextId, type, data }`. Returns an
   * unsubscribe function.
   */
  subscribe<T>(
    contextId: string,
    handler: (entry: EphemeralEntry<T>) => void,
    codec: Codec<T> = jsonCodec<T>(),
  ): () => void {
    const listener = (event: unknown): void => {
      const e = event as { contextId?: string; type?: string; data?: unknown };
      if (e.type !== 'Ephemeral' || e.contextId !== contextId) return;

      const data = e.data as { author?: string; state?: number[]; removed?: boolean } | undefined;
      if (!data?.author) return;

      // `removed` is omitted on an upsert, so normalize to a boolean here and
      // spare every caller the truthiness rule.
      const removed = Boolean(data.removed);
      handler({
        author: data.author,
        state: removed || data.state === undefined ? undefined : codec.decode(data.state),
        removed,
      });
    };

    this.sse.on('event', listener);
    // Errors surface via the SSE client's own 'error' event; nothing more to
    // do with them here.
    void this.sse.connect().catch(() => undefined);
    void this.sse.subscribe([contextId]).catch(() => undefined);

    return () => {
      this.sse.off('event', listener);
    };
  }
}
