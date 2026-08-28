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
 * A byte-for-byte comparison against a merod-minted warrant would be stronger
 * and is deliberately absent: `merod account warrant` takes `--valid-for`
 * (seconds from its own clock) rather than an absolute `--not-after`, so the two
 * sides cannot be made to agree on that field, and the signature covers it. Node
 * acceptance is the available proof, and it is the one that matters — it is the
 * node's opinion of these bytes that the SDK exists to satisfy.
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
  }, 180_000);

  it('adds the author by ACCOUNT — its device joins nothing', async () => {
    // By account, not by key. The minted device is in no group's binding rows
    // and never will be, which is exactly the case a certificate covers: a
    // key-based membership check would refuse every write below.
    await mero.admin.addGroupMembers(namespaceId, {
      members: [{ identity: device.account, role: 'Member' }],
    });
  });

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
   * A warrant over the same intent, at the given nonce — signed by THIS SDK.
   *
   * `notAfter` is Unix seconds, and the window only has to outlast the request.
   * A generous one keeps the suite from going red on a slow runner while still
   * being finite, since an unbounded warrant is the thing the field exists to
   * prevent.
   */
  function mintWarrant(nonce: number): Promise<string> {
    return signWarrant({
      context: contextId,
      authorAccount: device.account,
      executor: relayAccount,
      method: 'set',
      argsJson: ARGS,
      nonce,
      notAfter: Math.floor(Date.now() / 1000) + 300,
      deviceSecret: device.secret,
    });
  }

});
