import { describe, expect, it } from 'vitest';

import type { SignedGroupOpenInvitation } from '../admin-api/admin-types.js';
import { encodeSignedInvitation } from './namespace-op.js';

/**
 * A minimal well-formed invitation. The values are shaped, not meaningful — the
 * encoder only cares about widths and order.
 */
function invitation(admitterAddrs: readonly string[]): SignedGroupOpenInvitation {
  return {
    invitation: {
      inviter_identity: Array.from({ length: 32 }, () => 1),
      group_id: Array.from({ length: 32 }, () => 2),
      expiration_timestamp: 1_900_000_000,
      secret_salt: Array.from({ length: 32 }, () => 3),
      invited_role: 1,
      admitters: [],
    },
    inviter_signature: 'deadbeef',
    admitter_addrs: admitterAddrs,
  } as unknown as SignedGroupOpenInvitation;
}

describe('encodeSignedInvitation', () => {
  it('writes admitter_addrs as bare borsh strings, with no discriminant', () => {
    // This encoding is version-locked to core's struct: the re-encoded
    // invitation goes inside the op that gets signed, so a byte in the wrong
    // place fails as `invalid invitation signature` — an error naming the
    // signature and pointing nowhere near this encoder.
    //
    // Checked differentially rather than against a golden vector, so the
    // assertion stays about THIS field instead of breaking whenever an
    // unrelated one moves.
    const addr = '/ip4/10.0.0.1/tcp/2528/p2p/12D3KooWExample';
    const utf8 = new TextEncoder().encode(addr);

    const without = encodeSignedInvitation(invitation([]));
    const withOne = encodeSignedInvitation(invitation([addr]));

    // A borsh `String` is u32 length + bytes. Exactly that and nothing else:
    // the field held an enum until core dropped its URL variant, and an enum
    // writes a discriminant byte ahead of every entry.
    expect(withOne.length - without.length).toBe(4 + utf8.length);
  });

  it('encodes the count, then each address in order', () => {
    const first = '/ip4/10.0.0.1/tcp/2528/p2p/12D3KooWOne';
    const second = '/ip4/10.0.0.2/tcp/2528/p2p/12D3KooWTwo';

    const empty = encodeSignedInvitation(invitation([]));
    const two = encodeSignedInvitation(invitation([first, second]));

    // Everything ahead of the count is byte-identical between the two, so the
    // first difference IS the count.
    let at = 0;
    while (at < empty.length && empty[at] === two[at]) at += 1;

    const view = new DataView(two.buffer, two.byteOffset + at);
    expect(view.getUint32(0, true)).toBe(2);

    const tail = new TextDecoder().decode(two.slice(at + 4));
    expect(tail).toContain(first);
    expect(tail).toContain(second);
    expect(tail.indexOf(first)).toBeLessThan(tail.indexOf(second));
  });
});
