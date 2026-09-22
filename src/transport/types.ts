/**
 * One call shape, two ways of getting there.
 *
 * # Why the node shape is the canonical one
 *
 * `RpcClient.execute({ contextId, method, argsJson })` is what every app in the
 * fleet already writes, and `RelayClient.execute(contextId, method, argsJson)`
 * is what the delegated path grew independently. They differ in *both* halves —
 * positional vs. named arguments, and `T` vs. `IntentResult<T>`. A caller that
 * wanted to switch transports therefore had to rewrite every call site, which
 * makes the transport a property of the application rather than of the
 * connection.
 *
 * This interface closes that by declaring the node's shape the contract and
 * adapting the relay to it. The direction is deliberate and not symmetric:
 * shipped code uses the node shape, so any other choice would be a breaking
 * change dressed up as an abstraction.
 *
 * # What is NOT on this interface, and why that is the honest answer
 *
 * Subscription is not here. A node serves `/sse` and `/ws` to a credential it
 * issued; a relay serves exactly two routes without one — `GET` and `POST
 * /admin-api/contexts/:id/intents` — and nothing else. There is no relay event
 * stream to adapt, so putting `subscribe` on this interface would force every
 * relay implementation to either throw from a method the type promises or
 * quietly open a connection to some *other* node, which is worse: the app would
 * observe a node it never chose. See {@link ExecuteTransport.canSubscribe} —
 * the capability is reported as data so an app can branch on it, rather than
 * discovered by a method that fails.
 */

import type { ExecuteParams, MigrateMyEntriesSummary } from '../rpc/index.js';

/** Which path a write takes. `'node'` is the default everywhere. */
export type TransportKind = 'node' | 'relay';

/**
 * A method's return value plus whatever the transport knew about the write.
 *
 * The canonical `execute` returns `T` and nothing else, because that is what
 * every existing call site expects. The relay, though, also learns the
 * context's scope root after the run — the one cheap way to tell "this changed
 * something" from "this was a no-op" — and discarding it to fit the node shape
 * would lose information the node genuinely does not have.
 *
 * So it is carried here, on a second method, rather than on a mutable
 * `lastIntent` accessor. That alternative was rejected on purpose: two
 * `execute` calls in flight at once would race for the same slot, and the
 * caller reading it has no way to tell whose answer it got.
 */
export interface ExecuteResult<T = unknown> {
  /** Exactly what `execute` would have returned. */
  returns: T;
  /** Which transport ran it. */
  transport: TransportKind;
  /**
   * The context's scope root after the run, hex — relay only.
   *
   * Absent on the node transport because JSON-RPC `execute` does not report it,
   * not because it was dropped. `undefined` therefore means "unknown here", and
   * must never be read as "nothing changed".
   */
  rootHash?: string;
}

/**
 * The write surface an app codes against, whichever transport is underneath.
 *
 * `RpcClient` satisfies this as-is — that is the point of picking its shape —
 * so an app already holding one is already holding an `ExecuteTransport`.
 */
export interface ExecuteTransport {
  /** Which path this is. Useful for diagnostics and for feature-gating UI. */
  readonly kind: TransportKind;

  /**
   * Whether this transport can observe events at all.
   *
   * Reported rather than attempted: `false` means the transport has no event
   * stream, and an app that needs one has to get it from a node connection it
   * chose for itself. Nothing here will silently pick one.
   */
  readonly canSubscribe: boolean;

  /** Run one method in one context. The canonical signature. */
  execute<T = unknown>(params: ExecuteParams): Promise<T>;

  /**
   * The same call, with whatever the transport knows about the write.
   *
   * Use it when the extra metadata matters; `execute` stays the one an app
   * reaches for, so that switching transports changes no call site.
   */
  executeWithMetadata<T = unknown>(params: ExecuteParams): Promise<ExecuteResult<T>>;

  /** One-tap owner-driven convert. See `RpcClient.migrateMyEntries`. */
  migrateMyEntries(contextId: string): Promise<MigrateMyEntriesSummary>;

  /** Read-only count of the caller's entries still below the target schema. */
  countMyPending(contextId: string): Promise<number>;
}
