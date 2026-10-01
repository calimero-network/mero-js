/**
 * An account's ephemeral presence, through its relay.
 *
 * A node publishes and heartbeats its own presence; an account has no node, so
 * this client signs each update with the device key, posts it to the relay's
 * `presence-intents`, and resends the last state every 2.5 s until
 * `set(contextId, null)` or `close()`. The relay checks the update and seals
 * and gossips it; other members verify the device's signature and certificate
 * themselves, so the relay cannot invent or alter an account's presence.
 */
import type { SseClient } from '../events/index.js';
import { hex } from '../crypto/internal.js';
import { jsonCodec, subscribePresence } from '../ephemeral/index.js';
import type { Codec, EphemeralEntry } from '../ephemeral/types.js';
import type { RelayClient } from '../relay/relay-client.js';
import { presenceStatementBytes } from './statement.js';

/** The node's own heartbeat interval, so a relayed entry never outlives the 7 s TTL. */
const HEARTBEAT_MS = 2_500;

type PresenceRelay = Pick<RelayClient, 'authorProof' | 'authorSigner' | 'presenceIntent'>;

export class RelayPresenceClient {
  private readonly relay: PresenceRelay;
  private readonly events: () => SseClient;
  private readonly heartbeatMs: number;
  private readonly now: () => number;
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly lastSeq = new Map<string, number>();
  private readonly refused = new Set<string>();

  /**
   * @param opts.events the relay's event stream, asked for only on `subscribe`:
   *   publishing needs none, so a client with no node key can still publish.
   */
  constructor(opts: {
    relay: PresenceRelay;
    events: () => SseClient;
    heartbeatMs?: number;
    now?: () => number;
  }) {
    this.relay = opts.relay;
    this.events = opts.events;
    this.heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
    this.now = opts.now ?? Date.now;
  }

  /**
   * Set this account's presence in `contextId`, or retract it with `null`.
   * Throws the relay's refusal of this first send; a 429 is not thrown, since
   * the next resend covers it.
   */
  async set<T>(contextId: string, state: T | null, codec: Codec<T> = jsonCodec<T>()): Promise<void> {
    this.stop(contextId);
    this.refused.delete(contextId);
    if (state === null) {
      await this.send(contextId, null);
      return;
    }
    const bytes = new Uint8Array(codec.encode(state));
    await this.send(contextId, bytes);
    if (this.refused.has(contextId)) return;
    this.timers.set(
      contextId,
      setInterval(() => void this.send(contextId, bytes).catch(() => undefined), this.heartbeatMs),
    );
  }

  subscribe<T>(
    contextId: string,
    handler: (entry: EphemeralEntry<T>) => void,
    codec: Codec<T> = jsonCodec<T>(),
  ): () => void {
    return subscribePresence(this.events(), contextId, handler, codec);
  }

  /** Stop every resend. Entries expire on the relay and its peers within 7 s. */
  close(): void {
    for (const contextId of [...this.timers.keys()]) this.stop(contextId);
  }

  private stop(contextId: string): void {
    const timer = this.timers.get(contextId);
    if (timer !== undefined) clearInterval(timer);
    this.timers.delete(contextId);
  }

  /** Wall-clock seeded and strictly rising, so a relay restart never sees an old seq. */
  private nextSeq(contextId: string): number {
    const seq = Math.max(this.now(), (this.lastSeq.get(contextId) ?? 0) + 1);
    this.lastSeq.set(contextId, seq);
    return seq;
  }

  private async send(contextId: string, state: Uint8Array | null): Promise<void> {
    if (this.refused.has(contextId)) return;
    const signer = await this.relay.authorSigner();
    const seq = this.nextSeq(contextId);
    const sentAtMs = this.now();
    const statement = await presenceStatementBytes({
      contextId,
      author: signer.publicKey,
      seq: BigInt(seq),
      sentAtMs: BigInt(sentAtMs),
      state,
    });
    const signature = hex(await signer.sign(statement));
    try {
      await this.relay.presenceIntent(contextId, {
        state: state === null ? null : hex(state),
        seq,
        sentAtMs,
        signature,
        authorProof: this.relay.authorProof,
      });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 429) return;
      if (status === 403) {
        // Not a member, or the device was revoked: resending cannot help.
        this.refused.add(contextId);
        this.stop(contextId);
      }
      throw err;
    }
  }
}
