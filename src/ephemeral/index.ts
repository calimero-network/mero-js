import type { HttpClient } from '../http-client/index.js';
import type { SseClient } from '../events/index.js';
import { jsonRpcCall } from '../rpc/index.js';
import { jsonCodec } from './codec.js';
import type { Codec, EphemeralEntry } from './types.js';

export { jsonCodec };
export type { Codec, EphemeralEntry };

/**
 * Ephemeral presence: transient, encrypted, never-persisted state (cursors,
 * typing, presence) that gossips between nodes without a WASM run or DAG
 * growth.
 *
 * The write/read asymmetry is the model, not an oversight. `set` takes no
 * author: you can only ever write your OWN slot, and the node resolves the
 * author server-side from its owned context identity — which is also why a
 * client cannot publish as somebody else. `subscribe` returns everyone's
 * slots, so each carries its `author`. The store is N independent
 * single-writer registers keyed by author; there is no merge across authors.
 *
 * There is a single read path: `subscribe`. On subscribing to a context, the
 * node replays that context's current presence to this connection as
 * ordinary `Ephemeral` events (carrying `ageMs`), before any live deltas
 * (which carry no `ageMs`). There is no separate snapshot RPC.
 */
export class EphemeralClient {
  private httpClient: HttpClient;
  private sse: SseClient;

  constructor(opts: { httpClient: HttpClient; sse: SseClient }) {
    this.httpClient = opts.httpClient;
    this.sse = opts.sse;
  }

  /**
   * Publish your own presence slice, replacing it wholesale.
   *
   * Rejects with an `RpcError` (not a bare `Error`), so a typed failure such as
   * an oversized slice keeps its `type` and `data` — e.g. `SliceTooLarge` with
   * the offending size — and is `instanceof RpcError` like every other RPC in
   * this SDK.
   */
  async set<T>(contextId: string, state: T, codec: Codec<T> = jsonCodec<T>()): Promise<void> {
    await jsonRpcCall<Record<string, never>>(this.httpClient, 'set_ephemeral', {
      contextId,
      state: codec.encode(state),
    });
  }

  /**
   * Observe presence changes for a context.
   *
   * This adds NO transport — it is a typed filter over the existing SSE event
   * stream, which already carries `{ contextId, type, data }`. On subscribing,
   * the node replays that context's current presence to this connection as
   * ordinary `Ephemeral` events before any live deltas; a replayed entry
   * carries `ageMs`, a live delta does not (never synthesized as `0` — absent
   * and zero mean different things). Returns an unsubscribe function.
   */
  subscribe<T>(
    contextId: string,
    handler: (entry: EphemeralEntry<T>) => void,
    codec: Codec<T> = jsonCodec<T>(),
  ): () => void {
    const listener = (event: unknown): void => {
      const e = event as { contextId?: string; type?: string; data?: unknown };
      if (e.type !== 'Ephemeral' || e.contextId !== contextId) return;

      const data = e.data as
        | { author?: string; state?: number[]; removed?: boolean; ageMs?: number }
        | undefined;
      if (!data?.author) return;

      // `removed` is omitted on an upsert, so normalize to a boolean here and
      // spare every caller the truthiness rule.
      const removed = Boolean(data.removed);
      const entry: EphemeralEntry<T> = {
        author: data.author,
        state: removed || data.state === undefined ? undefined : codec.decode(data.state),
        removed,
      };
      // `ageMs` is present only on a replayed seed entry; pass it through as-is
      // rather than defaulting a live delta to 0.
      if (data.ageMs !== undefined) entry.ageMs = data.ageMs;
      handler(entry);
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
