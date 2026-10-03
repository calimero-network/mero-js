import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_HA_AUDIENCE,
  ACCOUNT_OWNERSHIP_AUDIENCE,
  signAccountHaClaim,
  signAccountOwnershipClaim,
} from './account-ownership.js';
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

async function verifiesUnderDevice(proof: { signed_payload: string; signature: string }): Promise<boolean> {
  const signer = await signerFromSecret(SECRET);
  const pk = Uint8Array.from(signer.publicKey.match(/../g)!.map((x) => Number.parseInt(x, 16)));
  const key = await crypto.subtle.importKey('raw', pk, { name: 'Ed25519' }, false, ['verify']);
  const domain = new TextEncoder().encode('calimero.mdma.account-ownership-claim.v1\0');
  const payloadBytes = unb64(proof.signed_payload);
  const message = new Uint8Array(domain.length + payloadBytes.length);
  message.set(domain);
  message.set(payloadBytes, domain.length);
  return crypto.subtle.verify({ name: 'Ed25519' }, key, unb64(proof.signature), message);
}

describe('signAccountHaClaim', () => {
  const { subject: _subject, ...haBase } = base;

  it('builds the anonymous route claim: its own audience, no subject, exact key set', async () => {
    const proof = await signAccountHaClaim(haBase);
    expect(proof.kind).toBe('account');
    expect(proof.credential).toBe(base.credential);
    const payload = JSON.parse(new TextDecoder().decode(unb64(proof.signed_payload)));
    expect(ACCOUNT_HA_AUDIENCE).toBe('mdma:enable-ha-namespace-as-account');
    expect(Object.keys(payload)).toEqual([
      'v',
      'audience',
      'group_id',
      'account_id',
      'salt',
      'nonce',
      'issued_at_ms',
      'expires_at_ms',
    ]);
    expect(payload).not.toHaveProperty('subject');
    expect(payload).toMatchObject({
      v: 1,
      audience: 'mdma:enable-ha-namespace-as-account',
      group_id: base.namespaceId,
      account_id: base.accountId,
      salt: base.salt,
      issued_at_ms: 1_700_000_000_000,
      expires_at_ms: 1_700_000_060_000,
    });
    expect(payload.nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it('signs DOMAIN || payload with the device key', async () => {
    const proof = await signAccountHaClaim(haBase);
    expect(await verifiesUnderDevice(proof)).toBe(true);
    // The domain is load-bearing: the bare payload must not verify.
    const signer = await signerFromSecret(SECRET);
    const pk = Uint8Array.from(signer.publicKey.match(/../g)!.map((x) => Number.parseInt(x, 16)));
    const key = await crypto.subtle.importKey('raw', pk, { name: 'Ed25519' }, false, ['verify']);
    expect(
      await crypto.subtle.verify({ name: 'Ed25519' }, key, unb64(proof.signature), unb64(proof.signed_payload)),
    ).toBe(false);
  });

  it('lowercases ids, honours ttlMs up to five minutes, and refuses beyond it', async () => {
    const proof = await signAccountHaClaim({
      ...haBase,
      namespaceId: 'AA'.repeat(32),
      accountId: 'BB'.repeat(32),
      salt: 'CC'.repeat(32),
      ttlMs: 300_000,
    });
    const payload = JSON.parse(new TextDecoder().decode(unb64(proof.signed_payload)));
    expect(payload.group_id).toBe('aa'.repeat(32));
    expect(payload.account_id).toBe('bb'.repeat(32));
    expect(payload.salt).toBe('cc'.repeat(32));
    expect(payload.expires_at_ms - payload.issued_at_ms).toBe(300_000);
    await expect(signAccountHaClaim({ ...haBase, ttlMs: 300_001 })).rejects.toThrow(/ttlMs/);
    await expect(signAccountHaClaim({ ...haBase, ttlMs: 0 })).rejects.toThrow(/ttlMs/);
    await expect(signAccountHaClaim({ ...haBase, accountId: 'bb' })).rejects.toThrow(/accountId/);
  });

  it('cannot stand in for the session claim: the audiences differ', async () => {
    expect(ACCOUNT_OWNERSHIP_AUDIENCE).not.toBe(ACCOUNT_HA_AUDIENCE);
    const session = await signAccountOwnershipClaim(base);
    const sessionPayload = JSON.parse(new TextDecoder().decode(unb64(session.signed_payload)));
    expect(sessionPayload.audience).toBe('mdma:enable-ha-namespace');
    expect(sessionPayload.subject).toBe(base.subject);
  });
});
