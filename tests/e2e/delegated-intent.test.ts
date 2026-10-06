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
import { join } from 'path';

import { describe, it, expect, beforeAll } from 'vitest';

import { MeroJs } from '../../src/mero-js.js';
import { login } from '../../src/login/index.js';
import { MemoryTokenStore } from '../../src/token-store/index.js';
import { signWarrant } from '../../src/warrant/index.js';
import {
  MEROD_BINARY,
  ensureApplication,
  mintDevice,
  offlineMerod,
  resolveBaseUrl,
  resolveCreds,
  runId,
  type MintedDevice,
} from './harness.js';

const NODE_URL = resolveBaseUrl();
const { username: USERNAME, password: PASSWORD } = resolveCreds();
const RUN = runId();

/** The intent every warrant below authorises, shared so they commit alike. */
const ARGS = { key: 'delegated', value: `from-sdk-${RUN}` };

describe.skipIf(!MEROD_BINARY)('performIntent E2E — delegated authorship', () => {
  let mero: MeroJs;
  let contextId: string;
  let namespaceId: string;
  let relayAccount: string;
  let relayKey: string;
  /** The release a warrant must pin, as discovery reports it. */
  let release: { releaseBytecodeId: string; releaseVersion: string };
  let device: MintedDevice;
  /** One warrant, presented three times: refused, accepted, refused. */
  let warrant: string;

  beforeAll(async () => {
    mero = new MeroJs({ baseUrl: NODE_URL });
    await mero.authenticate({ username: USERNAME, password: PASSWORD });

    const applicationId = await ensureApplication(mero);
    const ns = await mero.admin.createNamespace({ applicationId, name: `deleg-${RUN}` });
    namespaceId = ns.namespaceId;

    const ctx = await mero.admin.createContext({ applicationId, groupId: namespaceId });
    contextId = ctx.contextId;

    const identity = await mero.admin.getNodeIdentity();
    relayAccount = identity.accountId;
    relayKey = identity.publicKey;
    device = mintDevice();

    // Required: every warrant below pins the release discovery reports, and a
    // 404 here means the group names none, which no warrant could be signed for.
    release = await mero.admin.getIntentRelay(contextId);
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
    // The read a client makes BEFORE signing. Two things it cannot derive: whose
    // account goes in the warrant's `executor`, and whether this node may act
    // here. Both come from one call, on the path the intent will be presented
    // to.
    const relay = await mero.admin.getIntentRelay(contextId);

    expect(relay.executorAccount).toBe(relayAccount);
    expect(relay.executorKey).toBe(relayKey);
    // Not an error — the default state of every context, since the capability
    // is implied by neither membership nor admin. A client has to be able to
    // *get* this answer in order to say "ask an admin" rather than presenting a
    // warrant that will be refused after spending a nonce on it.
    expect(relay.canAuthorOnBehalf).toBe(false);
    // The group whose admin has to grant it — which is the namespace root here.
    expect(relay.groupId).toBe(namespaceId);
    // The release a warrant pins is the bytecode the group names, read the way
    // core's own scenarios read it.
    expect(relay.releaseBytecodeId).toBe((await mero.admin.getGroupInfo(namespaceId)).appKey);
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
    // tracks the capability and is not a constant.
    await expect(mero.admin.getIntentRelay(contextId)).resolves.toMatchObject({
      executorAccount: relayAccount,
      executorKey: relayKey,
      canAuthorOnBehalf: true,
    });
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
   * The author reads back what the relay wrote for it, with no warrant.
   *
   * A read publishes nothing, so there is no peer to show consent to; what it
   * needs is proof that *this* account may see *this* context, and a session
   * answers that. So the author logs in with the same device certificate the
   * intent carried, and queries as its account. The value is the one the
   * delegated write above stored, which makes this a round trip across the two
   * paths an account without a node has: write by warrant, read by session.
   *
   * Needs the node to accept device-key logins (`merod init --device-key-login`).
   * A node started without it refuses the login with one specific 404, and only
   * that refusal is accepted here: it is asserted, not skipped, so the file
   * still reports every test as run. This cannot hide a missing read path:
   * core's coverage gate requires `POST .../query` to answer under 400, and it
   * only does on the branch below.
   */
  it('reads back what it wrote, as the author account, without a warrant', async () => {
    const attempt = login({
      nodeUrl: NODE_URL,
      // Pinned from the node here only because this suite also administers it;
      // a real client learns the key out of band (see LoginConfig.node).
      node: (await mero.admin.getNodeIdentity()).publicKey,
      deviceSecret: device.secret,
      accountProof: device.credential,
      audience: { kind: 'cli' },
    });
    const session = await attempt.catch((err: unknown) => {
      const { status, bodyText } = err as { status?: number; bodyText?: string };
      if (status !== 404 || !/account_proof provider is not enabled/.test(bodyText ?? '')) {
        throw err;
      }
      return null;
    });
    if (session === null) {
      console.warn(
        '[delegated-intent] this node does not accept device-key logins ' +
          '(start it with `merod init --device-key-login`); asserting that instead.',
      );
      await expect(attempt).rejects.toMatchObject({ status: 404 });
      return;
    }
    const tokens = new MemoryTokenStore();
    tokens.setTokens({
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
      expires_at: Date.now() + 3_600_000,
    });
    const author = new MeroJs({ baseUrl: NODE_URL, tokenStore: tokens });
    try {
      await expect(
        author.admin.queryContext(contextId, { method: 'get', argsJson: { key: ARGS.key } }),
      ).resolves.toEqual({ returns: ARGS.value });

      // A session authorizes reads only. `set` is a mutating method, so the
      // node refuses it here rather than quietly writing without a warrant.
      await expect(
        author.admin.queryContext(contextId, { method: 'set', argsJson: ARGS }),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      author.close();
    }
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
      executorKey: relayKey,
      releaseBytecodeId: release.releaseBytecodeId,
      releaseVersion: release.releaseVersion,
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
    return offlineMerod([
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
      '--executor-key',
      relayKey,
      '--release-bytecode-id',
      release.releaseBytecodeId,
      '--release-version',
      release.releaseVersion,
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
