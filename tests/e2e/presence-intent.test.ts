/**
 * An account's presence through a relay, against a live node.
 *
 * Against the relay core's SDK E2E boots for the delegated suites
 * (`NODE_TEE_RELAY_URL`: delegated execution public, auth left to a proxy):
 * the account has no node, signs each update with its device key, and posts it
 * to `presence-intents`. The operator watches the context's events and must see
 * the account's presence, attributed to the account. A device whose account is
 * not a member is refused.
 *
 * Like the other delegated suites, it needs `MEROD_BINARY` to mint an author
 * device offline, and skips without a relay.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { MeroJs } from '../../src/mero-js.js';
import { RelayClient } from '../../src/relay/relay-client.js';
import { createMemoryNonceSource } from '../../src/relay/nonce-source.js';
import { RelayPresenceClient } from '../../src/presence/relay-presence.js';
import type { EphemeralEntry } from '../../src/ephemeral/types.js';
import type { SseClient } from '../../src/events/index.js';
import { generateAccountRoot, mintDeviceId, signDeviceCert } from '../../src/index.js';
import {
  MEROD_BINARY,
  ensureApplication,
  mintDevice,
  runId,
  type MintedDevice,
} from './harness.js';

const RELAY_URL = process.env.NODE_TEE_RELAY_URL;
const RUN = runId();

function presenceFor(device: MintedDevice, events: () => SseClient) {
  const relay = new RelayClient({
    relayUrl: RELAY_URL as string,
    authorAccount: device.account,
    authorProof: device.credential,
    deviceSecret: device.secret,
    // Presence spends no warrant nonce; the relay client requires a source anyway.
    nonces: createMemoryNonceSource(1),
  });
  return new RelayPresenceClient({ relay, events });
}

const hex = (b: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * A device of a FRESH account. `mintDevice` always certifies a device of the
 * harness phrase's account, which is the member, so it cannot make a stranger.
 */
async function strangerDevice(): Promise<MintedDevice> {
  const root = await generateAccountRoot();
  const sign = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const agree = (await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])) as CryptoKeyPair;
  const device = await mintDeviceId(root.accountId, crypto.getRandomValues(new Uint8Array(16)));
  const credential = await signDeviceCert({
    rootSecret: root.secret,
    device,
    deviceEpoch: 1,
    signPublicKey: hex(await crypto.subtle.exportKey('raw', sign.publicKey)),
    kemPublicKey: hex(await crypto.subtle.exportKey('raw', agree.publicKey)),
  });
  // PKCS#8 for Ed25519 is a 16-byte prefix and the 32-byte seed.
  const secret = hex((await crypto.subtle.exportKey('pkcs8', sign.privateKey)).slice(16));
  return { credential, account: root.accountId, secret };
}

describe.skipIf(!RELAY_URL || !MEROD_BINARY)(
  'presence-intents E2E — an account publishes presence through a relay',
  () => {
    let operator: MeroJs;
    let contextId: string;
    let member: MintedDevice;
    const clients: RelayPresenceClient[] = [];

    beforeAll(async () => {
      operator = new MeroJs({ baseUrl: RELAY_URL as string, timeoutMs: 60_000 });
      const applicationId = await ensureApplication(operator);
      const namespaceId = (
        await operator.admin.createNamespace({ applicationId, name: `presence-${RUN}` })
      ).namespaceId;
      contextId = (await operator.admin.createContext({ applicationId, groupId: namespaceId }))
        .contextId;

      member = mintDevice();
      await operator.admin.addGroupMembers(namespaceId, {
        members: [{ identity: member.account, role: 'Member' }],
      });
    }, 180_000);

    afterAll(() => {
      for (const client of clients) client.close();
      operator?.close();
    });

    it("shows a member account's presence to the operator, attributed to the account", async () => {
      const presence = presenceFor(member, () => operator.events);
      clients.push(presence);

      const seen = new Promise<EphemeralEntry<{ typing: boolean }>>((resolve) => {
        const stop = presence.subscribe<{ typing: boolean }>(contextId, (entry) => {
          if (entry.account === member.account && !entry.removed) {
            stop();
            resolve(entry);
          }
        });
      });
      // Give the subscription a moment to register before the first update.
      await new Promise((resolve) => setTimeout(resolve, 500));
      await presence.set(contextId, { typing: true });

      const entry = await seen;
      expect(entry.state).toEqual({ typing: true });
      expect(entry.account).toBe(member.account);
    }, 60_000);

    it('refuses a device whose account is not a member', async () => {
      const presence = presenceFor(await strangerDevice(), () => operator.events);
      clients.push(presence);
      await expect(presence.set(contextId, { typing: true })).rejects.toMatchObject({
        status: 403,
      });
    }, 60_000);
  },
);
