/** Encoding for a presence slice. The node never deserializes it — the wire
 * encoding is chosen client-side and travels client-to-client. */
export interface Codec<T> {
  encode(value: T): number[];
  decode(bytes: number[]): T;
}

/** One entry from a `get` snapshot. `state` and `ageMs` are always present. */
export interface EphemeralSnapshotEntry<T> {
  /** Context member public key — a DEVICE key, not an account id. */
  author: string;
  state: T;
  /** Milliseconds since this author was last heard from, measured on the node.
   * Relative, so no clock agreement between machines is needed. Bounded above
   * by the node's 7s presence TTL. */
  ageMs: number;
}

/** One delta from `subscribe`. Carries no age — a delta is fresh at receipt.
 * `state` is absent on a removal; `removed` is ABSENT (not false) on an upsert. */
export interface EphemeralEntry<T> {
  author: string;
  state?: T;
  removed?: boolean;
}
