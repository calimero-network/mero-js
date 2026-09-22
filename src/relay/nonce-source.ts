/**
 * Where a warrant's nonce comes from.
 *
 * # Why this is a named concept and not a counter in the relay client
 *
 * A warrant's nonce is spent, once, per `(context, author device)` on every
 * node that applies the delta. So the sequence a client emits is not a local
 * detail — it is state the network remembers, and the client is the only party
 * that can keep it.
 *
 * The receiving ledger is a **sliding window** 64 wide, not a high-water mark,
 * which is what makes the two failure modes so different:
 *
 * - **Skipping** numbers is free. Gossip gives no ordering, so the window
 *   exists precisely to accept whatever unseen nonce arrives.
 * - **Restarting** the sequence is fatal. A tab that reloads and resumes at `1`
 *   re-presents nonces the network has already spent, and every one of those
 *   writes is refused as a replay — indistinguishable, to the user, from the
 *   app silently not saving.
 *
 * That asymmetry is why persistence is the default here and an in-memory source
 * is the one you have to ask for. It is also why a source may jump: reserving a
 * block and losing the tail is the correct trade.
 */

import type { WarrantNonceState } from '../admin-api/admin-types.js';

/** Produces the next nonce for one author device. Must never go backwards. */
export interface NonceSource {
  next(): Promise<bigint>;
  /**
   * Raise the floor of the sequence to `floor`, if this source can record it.
   *
   * Optional, and additive: a source that does not implement it still works
   * everywhere a `NonceSource` is taken, and {@link createRecoveringNonceSource}
   * keeps the floor itself in that case. Implementing it is what lets a
   * *persistent* source remember a jump, so a later cold start that cannot
   * reach a node resumes above the mark rather than below it.
   *
   * Never lowers: a smaller `floor` than the source's own position is ignored.
   */
  advanceTo?(floor: bigint): Promise<void>;
}

/**
 * A counter in memory, starting at `start`.
 *
 * Correct only for a process whose lifetime is the whole sequence — a script, a
 * server-side worker that owns its own device key, a test. In a browser tab it
 * resets on reload and replays; use {@link createLocalStorageNonceSource}
 * there.
 */
export function createMemoryNonceSource(start: number | bigint = 1): NonceSource {
  let next = BigInt(start);
  if (next < 1n) {
    throw new Error('nonce sequence starts at 1');
  }
  return {
    next(): Promise<bigint> {
      const value = next;
      next += 1n;
      return Promise.resolve(value);
    },
    advanceTo(floor: bigint): Promise<void> {
      if (floor > next) next = floor;
      return Promise.resolve();
    },
  };
}

/**
 * A counter persisted in `localStorage`, so a reload continues the sequence.
 *
 * Key it per author **device**, not per account: two devices of one account are
 * independent replicas with independent sequences, and sharing a counter would
 * have them refusing each other's warrants.
 *
 * **Reserve-then-hand-out.** The stored value is advanced *before* the nonce is
 * returned, so a crash between the two loses a number rather than reusing one.
 * Losing a number costs nothing (the window accepts gaps); reusing one costs a
 * write.
 *
 * Concurrent tabs are the case this cannot fully solve, because `localStorage`
 * has no atomic read-modify-write. Two tabs racing can hand out the same nonce,
 * and the loser's write is refused as a replay rather than silently
 * misattributed — a visible error, not corruption. An app that genuinely writes
 * from several tabs at once should hold a Web Lock around `next()` or give each
 * tab its own device.
 */
export function createLocalStorageNonceSource(
  key: string,
  storage?: { getItem(k: string): string | null; setItem(k: string, v: string): void },
): NonceSource {
  const store =
    storage ?? (globalThis as unknown as { localStorage?: typeof storage }).localStorage;
  if (!store) {
    throw new Error(
      'no localStorage in this runtime: pass a storage implementation, or use createMemoryNonceSource for a process that owns its whole sequence',
    );
  }
  // A missing, empty, or corrupted value means "no sequence recorded", and the
  // safe reading of that is not 1 — a cleared storage on a device that has
  // already written would replay. But the client cannot know, and 1 is the only
  // defensible start, so it is what a fresh key gets. This is why the doc above
  // tells apps to key per device: a device whose storage was cleared should be
  // re-paired rather than resumed — or handed a recovering source, which asks
  // the node what it already spent instead of guessing.
  const lastHandedOut = (): bigint => {
    const raw = store.getItem(key);
    if (raw === null || raw === '') return 0n;
    try {
      const parsed = BigInt(raw);
      return parsed > 0n ? parsed : 0n;
    } catch {
      return 0n;
    }
  };

  return {
    next(): Promise<bigint> {
      const value = lastHandedOut() + 1n;
      store.setItem(key, value.toString());
      return Promise.resolve(value);
    },
    advanceTo(floor: bigint): Promise<void> {
      // Stored is the last number handed out, so the floor is recorded as the
      // one below it — persisted rather than held in memory, which is the whole
      // point: the next cold start resumes above the jump even if the node
      // cannot be reached then.
      const wanted = floor > 0n ? floor - 1n : 0n;
      if (wanted > lastHandedOut()) store.setItem(key, wanted.toString());
      return Promise.resolve();
    },
  };
}

/** A node (or anything else) that can answer where a device's sequence stands. */
export interface WarrantNonceLookup {
  getWarrantNonce(contextId: string, authorDeviceKey: string): Promise<WarrantNonceState>;
}

/** Thrown when every node asked says this device has spent `u64::MAX` here. */
export class WarrantNonceExhaustedError extends Error {
  name = 'WarrantNonceExhaustedError';

  constructor(
    public readonly contextId: string,
    public readonly authorDeviceKey: string,
  ) {
    super(
      `author device ${authorDeviceKey} has spent every nonce in context ${contextId}; it must re-key to write again`,
    );
  }
}

/** What {@link createRecoveringNonceSource} needs to know. */
export interface RecoveringNonceSourceOptions {
  /**
   * The node(s) to ask. Pass an {@link AdminApiClient} — it satisfies this
   * structurally — or several, one per relay this author writes through.
   *
   * With more than one, the **highest** answer wins. Nonce state folds per peer,
   * so a node can only be behind a client whose warrants it has not applied,
   * never ahead of the truth; taking the highest is therefore the only reading
   * that cannot hand out a nonce somebody has already spent.
   */
  lookups: WarrantNonceLookup | readonly WarrantNonceLookup[];
  contextId: string;
  /** The author device's SIGNING key, base58 or hex. Not its `deviceId`. */
  authorDeviceKey: string;
  /**
   * The client's own counter, folded in with `max`. Defaults to an in-memory
   * one starting at 1.
   *
   * Pass {@link createLocalStorageNonceSource} to keep both halves: the local
   * counter carries the sequence forward between calls, the node supplies the
   * floor when that counter has been cleared.
   */
  local?: NonceSource;
  /**
   * What to do when no node can be reached on the cold-start lookup.
   *
   * `'throw'` (the default) refuses to mint. That is the conservative reading:
   * a source that quietly fell back to a cleared local counter would replay
   * spent nonces, which is the exact failure this exists to prevent, and it
   * would do it invisibly. `'local'` mints from the local counter anyway —
   * correct only when that counter is known to be intact and the app would
   * rather write offline than not at all.
   */
  onLookupFailure?: 'throw' | 'local';
}

/**
 * A nonce source that asks the node where the sequence stands before its first
 * mint, then carries on locally.
 *
 * # Why this is not the default
 *
 * It costs a round trip and an admin credential, and an author that never lost
 * its counter gains nothing from it. It earns its place in exactly one
 * situation, which is common rather than exotic: a client whose local state is
 * gone. A browser keyholder lives in storage that is partitioned per top-level
 * site and cleared on a schedule it does not control, so for it, losing the
 * counter is the normal lifecycle. Without this, such a client either restarts
 * at 1 — replaying every nonce it already spent, each write refused, which
 * reads to the user as the app silently not saving — or guesses upward, one
 * burnt round trip per wrong guess.
 *
 * # What it does
 *
 * The lookup happens once, lazily, on the first {@link NonceSource.next}: a
 * source that is constructed and never used costs nothing, and an app that
 * builds its relay client at startup does not pay a network call for it. The
 * answer becomes a **floor**, and every nonce handed out afterwards is
 * `max(localCounter, floor)`. It never goes backwards from either input, which
 * is the one property a nonce source owes its caller.
 *
 * If the local counter is the one that is ahead, it wins — the node may simply
 * not have applied this client's recent warrants yet.
 *
 * The floor is also pushed into the local source through
 * {@link NonceSource.advanceTo} when it has one, so a persistent counter
 * remembers the jump.
 *
 * # Exhaustion
 *
 * A node reporting no `nextNonce` means `u64::MAX` is spent and this device can
 * never write here again. `next()` rejects with
 * {@link WarrantNonceExhaustedError} rather than guessing, because every guess
 * from there is refused forever.
 *
 * # On an older node
 *
 * The route is new and absent from core `master` builds, which answer 404 —
 * {@link AdminApiClient.getWarrantNonce} surfaces that as
 * `WarrantNonceRouteUnavailableError`. It reaches the caller as a lookup
 * failure, so `onLookupFailure` decides: refuse to mint, or fall back to the
 * local counter.
 */
export function createRecoveringNonceSource(
  options: RecoveringNonceSourceOptions,
): NonceSource {
  const lookups = Array.isArray(options.lookups)
    ? (options.lookups as readonly WarrantNonceLookup[])
    : [options.lookups as WarrantNonceLookup];
  if (lookups.length === 0) {
    throw new Error('a recovering nonce source needs at least one node to ask');
  }
  const local = options.local ?? createMemoryNonceSource(1);
  const onLookupFailure = options.onLookupFailure ?? 'throw';

  let floor: bigint | null = null;
  // Memoised so concurrent first calls ask once. Cleared on failure, since a
  // node that was unreachable a moment ago may answer the next call — caching
  // the failure would make one flaky request poison the whole session.
  let pending: Promise<void> | null = null;

  const resolveFloor = async (): Promise<void> => {
    const answers = await Promise.allSettled(
      lookups.map((lookup) =>
        lookup.getWarrantNonce(options.contextId, options.authorDeviceKey),
      ),
    );

    let highest: bigint | null = null;
    let exhausted = false;
    for (const answer of answers) {
      if (answer.status !== 'fulfilled') continue;
      const state = answer.value;
      if (state.kind === 'exhausted') {
        exhausted = true;
        continue;
      }
      if (highest === null || state.nextNonce > highest) highest = state.nextNonce;
    }

    // Exhaustion is only decisive when nothing usable came back. One node
    // saturated while another still has room is not a thing the ledger can
    // produce — the sequence is the device's, not the node's — but if it ever
    // is, the usable answer is the actionable one.
    if (highest === null && exhausted) {
      throw new WarrantNonceExhaustedError(options.contextId, options.authorDeviceKey);
    }
    if (highest === null) {
      const first = answers.find((a) => a.status === 'rejected');
      const reason = first && first.status === 'rejected' ? first.reason : undefined;
      if (onLookupFailure === 'local') {
        floor = 0n;
        return;
      }
      throw reason instanceof Error
        ? reason
        : new Error(`no node could answer where the warrant-nonce sequence stands: ${String(reason)}`);
    }

    floor = highest;
    await local.advanceTo?.(highest);
  };

  return {
    async next(): Promise<bigint> {
      if (floor === null) {
        pending ??= resolveFloor().finally(() => {
          pending = null;
        });
        await pending;
      }

      const mine = await local.next();
      const value = floor !== null && floor > mine ? floor : mine;
      // Advance the floor past what was just handed out, so a local source that
      // is behind cannot re-offer this number on the next call.
      floor = value + 1n;
      return value;
    },
    async advanceTo(wanted: bigint): Promise<void> {
      if (floor === null || wanted > floor) floor = wanted;
      await local.advanceTo?.(wanted);
    },
  };
}
