import type { HttpClient } from '../http-client/index.js';
import type { SseClient } from '../events/index.js';
import { jsonRpcCall } from '../rpc/index.js';
import { jsonCodec } from './codec.js';
import type { Codec, EphemeralEntry, EphemeralSnapshotEntry } from './types.js';

export { jsonCodec };
export type { Codec, EphemeralEntry, EphemeralSnapshotEntry };

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
   * Snapshot every live entry for a context.
   *
   * An entry that fails to decode is SKIPPED, not fatal: presence slices are
   * per-author and independent, so one peer publishing a slice this codec
   * cannot read must not blank the whole roster (which, with only a low-rate
   * reconciliation to recover, could persist).
   */
  async get<T>(
    contextId: string,
    codec: Codec<T> = jsonCodec<T>(),
  ): Promise<EphemeralSnapshotEntry<T>[]> {
    const result = await jsonRpcCall<{
      entries?: Record<string, { state: number[]; ageMs: number }>;
    }>(this.httpClient, 'get_ephemeral', { contextId });
    const entries = result?.entries ?? {};
    const decoded: EphemeralSnapshotEntry<T>[] = [];
    for (const [author, value] of Object.entries(entries)) {
      try {
        decoded.push({ author, state: codec.decode(value.state), ageMs: value.ageMs });
      } catch {
        // Undecodable slice from one peer — drop that peer, keep the rest.
      }
    }
    return decoded;
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
