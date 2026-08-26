/**
 * E2E for the account-level device pairing surface.
 *
 * Requires a running merod node with embedded auth. The CI workflow starts it
 * before running these tests.
 *
 * Run manually:
 *   NODE_URL=http://localhost:4001 pnpm test:e2e -- account-pairing
 *
 * ONE NODE, so the pairing ceremony itself cannot be driven here: pair-init runs
 * on the joining device and pair-complete on the account holder, and the whole
 * point of the exchange is that those are different machines. What a single node
 * can settle is everything around it - the two listings, the half that mints
 * (which needs no second party), and the refusals, which are asserted by status
 * because a typed status is the thing this surface added: a client used to get a
 * 500 for every one of them. The two-node happy path lives in core's own
 * scenarios, which build merod from the branch.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MeroJs } from '../../src/mero-js.js';
import { resolveBaseUrl, resolveCreds, ensureApplication } from './harness.js';
import type { AccountPairInitResponseData, NodeIdentity } from '../../src/admin-api/admin-types.js';

const NODE_URL = resolveBaseUrl();
const { username: USERNAME, password: PASSWORD } = resolveCreds();

/** Ids on this surface are 64 hex characters; keys beside them are base58. */
const HEX_32_BYTES = /^[0-9a-f]{64}$/;
const HEX_64_BYTES = /^[0-9a-f]{128}$/;

let mero: MeroJs;
let applicationId: string;
let namespaceId: string;
let identity: NodeIdentity;
/** Set when the node under test predates these routes; every test then skips. */
let routesMissing = false;
/** Carried from the pair-init test into the refusal that needs a real payload. */
let offer: AccountPairInitResponseData | undefined;

describe('Account devices & pairing E2E', () => {
  beforeAll(async () => {
    mero = new MeroJs({ baseUrl: NODE_URL });
    await mero.authenticate({ username: USERNAME, password: PASSWORD });
    applicationId = await ensureApplication(mero);
    // Taking part in a namespace is what mints this node's account root, and it
    // has to happen before the probe below: the listing answers 404 both for a
    // node that holds no account and for a node too old to serve the route, and
    // only the second is a reason to skip. With an account in hand, a 404 can
    // only mean the route is absent.
    namespaceId = (await mero.admin.createNamespace({ applicationId })).namespaceId;
    identity = await mero.admin.getNodeIdentity();

    try {
      await mero.admin.listAccountDevices();
    } catch (e) {
      if ((e as { status?: number }).status !== 404) throw e;
      routesMissing = true;
      console.log('(skip) account routes absent - this merod predates them');
    }
  }, 60000);

  afterAll(async () => {
    if (namespaceId) await mero.admin.deleteNamespace(namespaceId).catch(() => {});
    mero.close();
  }, 60000);

  it('lists the account devices this node can see, in the encodings it documents', async (ctx) => {
    if (routesMissing) return ctx.skip();

    const devices = await mero.admin.listAccountDevices();
    const participating = (await mero.admin.listNamespaces()).map((ns) => ns.namespaceId);

    // Which devices are here depends on what this node has certified and what is
    // bound where, and a fresh single node may legitimately have none. What does
    // not depend on that is the shape, and the shape is what a caller writes
    // against - an id it reads as base58 because it was rendered hex is a bug
    // that surfaces as "no such device" far from here.
    for (const device of devices) {
      expect(device.deviceId).toMatch(HEX_32_BYTES);
      expect(typeof device.signingKey).toBe('string');
      // The one field on this entry that is NOT hex. It is a key, and a key is
      // base58 here - unlike the same key inside a pairing payload, which is hex
      // because that payload is round-tripped rather than compared.
      expect(device.signingKey).not.toMatch(HEX_32_BYTES);
      expect(typeof device.isSelf).toBe('boolean');
      expect(typeof device.revoked).toBe('boolean');
      expect(Array.isArray(device.applications)).toBe(true);
      for (const ns of device.namespaces) {
        expect(ns).toMatch(HEX_32_BYTES);
        // The listing is built from the namespaces this node takes part in, so
        // one it does not is a namespace the join leaked in from somewhere.
        expect(participating).toContain(ns);
      }
    }

    // At most one device can be this one, and if the listing names it at all it
    // has to be the device the identity endpoint reports. Two sources for one
    // fact, and they are allowed to disagree only by omission: the identity
    // route reads the held device directly while this one reads live bindings,
    // so a device with no binding yet is absent here and present there.
    const selves = devices.filter((d) => d.isSelf);
    expect(selves.length).toBeLessThanOrEqual(1);
    if (selves.length === 1) expect(selves[0].deviceId).toBe(identity.deviceId);
  });

  it('names the application this account speaks in, against the namespace targeting it', async (ctx) => {
    if (routesMissing) return ctx.skip();

    const applications = await mero.admin.listAccountApplications();
    // Deterministic, unlike the device listing: `beforeAll` created a namespace
    // targeting this application and this node takes part in it, which is
    // exactly the derivation behind this route.
    const entry = applications.find((a) => a.applicationId === applicationId);
    expect(entry).toBeTruthy();
    expect(entry!.namespaces).toContain(namespaceId);
    // Base58, matching every other application id on the admin API, while the
    // namespaces beside it are hex. The mixture is the contract.
    expect(entry!.applicationId).not.toMatch(HEX_32_BYTES);
  });

  it('mints a pairing device for the account root it is handed', async (ctx) => {
    if (routesMissing) return ctx.skip();
    // Absent on a node at or below `0.11.0-rc.22`. A node serving these routes
    // is newer than that, so this should not fire - but reading the root off the
    // node is what keeps this test from carrying a hardcoded account, and a
    // missing root is a reason to skip rather than to invent one.
    if (!identity.accountRootPublicKey) return ctx.skip();

    offer = await mero.admin.initAccountPairing({
      accountRootPublicKey: identity.accountRootPublicKey,
      namespaces: [namespaceId],
    });

    // Every field hex, including the two public keys, and that is the whole
    // claim being checked: these are round-trip tokens copied verbatim into
    // pair-complete, so a field rendered base58 to match keys elsewhere would
    // fail to parse at the other end of a ceremony that has already asked a
    // human to read a code aloud.
    expect(offer.accountId).toMatch(HEX_32_BYTES);
    expect(offer.deviceId).toMatch(HEX_32_BYTES);
    expect(offer.kemPublicKey).toMatch(HEX_32_BYTES);
    expect(offer.signPublicKey).toMatch(HEX_32_BYTES);
    expect(offer.statement).toMatch(HEX_64_BYTES);
    expect(offer.confirmationCode.trim()).not.toBe('');
    // One device however many namespaces were named, so the id is not derived
    // from the namespace it was asked about.
    expect(offer.deviceId).not.toBe(namespaceId);
  });

  it('refuses a completion whose confirmation code does not match, as a 400', async (ctx) => {
    if (routesMissing || !offer) return ctx.skip();

    // A real offer with the one value a substituting attacker cannot forge
    // replaced. The status is the assertion: this refusal, and the invalid
    // statement beside it, are the two the API types as "fix the payload", and
    // both used to reach a client as an untyped 500.
    await expect(
      mero.admin.completeAccountPairing({
        deviceId: offer.deviceId,
        kemPublicKey: offer.kemPublicKey,
        signPublicKey: offer.signPublicKey,
        statement: offer.statement,
        confirmationCode: 'AAAA-BBBB-CCCC-DDDD',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a relink of a device it never certified, as a 404', async (ctx) => {
    if (routesMissing) return ctx.skip();

    // Well-formed and certainly unknown: relink repairs a device this node holds
    // a certificate for, and it holds none for an id of zeros. A 404 here is
    // that refusal and not a missing route - `beforeAll` already established the
    // routes are served.
    await expect(mero.admin.relinkAccountDevice('0'.repeat(64))).rejects.toMatchObject({ status: 404 });
  });
});
