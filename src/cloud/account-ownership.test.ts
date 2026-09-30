import { describe, expect, it } from 'vitest';

import { signAccountOwnershipClaim } from './account-ownership.js';
import { signerFromSecret } from '../signer/signer.js';

const SECRET = '07'.repeat(32);
const base = {
  namespaceId: 'aa'.repeat(32),
  accountId: 'bb'.repeat(32),
  salt: 'cc'.repeat(32),
  subject: 'founder@example.com',
  credential: 'dd'.repeat(40),
  deviceSecret: SECRET,
  now: () => 1_700_000_000_000,
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

describe('signAccountOwnershipClaim', () => {
  it("builds mdma's account claim and signs domain ‖ payload with the device key", async () => {
    const proof = await signAccountOwnershipClaim(base);
    expect(proof.kind).toBe('account');
    expect(proof.credential).toBe(base.credential);
    const payload = JSON.parse(new TextDecoder().decode(unb64(proof.signed_payload)));
    expect(payload).toMatchObject({
      v: 1,
      audience: 'mdma:enable-ha-namespace',
      group_id: base.namespaceId,
      account_id: base.accountId,
      salt: base.salt,
      subject: base.subject,
      issued_at_ms: 1_700_000_000_000,
      expires_at_ms: 1_700_000_060_000,
    });
    expect(payload.nonce).toMatch(/^[0-9a-f]{32}$/);

    const signer = await signerFromSecret(SECRET);
    const pk = Uint8Array.from(signer.publicKey.match(/../g)!.map((x) => Number.parseInt(x, 16)));
    const key = await crypto.subtle.importKey('raw', pk, { name: 'Ed25519' }, false, ['verify']);
    const domain = new TextEncoder().encode('calimero.mdma.account-ownership-claim.v1\0');
    const payloadBytes = unb64(proof.signed_payload);
    const message = new Uint8Array(domain.length + payloadBytes.length);
    message.set(domain);
    message.set(payloadBytes, domain.length);
    expect(await crypto.subtle.verify({ name: 'Ed25519' }, key, unb64(proof.signature), message)).toBe(true);
  });

  it('refuses a lifetime the cloud would refuse, a missing subject, and malformed ids', async () => {
    await expect(signAccountOwnershipClaim({ ...base, ttlMs: 5 * 60_000 + 1 })).rejects.toThrow(/ttlMs/);
    await expect(signAccountOwnershipClaim({ ...base, subject: '' })).rejects.toThrow(/subject/);
    await expect(signAccountOwnershipClaim({ ...base, salt: 'zz' })).rejects.toThrow(/salt/);
  });
});
