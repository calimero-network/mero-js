/**
 * Linking a Calimero account to a cloud login, end to end against a real cloud.
 *
 * `CLOUD_URL` is the **manager** host, not the web one:
 * `https://manager.cloud.calimero.network`. `cloud.calimero.network` serves the
 * React app, so an API call there returns 405 and an HTML body — which is how
 * this test first failed, and why the SDK's own default base URL is wrong.
 *
 * This is the hop that makes delegated execution billable: namespace-scoped
 * reads authenticate as an *account*, and the link is what lets a plan be
 * enforced against one and a bill attributed to someone. It is also what lets a
 * person who has lost every device still be told which namespaces their account
 * belongs to — the cloud login survives the device, which is the case the link
 * exists to serve.
 *
 * ## Two ways to link, and they are not equivalent
 *
 * `POST /api/cloud/me/accounts` binds an account to *this caller's* login: the
 * challenge is HMAC-sealed to the caller's email, so a nonce minted for one
 * login cannot link an account under another. It needs a cloud session, which
 * comes from Google and cannot be minted headlessly — set `CLOUD_SESSION`.
 *
 * `POST /api/cloud/accounts/link` spends a single-use **grant** and is
 * anonymous. That is the path a wallet page should use: a session token handed
 * to a page is a credential for everything that login can do, whereas a grant
 * is a credential for exactly one link. Set `GRANT` instead.
 *
 * Either way the third check is the point — once linked, the ROOT ALONE opens a
 * session, with no Google and no stored token. That is the property the design
 * rests on: the account is the credential, not the login.
 *
 *     CLOUD_URL=https://cloud.calimero.network \
 *     GRANT=<one-time grant>   # or CLOUD_SESSION=<token> \
 *     LIVE_ROOT_SECRET=<64 hex>  # or LIVE_ROOT_PHRASE='<24 words>' \
 *     npx vitest run src/__live__/account-link.live.test.ts
 *
 * A phrase is preferred over a secret: it derives a signer, so the root's bytes
 * never pass through an environment variable or a shell history.
 */
import { describe, expect, it, beforeAll } from 'vitest';

import { CloudClient } from '../cloud/cloud-client.js';
import { accountRootSignerFromPhrase } from '../account/account.js';
import { resolveRoot, type ResolvedRoot } from '../account/account.js';

const CLOUD = process.env.CLOUD_URL;
const SESSION = process.env.CLOUD_SESSION;
/**
 * A single-use link grant, minted by the cloud for a signed-in user and carried
 * back through a redirect.
 *
 * The better of the two paths, and the one a wallet page would actually use:
 * it is spent **anonymously**, so the page linking an account never needs the
 * user's cloud session at all — only a token scoped to this one link. A session
 * token handed to a page is a credential for everything that login can do; a
 * grant is a credential for exactly one thing.
 */
const GRANT = process.env.GRANT;
const ROOT_SECRET = process.env.LIVE_ROOT_SECRET;
const ROOT_PHRASE = process.env.LIVE_ROOT_PHRASE;

const haveRoot = Boolean(ROOT_SECRET || ROOT_PHRASE);
const live = CLOUD && SESSION && haveRoot ? describe : describe.skip;
const liveGrant = CLOUD && GRANT && haveRoot ? describe : describe.skip;

/** Shared by both suites: a root from whichever form was supplied. */
async function rootFromEnv(): Promise<ResolvedRoot> {
  // A phrase never becomes a string the shell logged: it derives a signer, and
  // only the signer is handed on.
  return ROOT_PHRASE
    ? resolveRoot((await accountRootSignerFromPhrase(ROOT_PHRASE)).signer)
    : resolveRoot(ROOT_SECRET!);
}

live('linking an account to a cloud login', () => {
  let root: ResolvedRoot;
  let client: CloudClient;

  beforeAll(async () => {
    root = await rootFromEnv();

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

liveGrant('linking with a one-time grant', () => {
  let root: ResolvedRoot;

  beforeAll(async () => {
    root = await rootFromEnv();
    console.log('account under test:', root.accountId);
  });

  /**
   * No session anywhere in this test, deliberately.
   *
   * The client is constructed without one and the call is anonymous — which is
   * the whole point of the grant. If this passes, a wallet page can link an
   * account while holding nothing but a single-use token it was handed.
   */
  it('links the account, with no cloud session at all', async () => {
    const anonymous = new CloudClient({ cloudBaseUrl: CLOUD });
    const link = await anonymous.linkAccountWithGrant({ grant: GRANT!, signer: root.signer });

    expect(link.accountId).toBe(root.accountId);
    console.log('linked:', { linkedAt: link.linkedAt, alreadyLinked: link.alreadyLinked });
  }, 60_000);

  /**
   * A grant is single-use, and spending it twice must be refused.
   *
   * Worth asserting rather than assuming: a grant that could be replayed would
   * let anyone who saw it in a redirect URL link their own account to somebody
   * else's login.
   */
  it('refuses the same grant a second time', async () => {
    const anonymous = new CloudClient({ cloudBaseUrl: CLOUD });
    const replayed = await anonymous
      .linkAccountWithGrant({ grant: GRANT!, signer: root.signer })
      .then(() => null, (e: { status?: number }) => e);

    expect(replayed).not.toBeNull();
    // The STATUS matters, not merely that it threw. An earlier version asserted
    // `.rejects.toThrow()` and went green against a 405 from the wrong host —
    // a test that passes when the API is not even there is worse than none.
    // 403 is a spent or bad grant; 409 is the account already bound elsewhere.
    expect([403, 409]).toContain((replayed as { status?: number }).status);
  }, 60_000);

  it('signs in with the account alone, once linked', async () => {
    const anonymous = new CloudClient({ cloudBaseUrl: CLOUD });
    const session = await anonymous.signInWithAccount(root.signer);
    expect(session.sessionToken).toMatch(/^ey/);
    console.log('account session for:', session.user?.email ?? '(no email on session)');
  }, 60_000);
});
