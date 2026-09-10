/**
 * E2E for `performIntent` — a member with no node writing through a relay.
 *
 * This is the SDK-level coverage the endpoint was missing, and the reason it sat
 * in core's `coverage-baseline.json`: that ratchet is fed by this suite, so no
 * amount of merobox coverage moves it.
 *
 * **The warrant is signed by this SDK**, and that is the point of the suite now.
 * It used to be minted by shelling out to `merod`, on the reasoning that "this
 * SDK does not sign, and should not". It does sign — `signWarrant` shipped — and
 * the argument against it (ed25519 plus a borsh encoding kept byte-identical
 * with the node's forever) is precisely the thing that needs a test rather than
 * an assumption. Unit tests pin those bytes against a fixed vector; only a real
 * node can say whether the node accepts them.
 *
 * `merod` is still used for the one thing it alone can do: minting the author's
 * device certificate offline, with a key that never reaches the node.
 *
 * It also mints a second warrant over identical inputs so the two
 * implementations can be diffed directly. That needs `merod account warrant
 * --not-after`: the deadline is signed over, and merod otherwise reads it from
 * its own clock, so "the same warrant" minted twice never matched.
 *
 * A test that called the endpoint with a fabricated warrant would register
 * coverage and prove nothing: it would 4xx every time and the ratchet would not
 * notice. Coverage of a route is not coverage of what the route does.
 *
 * Requires MEROD_BINARY. Skipped without it, so a local run against an
 * already-booted node does not fail on a missing binary.
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, it, expect, beforeAll } from 'vitest';

import { MeroJs } from '../../src/mero-js.js';
import { signWarrant } from '../../src/warrant/index.js';
import { resolveBaseUrl, resolveCreds, ensureApplication, runId } from './harness.js';

const NODE_URL = resolveBaseUrl();
const { username: USERNAME, password: PASSWORD } = resolveCreds();
const RUN = runId();
const MEROD = process.env.MEROD_BINARY;

/** The intent every warrant below authorises, shared so they commit alike. */
const ARGS = { key: 'delegated', value: `from-sdk-${RUN}` };

/**
 * A fixed BIP-39 phrase, so the author's ACCOUNT is deterministic.
 *
 * It owns nothing. It is here because this scenario needs an author whose
 * account holds **no node at all** — the case delegated authorship exists for —
 * and an account only exists where some root does. A node's own root would work
 * and would need no phrase, but `sign-cert` reads it from the datastore and
 * RocksDB's lock is exclusive, so it cannot be read while the node under test is
 * serving this suite. `--from` opens no store, which is what makes it usable
 * here.
 */
const AUTHOR_PHRASE =
  'legal winner thank year wave sausage worth useful legal winner thank year ' +
  'wave sausage worth useful legal winner thank year wave sausage worth title';

interface MintedDevice {
  credential: string;
  account: string;
  secret: string;
}

/** Run an offline `merod account` subcommand and return its stdout. */
function merod(args: string[]): string {
  return execFileSync(MEROD as string, ['--node', 'sdk-e2e-offline', ...args], {
    encoding: 'utf8',
    timeout: 60_000,
  });
}

/**
 * Mint a device for the phrase's account and certify it, offline.
 *
 * `--generate` mints the keypair and certifies it in one step, so the secret
 * exists only in this output and never reaches the node — which is the whole
 * point: a node holding it could forge writes in the member's name.
 */
function mintDevice(): MintedDevice {
  const dir = mkdtempSync(join(tmpdir(), 'mero-warrant-'));
  const phraseFile = join(dir, 'phrase');
  writeFileSync(phraseFile, `${AUTHOR_PHRASE}\n`, { mode: 0o600 });

  const out = merod(['account', 'sign-cert', '--generate', '--from', phraseFile]);
  const lines = out.split('\n');

  const credential = lines.find((l) => /^[0-9a-f]{100,}$/.test(l.trim()))?.trim();
  const account = /^Account: +([0-9a-f]{64})$/m.exec(out)?.[1];
  const secret = /^Secret: +([0-9a-f]{64})$/m.exec(out)?.[1];

  // Named individually rather than one "parse failed": if `sign-cert` changes
  // its output, the message should say which field went missing.
  if (!credential) throw new Error(`sign-cert printed no credential:\n${out}`);
  if (!account) throw new Error(`sign-cert printed no Account line:\n${out}`);
  if (!secret) throw new Error(`sign-cert printed no Secret line:\n${out}`);

  return { credential, account, secret };
}

describe.skipIf(!MEROD)('performIntent E2E — delegated authorship', () => {
  let mero: MeroJs;
  let contextId: string;
  let namespaceId: string;
  let relayAccount: string;
  let device: MintedDevice;
  /** One warrant, presented three times: refused, accepted, refused. */
  let warrant: string;
  /**
   * Whether the merod under test serves the descriptor read.
   *
   * `POST .../intents` shipped a release before the `GET` on the same path, so a
   * released binary answers the GET with `405 Allow: POST` until a release
   * carries core#3828. This suite runs against the newest *released* merod by
   * design — it is what SDK users actually run — so the descriptor assertions
   * branch on the server having the route rather than on a version pin.
   *
   * `null` once the route answers; otherwise the status it refused with, which
   * the assertions below then require — one variable, so the probe and what they
   * expect cannot drift apart.
   *
   * Both branches assert; neither skips. A skip in this file trips the
   * workflow's suite-ran guard on purpose, and the guard is right — so "the
   * route is not there yet" is written as a rejection assertion, which fails the
   * moment that stops being true and hands the real assertions over with no edit
   * here.
   */
  let descriptorAbsentStatus: number | null = null;

  beforeAll(async () => {
    mero = new MeroJs({ baseUrl: NODE_URL });
    await mero.authenticate({ username: USERNAME, password: PASSWORD });

    const applicationId = await ensureApplication(mero);
    const ns = await mero.admin.createNamespace({ applicationId, name: `deleg-${RUN}` });
    namespaceId = ns.namespaceId;

    const ctx = await mero.admin.createContext({ applicationId, groupId: namespaceId });
    contextId = ctx.contextId;

    relayAccount = (await mero.admin.getNodeIdentity()).accountId;
    device = mintDevice();

    // Only 404/405 means "this merod predates the route" — 405 from one that
    // serves the path for POST alone, 404 from one older still. Any other
    // failure is a real one and is rethrown, or this branch becomes a way for
    // the descriptor to break unnoticed.
    try {
      await mero.admin.getIntentRelay(contextId);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 404 && status !== 405) throw err;
      descriptorAbsentStatus = status;
      console.warn(
        `[delegated-intent] this merod does not serve GET .../intents (HTTP ${status}); ` +
          'asserting its absence instead, until a release carries it.',
      );
    }
  }, 180_000);

  it('adds the author by ACCOUNT — its device joins nothing', async () => {
    // By account, not by key. The minted device is in no group's binding rows
    // and never will be, which is exactly the case a certificate covers: a
    // key-based membership check would refuse every write below.
    await mero.admin.addGroupMembers(namespaceId, {
      members: [{ identity: device.account, role: 'Member' }],
    });
  });

  it('describes itself as unable to author before the grant', async () => {
    // Not skipped when the route is absent — this file's skips are what the
    // workflow's suite-ran guard exists to catch, and it is right to: a silently
    // skipped delegated-intent suite went unnoticed here once already. So assert
    // the absence instead, and assert it precisely.
    if (descriptorAbsentStatus !== null) {
      await expect(mero.admin.getIntentRelay(contextId)).rejects.toMatchObject({
        status: descriptorAbsentStatus,
      });
      return;
    }

    // The read a client makes BEFORE signing. Two things it cannot derive: whose
    // account goes in the warrant's `executor`, and whether this node may act
    // here. Both come from one call, on the path the intent will be presented
    // to.
    const relay = await mero.admin.getIntentRelay(contextId);

    expect(relay.executorAccount).toBe(relayAccount);
    // Not an error — the default state of every context, since the capability
    // is implied by neither membership nor admin. A client has to be able to
    // *get* this answer in order to say "ask an admin" rather than presenting a
    // warrant that will be refused after spending a nonce on it.
    expect(relay.canAuthorOnBehalf).toBe(false);
    // The group whose admin has to grant it — which is the namespace root here.
    expect(relay.groupId).toBe(namespaceId);
  }, 60_000);

  it('refuses the intent before the relay is granted authorship', async () => {
    // The grant is implied by neither membership nor admin, and this is what
    // proves it. Refused at the API, never published as a delta peers would drop.
    //
    // Minted once and reused below on purpose: the same bytes are refused, then
    // accepted, then refused. That makes the grant the only thing that changed
    // between the first two — a fresh warrant each time would not.
    warrant = await mintWarrant(1);

    await expect(
      mero.admin.performIntent(contextId, {
        method: 'set',
        argsJson: ARGS,
        warrant,
        authorProof: device.credential,
      }),
    ).rejects.toThrow(/CAN_AUTHOR_ON_BEHALF/);
  }, 60_000);

  it('performs the intent once the relay may author on behalf', async () => {
    await mero.admin.setMemberCapabilities(namespaceId, relayAccount, {
      // Bit 9 — authorship and nothing else, which is the posture the
      // capability exists to make possible.
      capabilities: 512,
    });

    const result = await mero.admin.performIntent(contextId, {
      method: 'set',
      argsJson: ARGS,
      warrant,
      authorProof: device.credential,
    });

    // The root, not merely a 2xx. An accepted intent that advanced no state is a
    // real failure mode — it happened during core's own rollout, where the
    // endpoint reported a null delta id for a run that wrote nothing.
    expect(result.rootHash).toBeTruthy();

    // The descriptor now reports what the write just proved. Asserting it here
    // rather than in its own case is deliberate: the grant is the ONLY thing
    // that changed since the `false` above, so the pair pins that this field
    // tracks the capability and is not a constant. Gated on the same probe as
    // that `false`, so the two either both assert the real answer or both assert
    // its absence, and the pairing holds either way.
    if (descriptorAbsentStatus === null) {
      await expect(mero.admin.getIntentRelay(contextId)).resolves.toMatchObject({
        executorAccount: relayAccount,
        canAuthorOnBehalf: true,
      });
    } else {
      await expect(mero.admin.getIntentRelay(contextId)).rejects.toMatchObject({
        status: descriptorAbsentStatus,
      });
    }
  }, 60_000);

  it('refuses a spent warrant', async () => {
    // The very same warrant, now spent. Its signature is still perfectly valid:
    // replay is not forgery, which is why the nonce ledger has to exist and why
    // the envelope check cannot be what stops it.
    await expect(
      mero.admin.performIntent(contextId, {
        method: 'set',
        argsJson: ARGS,
        warrant,
        authorProof: device.credential,
      }),
    ).rejects.toThrow(/nonce/i);
  }, 60_000);

  /**
   * The two signers agree byte for byte over identical inputs.
   *
   * This is the check the acceptance tests above can only imply. A node saying
   * yes proves it accepted *these* bytes for *this* one intent; it says nothing
   * about a field the two implementations encode differently but that this
   * particular input never exercises, and when it does fail it fails as an
   * opaque 4xx that names nothing.
   *
   * Comparing the hex directly fails at the divergence instead, which is what
   * makes "a borsh encoding kept byte-identical with the node's forever" a
   * testable claim rather than a hope. It needs `merod account warrant
   * --not-after`, since the deadline is signed over and merod otherwise takes it
   * from its own clock.
   */
  it('produces the same bytes merod does, for the same inputs', async () => {
    const notAfter = deadline();
    const nonce = 99;

    // Awaited, not left to `.resolves` — an un-awaited assertion is currently
    // auto-awaited by vitest and will simply stop asserting in vitest 3, which
    // would leave this passing while comparing nothing.
    await expect(mintWarrant(nonce, notAfter)).resolves.toBe(
      mintWarrantWithMerod(nonce, notAfter),
    );
  }, 60_000);

  /**
   * A warrant over the same intent, at the given nonce — signed by THIS SDK.
   *
   * `notAfter` is Unix seconds, and the window only has to outlast the request.
   * A generous one keeps the suite from going red on a slow runner while still
   * being finite, since an unbounded warrant is the thing the field exists to
   * prevent.
   */
  function mintWarrant(nonce: number, notAfter = deadline()): Promise<string> {
    return signWarrant({
      context: contextId,
      authorAccount: device.account,
      executor: relayAccount,
      method: 'set',
      argsJson: ARGS,
      nonce,
      notAfter,
      deviceSecret: device.secret,
    });
  }

  /** A deadline that outlasts the request without being unbounded. */
  function deadline(): number {
    return Math.floor(Date.now() / 1000) + 300;
  }

  /** The same warrant as `merod` mints it, for the byte comparison. */
  function mintWarrantWithMerod(nonce: number, notAfter: number): string {
    return merod([
      'account',
      'warrant',
      '--context',
      contextId,
      '--method',
      'set',
      '--args',
      JSON.stringify(ARGS),
      '--executor',
      relayAccount,
      '--nonce',
      String(nonce),
      '--not-after',
      String(notAfter),
      '--device-secret',
      device.secret,
      '--credential',
      device.credential,
    ]).trim();
  }

});
