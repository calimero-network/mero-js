import { describe, expect, it } from 'vitest';
import { sameAccount, toAccountBase58, toAccountHex } from './index.js';

// Captured from a live merod 0.11.0-rc.24 node: the SAME two members, served
// as hex by `GET /admin-api/groups/{id}/members` and as base58 by the
// contract's `get_profiles`. If these ever stop matching, the two encodings
// have diverged and every cross-source comparison in every app is wrong.
const ALICE_HEX =
  'e8b65145da3670b152e06eb3e2c00a5b41ca8907aac0a4ef24486bffa6283670';
const ALICE_B58 = 'GfQq3fL5PC9Lw4fV3EAFQmoaoGyWMig2GvQgp3u3ZYeK';
const BOB_HEX =
  '7528078a29c19803bbe1e370410b58992c0d1e436bec701ed33a4b3305bc916c';
const BOB_B58 = '8tL6y7jzsTyff1UdKFzW67mMP91GGQCGSAzugpX6poKy';

describe('account id encoding', () => {
  it('maps between the encodings core actually serves', () => {
    expect(toAccountBase58(ALICE_HEX)).toBe(ALICE_B58);
    expect(toAccountHex(ALICE_B58)).toBe(ALICE_HEX);
    expect(toAccountBase58(BOB_HEX)).toBe(BOB_B58);
    expect(toAccountHex(BOB_B58)).toBe(BOB_HEX);
  });

  it('is idempotent, so a value can be canonicalised more than once', () => {
    expect(toAccountHex(toAccountHex(ALICE_B58))).toBe(ALICE_HEX);
    expect(toAccountBase58(toAccountBase58(BOB_HEX))).toBe(BOB_B58);
  });

  it('accepts uppercase hex and normalises it', () => {
    expect(toAccountHex(ALICE_HEX.toUpperCase())).toBe(ALICE_HEX);
    expect(sameAccount(ALICE_HEX.toUpperCase(), ALICE_B58)).toBe(true);
  });

  it('recognises one account across both encodings', () => {
    expect(sameAccount(ALICE_HEX, ALICE_B58)).toBe(true);
    expect(sameAccount(ALICE_B58, ALICE_HEX)).toBe(true);
    expect(sameAccount(ALICE_HEX, BOB_B58)).toBe(false);
  });

  it('round-trips a value with leading zero bytes', () => {
    // Leading zeros are where naive base58 implementations lose data: each
    // zero byte must survive as a leading '1'.
    const hex = '00'.repeat(4) + 'ab'.repeat(28);
    const b58 = toAccountBase58(hex);
    expect(b58.startsWith('1111')).toBe(true);
    expect(toAccountHex(b58)).toBe(hex);
  });

  it('leaves anything that is not a 32-byte account untouched', () => {
    // A device key is base58 but not an account; an alias is neither. Both
    // must survive intact rather than being mangled or blanked.
    const deviceKey = '5uBHcg3vyX6eAFgkNbREtftG3U6KmD6qjoBf53BmYjeR';
    expect(toAccountHex(deviceKey)).toBe(toAccountHex(deviceKey));
    expect(toAccountHex('member-alias')).toBe('member-alias');
    expect(toAccountBase58('member-alias')).toBe('member-alias');
    expect(toAccountHex('not valid base58 !!')).toBe('not valid base58 !!');
  });

  it('treats empty and nullish input as empty, never as a match', () => {
    expect(toAccountHex(null)).toBe('');
    expect(toAccountHex(undefined)).toBe('');
    expect(toAccountBase58('')).toBe('');
    expect(sameAccount('', '')).toBe(false);
    expect(sameAccount(null, ALICE_HEX)).toBe(false);
  });
});
