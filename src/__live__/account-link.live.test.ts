/**
 * Linking a Calimero account to a cloud login, end to end against a real cloud.
 *
 * This is the hop that makes delegated execution billable: namespace-scoped
 * reads authenticate as an *account*, and the link is what lets a plan be
 * enforced against one and a bill attributed to someone. It is also what lets a
 * person who has lost every device still be told which namespaces their account
 * belongs to — the cloud login survives the device, which is the case the link
 * exists to serve.
 *
 * ## Why this needs a session you cannot mint here
 *
 * `POST /api/cloud/me/accounts` binds an account to *this caller's* login, and
 * the challenge is HMAC-sealed to the caller's email so a nonce minted for one
 * login cannot link an account under another. So the first half needs a cloud
 * session, which comes from Google and cannot be obtained headlessly. Paste one
 * in `CLOUD_SESSION` and this runs; otherwise it skips.
 *
 * The second half is the interesting one and needs no Google at all: once
 * linked, the root alone can open a session. That is the property the whole
 * design rests on — the account is the credential, not the login.
 *
 *     CLOUD_URL=https://cloud.calimero.network \
 *     CLOUD_SESSION=<token> \
 *     LIVE_ROOT_SECRET=<64 hex> \
 *     npx vitest run src/__live__/account-link.live.test.ts
 *
 * `LIVE_ROOT_PHRASE` works instead of the secret, so a phrase-held root can be
 * linked without ever writing its bytes into an environment variable.
 */
import { describe, expect, it, beforeAll } from 'vitest';

import { CloudClient } from '../cloud/cloud-client.js';
import { accountRootSignerFromPhrase } from '../account/account.js';
import { resolveRoot, type ResolvedRoot } from '../account/account.js';

const CLOUD = process.env.CLOUD_URL;
const SESSION = process.env.CLOUD_SESSION;
const ROOT_SECRET = process.env.LIVE_ROOT_SECRET;
const ROOT_PHRASE = process.env.LIVE_ROOT_PHRASE;

const haveRoot = Boolean(ROOT_SECRET || ROOT_PHRASE);
const live = CLOUD && SESSION && haveRoot ? describe : describe.skip;

live('linking an account to a cloud login', () => {
  let root: ResolvedRoot;
  let client: CloudClient;

  beforeAll(async () => {
    // A phrase never becomes a string the shell logged: it derives a signer,
    // and only the signer is handed on.
    root = ROOT_PHRASE
      ? await resolveRoot((await accountRootSignerFromPhrase(ROOT_PHRASE)).signer)
      : await resolveRoot(ROOT_SECRET!);

    client = new CloudClient({ cloudBaseUrl: CLOUD, sessionToken: SESSION });
    console.log('account under test:', root.accountId);
  });

  it('links, and is idempotent for the same login', async () => {
    const first = await client.linkAccount(root.signer);
    expect(first.accountId).toBe(root.accountId);

    // Re-linking by the same caller must be a no-op rather than a 409: a client
    // that retries a timed-out request must not be punished for it.
    const again = await client.linkAccount(root.signer);
    expect(again.accountId).toBe(root.accountId);
    console.log('linked:', { linkedAt: first.linkedAt, alreadyLinked: again.alreadyLinked });
  }, 60_000);

  it('lists the account against this login', async () => {
    const mine = await client.getMyAccounts();
    const ids = (mine.accounts ?? []).map((a) => a.accountId ?? a.account_id);
    expect(ids).toContain(root.accountId);
  }, 30_000);

  /**
   * The half that matters for a browser: no Google, no stored session, just the
   * root proving the account is its own.
   *
   * A fresh client is used deliberately — reusing the one above would pass on
   * the session it already holds and prove nothing.
   */
  it('signs in with the account alone, once linked', async () => {
    const anonymous = new CloudClient({ cloudBaseUrl: CLOUD });
    const session = await anonymous.signInWithAccount(root.signer);

    expect(session.sessionToken).toMatch(/^ey/);
    console.log('account session for:', session.user?.email ?? '(no email on session)');
  }, 60_000);

  /**
   * What part 3 needs: which namespaces this account can reach, and which
   * relays serve them.
   *
   * Recorded rather than asserted — a freshly linked account legitimately owns
   * no namespace, and failing here would report an empty account as a broken
   * link. What we are looking for is the *shape*, in particular whether a relay
   * comes with anything a client could pin as its node key.
   */
  it('reports namespaces and relays for the linked account', async () => {
    const namespaces = await client.getMyNamespaces();
    console.log('namespaces:', namespaces.map((n) => n.namespaceId));

    for (const ns of namespaces.slice(0, 2)) {
      const relays = await client.getNamespaceRelays(ns.namespaceId);
      console.log(`relays for ${ns.namespaceId.slice(0, 12)}…:`, JSON.stringify(relays, null, 1));
    }
    expect(Array.isArray(namespaces)).toBe(true);
  }, 60_000);
});
