/**
 * The bytes a device signs for one presence update: the borsh of core's
 * `PresenceStatement` (`calimero_node_primitives::presence`). Pinned to core's
 * vector in `statement.test.ts`, so the two encoders cannot drift.
 */
import { concat, fromHex, u32le, u64le } from '../crypto/internal.js';

/** core's `PRESENCE_DOMAIN`: part of the signed bytes. */
export const PRESENCE_DOMAIN = new TextEncoder().encode('calimero/presence/1');

/** `sha256(borsh(Option<Vec<u8>>))`: `None` is `[0]`, `Some(v)` is `[1] ‖ u32le(len) ‖ v`. */
export async function stateHash(state: Uint8Array | null): Promise<Uint8Array> {
  const borsh =
    state === null ? new Uint8Array([0]) : concat(new Uint8Array([1]), u32le(state.length), state);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', borsh));
}

/** What the device key signs, raw: domain ‖ context ‖ author ‖ seq ‖ sentAtMs ‖ stateHash. */
export async function presenceStatementBytes(input: {
  contextId: string;
  author: string;
  seq: bigint;
  sentAtMs: bigint;
  state: Uint8Array | null;
}): Promise<Uint8Array> {
  return concat(
    PRESENCE_DOMAIN,
    fromHex(input.contextId, 'contextId', 32),
    fromHex(input.author, 'author', 32),
    u64le(input.seq),
    u64le(input.sentAtMs),
    await stateHash(input.state),
  );
}
