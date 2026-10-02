import { describe, expect, it } from 'vitest';
import { derivePublicKey, hex } from '../crypto/internal.js';
import { presenceStatementBytes, stateHash } from './statement.js';

/** core's `statement_vector_is_stable` (calimero-node-primitives, presence.rs). */
const CORE_VECTOR = '63616c696d65726f2f70726573656e63652f311111111111111111111111111111111111111111111111111111111111111111a09aa5f47a6759802ff955f8dc2d2a14a5c99d23be97f864127ff9383455a4f007000000000000000068e5cf8b010000f25c119b355e48fcfc5c8acd6b7681d0d8dfe33f75ee6408aa162e13b05ca486';

describe('presence statement', () => {
  it("matches core's pinned bytes", async () => {
    const author = hex(await derivePublicKey('22'.repeat(32)));
    const bytes = await presenceStatementBytes({
      contextId: '11'.repeat(32),
      author,
      seq: 7n,
      sentAtMs: 1_700_000_000_000n,
      state: new TextEncoder().encode('{"typing":true}'),
    });
    expect(hex(bytes)).toBe(CORE_VECTOR);
  });

  it('hashes a retract differently from an empty state', async () => {
    expect(hex(await stateHash(null))).not.toBe(hex(await stateHash(new Uint8Array())));
  });
});
