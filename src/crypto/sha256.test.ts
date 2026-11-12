import { describe, expect, it } from 'vitest';

import { Sha256 } from './sha256.js';

const reference = async (data: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', data));

describe('Sha256', () => {
  it('matches WebCrypto across padding boundaries and splits', async () => {
    for (const len of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 70000]) {
      const data = Uint8Array.from({ length: len }, (_, i) => (i * 7) % 256);
      for (const split of [1, 13, 64, 1 << 20]) {
        const hash = new Sha256();
        for (let at = 0; at < len; at += split) hash.update(data.subarray(at, at + split));
        expect(hash.digest(), `${len}/${split}`).toEqual(await reference(data));
      }
    }
  });
});
