import { describe, expect, it } from 'vitest';

import { hex } from '../crypto/internal.js';
import {
  backupPublicKey,
  holderRecoveryBody,
  newBackupKeyPair,
  openDataKey,
  verifyRecoveryHeader,
} from './backup-files.js';
import fixture from './rust-fixture.json';

const fromHexStr = (s: string) => new Uint8Array(s.match(/../g)!.map((b) => parseInt(b, 16)));

// Made by core's `calimero_client::recovery` (seal_key, a header signed as a
// node signs one): what this module reads must be exactly what a node writes.
describe('recovery files sealed by a node', () => {
  it('checks the header and opens the data key with the holder secret', async () => {
    const header = await verifyRecoveryHeader(fixture);
    expect(header.kind).toBe('app');
    expect(header.holder).toEqual({ kind: 'org', id: 'org-1' });
    const key = await openDataKey(header, fromHexStr(fixture.secret));
    expect(hex(key)).toBe(fixture.dataKey);
  });

  it('refuses a header that is not the one signed', async () => {
    const changed = fixture.header.replace('"index":42', '"index":43');
    await expect(verifyRecoveryHeader({ ...fixture, header: changed })).rejects.toThrow(/signature/);
  });

  it('refuses another key', async () => {
    const header = await verifyRecoveryHeader(fixture);
    const { secret } = await newBackupKeyPair();
    await expect(openDataKey(header, secret)).rejects.toThrow(/not the one/);
  });

  it('derives the public key core derives', async () => {
    expect(await backupPublicKey(fromHexStr(fixture.secret))).toBe(fixture.public);
  });

  it('builds the holder recovery body only from that holder files', async () => {
    const listed = [{ name: 'app-app-1.0.0.rbak', header: fixture.header, signature: fixture.signature }];
    await expect(
      holderRecoveryBody({ kind: 'org', id: 'org-1' }, listed, fromHexStr(fixture.secret)),
    ).rejects.toThrow(/no holder file/);
    await expect(
      holderRecoveryBody({ kind: 'org', id: 'other' }, listed, fromHexStr(fixture.secret)),
    ).rejects.toThrow(/not org:other/);
  });
});
