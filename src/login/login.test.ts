/**
 * Conformance against core's pinned vectors.
 *
 * Every constant here is the one `crates/account/src/tests/login_wire_fixture.rs`
 * asserts, with the same fixed inputs. If these two files disagree, this package
 * signs statements that verify nowhere — and the failure arrives as a 401 at
 * login, indistinguishable from a wrong key.
 */

import { describe, expect, it } from 'vitest';

import { signLoginStatement, type Audience } from './login.js';

/** core's `key(9)` — a `PrivateKey` of 32 bytes of 0x09. */
const DEVICE_SECRET = '09'.repeat(32);
/** Derived from it, and pinned by core's fixture. */
const DEVICE_KEY =
  'fd1724385aa0c75b64fb78cd602fa1d991fdebf76b13c58ed702eac835e9f618';

const NODE = '11'.repeat(32);
const CHALLENGE = '22'.repeat(32);
const SESSION_KEY = '33'.repeat(32);
const ISSUED_AT = 1_700_000_000;
const EXPIRES_AT = 1_700_000_300;

const WEB_ORIGIN = 'https://app.example:8443';
const CODE_SIGNING_ID = 'dev.calimero.client';

const sign = (audience: Audience) =>
  signLoginStatement({
    node: NODE,
    audience,
    challenge: CHALLENGE,
    sessionKey: SESSION_KEY,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    deviceSecret: DEVICE_SECRET,
  });

describe('signLoginStatement', () => {
  it('reproduces the WebOrigin encoding core pins', async () => {
    expect(await sign({ kind: 'webOrigin', origin: WEB_ORIGIN })).toBe(
      '1111111111111111111111111111111111111111111111111111111111111111' +
        // tag 0, then a borsh String: u32 LE 24, then the UTF-8
        '00' +
        '18000000' +
        '68747470733a2f2f6170702e6578616d706c653a38343433' +
        '2222222222222222222222222222222222222222222222222222222222222222' +
        '3333333333333333333333333333333333333333333333333333333333333333' +
        DEVICE_KEY +
        '00f1536500000000' +
        '2cf2536500000000' +
        '8302e61afe8f61c8471bc5f8ae9ff13cdd5b3e9bcd793cf8c46acb3ff9592aa4' +
        '37c1aae1b1ee9c9514f29b2340d13a547ea5e6cd4b4b65fbf09bafb55f4c7e00',
    );
  });

  it('reproduces the Cli encoding, whose tag carries no length', async () => {
    expect(await sign({ kind: 'cli' })).toBe(
      '1111111111111111111111111111111111111111111111111111111111111111' +
        // tag 2, and nothing follows it
        '02' +
        '2222222222222222222222222222222222222222222222222222222222222222' +
        '3333333333333333333333333333333333333333333333333333333333333333' +
        DEVICE_KEY +
        '00f1536500000000' +
        '2cf2536500000000' +
        '085b4ee049f7f268a35ec1bfdfe779b94f3bda66cbbb48937735f9ab10c0ef71' +
        'cad6f5bbb9afc4b2b87b5ee87d06284e3c5bc77a6c541c56e62aa65ace8fdb0b',
    );
  });

  it('reproduces the CodeSigningId signature core pins', async () => {
    const statement = await sign({
      kind: 'codeSigningId',
      id: CODE_SIGNING_ID,
    });
    expect(statement).toHaveLength(232 * 2);
    // tag 1, then a borsh String of length 19
    expect(statement).toContain(
      '01130000006465762e63616c696d65726f2e636c69656e74',
    );
    expect(statement.slice(-128)).toBe(
      '4aa7dd84d3d7960647d015a9a4483f2690ab5dc0abd4733634445edd3d8673a9' +
        '193ccc3b9251bbd1c5990a59fc02847d3191514f5725f074a0edfafbb3eeff0b',
    );
  });

  /**
   * The lengths are the cheapest signal that a field changed shape, and the gap
   * between them is exactly the audience's payload.
   */
  it('encodes each audience at the length core expects', async () => {
    expect(await sign({ kind: 'webOrigin', origin: WEB_ORIGIN })).toHaveLength(
      237 * 2,
    );
    expect(
      await sign({ kind: 'codeSigningId', id: CODE_SIGNING_ID }),
    ).toHaveLength(232 * 2);
    expect(await sign({ kind: 'cli' })).toHaveLength(209 * 2);
  });

  /**
   * What the tag byte in the preimage buys. Two audiences with the same body and
   * different variants must not produce the same signature — otherwise a session
   * minted for one surface is presentable from the other.
   */
  it('separates two variants that carry the same body', async () => {
    const asOrigin = await sign({
      kind: 'webOrigin',
      origin: CODE_SIGNING_ID,
    });
    const asId = await sign({ kind: 'codeSigningId', id: CODE_SIGNING_ID });
    expect(asOrigin.slice(-128)).not.toBe(asId.slice(-128));
  });

  it('refuses a field that is not 32 bytes of hex', async () => {
    await expect(
      signLoginStatement({
        node: '11'.repeat(31),
        audience: { kind: 'cli' },
        challenge: CHALLENGE,
        sessionKey: SESSION_KEY,
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
        deviceSecret: DEVICE_SECRET,
      }),
    ).rejects.toThrow(/node must be 64 hex characters/);
  });
});
