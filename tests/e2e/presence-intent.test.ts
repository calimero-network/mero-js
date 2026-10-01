/**
 * An account's presence through a relay, against a live node.
 *
 * The node is the relay here: the account has no node, signs each update with
 * its device key, and posts it to `presence-intents`. The node owner watches
 * the context's events and must see the account's presence, attributed to the
 * account. A device whose account is not a member is refused.
 *
 * Like `delegated-intent`, this needs `MEROD_BINARY` to mint an author device
 * offline. Against a merod that predates the route it asserts the route's
 * absence instead of skipping, so it hands over to the real assertions the
 * moment a release carries it.
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
  resolveBaseUrl,
  resolveCreds,
  runId,
  type MintedDevice,
} from './harness.js';

const NODE_URL = resolveBaseUrl();
const { username: USERNAME, password: PASSWORD } = resolveCreds();
const RUN = runId();

function presenceFor(device: MintedDevice, events: () => SseClient) {
  const relay = new RelayClient({
    relayUrl: NODE_URL,
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

describe.skipIf(!MEROD_BINARY)('presence-intents E2E — an account publishes presence through a relay', () => {
  let mero: MeroJs;
  let contextId: string;
  let namespaceId: string;
  let member: MintedDevice;
  /** `null` once the node serves the route; otherwise the status it refused with. */
  let routeAbsentStatus: number | null = null;
  const clients: RelayPresenceClient[] = [];

  beforeAll(async () => {
    mero = new MeroJs({ baseUrl: NODE_URL });
    await mero.authenticate({ username: USERNAME, password: PASSWORD });

    const applicationId = await ensureApplication(mero);
    const ns = await mero.admin.createNamespace({ applicationId, name: `presence-${RUN}` });
    namespaceId = ns.namespaceId;
    contextId = (await mero.admin.createContext({ applicationId, groupId: namespaceId })).contextId;

    member = mintDevice();
    await mero.admin.addGroupMembers(namespaceId, {
      members: [{ identity: member.account, role: 'Member' }],
    });

    // A merod that predates the route answers 404 (no route) or 405.
    const probe = await fetch(
      `${NODE_URL.replace(/\/+$/, '')}/admin-api/contexts/${contextId}/presence-intents`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    );
    if (probe.status === 404 || probe.status === 405) {
      routeAbsentStatus = probe.status;
      console.warn(
        `[presence-intent] this merod does not serve presence-intents (HTTP ${probe.status}); ` +
          'asserting its absence instead, until a release carries it.',
      );
    }
  }, 180_000);

  afterAll(() => {
    for (const client of clients) client.close();
  });

  it("shows a member account's presence to the node owner, attributed to the account", async () => {
    const presence = presenceFor(member, () => mero.events);
    clients.push(presence);

    if (routeAbsentStatus !== null) {
      await expect(presence.set(contextId, { typing: true })).rejects.toMatchObject({
        status: routeAbsentStatus,
      });
      return;
    }

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
    const stranger = await strangerDevice();
    const presence = presenceFor(stranger, () => mero.events);
    clients.push(presence);
    await expect(presence.set(contextId, { typing: true })).rejects.toMatchObject({
      status: routeAbsentStatus ?? 403,
    });
  }, 60_000);
});
