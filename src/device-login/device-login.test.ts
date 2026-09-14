import { describe, expect, it } from 'vitest';

import { hex } from '../crypto/internal.js';
import { deviceLoginPayload, loginWithDevice, signerFromCryptoKeyPair } from './device-login.js';

describe('deviceLoginPayload', () => {
  it('matches the vector core pins', async () => {
    const payload = await deviceLoginPayload(new Uint8Array(32).fill(1), new Uint8Array(32).fill(2));
    expect(hex(payload)).toBe('a593ceb81e8587870234f5896aa89d691d8a4f794d788a143c681d35070ebe00');
  });
});

describe('loginWithDevice', () => {
  it('signs the challenge the node issued and returns its tokens', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const signer = await signerFromCryptoKeyPair(pair);
    const challenge = 'ab'.repeat(32);
    const calls: Array<{ url: string; body?: unknown }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/auth/challenge')) {
        return new Response(JSON.stringify({ challenge }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ data: { access_token: 'a', refresh_token: 'r' } }),
        { status: 200 },
      );
    }) as typeof fetch;

    const session = await loginWithDevice({
      nodeUrl: 'http://node/',
      signer,
      credential: 'cc',
      fetchImpl,
    });

    expect(session).toEqual({ accessToken: 'a', refreshToken: 'r' });
    const token = calls[1].body as { auth_method: string; public_key: string; provider_data: { signature: string } };
    expect(token.auth_method).toBe('device_key');
    expect(token.public_key).toBe(hex(signer.publicKey));
    const payload = await deviceLoginPayload(
      Uint8Array.from(challenge.match(/../g)!.map((b) => parseInt(b, 16))),
      signer.publicKey,
    );
    const sig = Uint8Array.from(token.provider_data.signature.match(/../g)!.map((b) => parseInt(b, 16)));
    expect(await crypto.subtle.verify({ name: 'Ed25519' }, pair.publicKey, sig, payload)).toBe(true);
  });
});
