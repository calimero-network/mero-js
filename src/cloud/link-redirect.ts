/**
 * Linking an account to a cloud login **from a browser**.
 *
 * The cloud's own accounts screen says it plainly: *"The cloud cannot link an
 * account on your behalf: proving you own it is a signature by the account root
 * key, which the cloud never holds."* So the link needs two things that live in
 * different places — a cloud session, which only Google can mint, and a root
 * signature, which only the holder can make. Neither side can do it alone.
 *
 * The cloud already implements its half: send a person to
 * `?link-account=<id>&callback-url=<url>`, it shows a consent screen and
 * redirects back with a **grant** — that login's sealed consent to link one
 * named account. This module is the missing other half, and it is deliberately
 * small: send them there, then spend what comes back.
 *
 * ## Why a grant rather than a session
 *
 * A grant is spendable by anyone holding the account's root, and by nobody
 * else. That is what lets the page complete the link while holding **no cloud
 * session at all** — and it is why a wallet should never be handed one. A
 * session token is a credential for everything that login can do; a grant is a
 * credential for exactly one link, to exactly one account, sealed at the moment
 * the person read the id on screen and agreed to it.
 *
 * ## The account id is chosen by us and read by them
 *
 * The cloud seals the account into the grant at consent time, and its own note
 * says why: the server can check that the key which later signs derives that
 * same account, but *"it cannot know whether the person meant this account"*.
 * The consent screen is that check. So show the same id the person will see,
 * before sending them — a wallet that hides it has removed the only safeguard.
 */

import { CloudClient } from './cloud-client.js';
import type { CloudAccountLink } from './cloud-client.js';
import { resolveRoot, type RootSource } from '../account/account.js';

/** Where the consent screen lives. The web app, not the manager API. */
const DEFAULT_CLOUD_WEB_URL = 'https://cloud.calimero.network';

export interface BeginCloudLinkOptions {
  /** The account to link — 64 hex. Show this to the person before redirecting. */
  accountId: string;
  /**
   * Where the cloud sends them back. Must be `https:`, or `http:` on localhost.
   *
   * The grant returns in the URL **fragment**, which is never sent to a server,
   * so it does not land in anyone's access log on the way.
   */
  returnTo: string;
  /** The cloud's web origin. Defaults to the hosted one. */
  cloudWebUrl?: string;
}

/** The consent URL to send a person to. */
export function cloudLinkUrl(options: BeginCloudLinkOptions): string {
  if (!/^[0-9a-f]{64}$/.test(options.accountId)) {
    throw new Error('accountId must be 64 lowercase hex characters');
  }
  const url = new URL(options.cloudWebUrl ?? DEFAULT_CLOUD_WEB_URL);
  url.searchParams.set('link-account', options.accountId);
  url.searchParams.set('callback-url', options.returnTo);
  return url.toString();
}

/** Send the person to the cloud to consent. Does not return. */
export function beginCloudLink(options: BeginCloudLinkOptions): never {
  window.location.assign(cloudLinkUrl(options));
  // `assign` does not stop execution, and a caller that kept going would act on
  // a page already being replaced.
  throw new Error('redirecting to the cloud to authorise this link');
}

/** What came back in the fragment, if anything. */
export interface CloudLinkCallback {
  grant: string;
  /** The account the cloud sealed into the grant. */
  account: string;
}

/**
 * Read a grant out of the current URL fragment, and strip it.
 *
 * Returns `null` when this is an ordinary page load, so a caller can run it
 * unconditionally at startup. Throws when the person declined, because that is
 * an outcome the app has to show rather than a state to wait in.
 */
export function readCloudLinkCallback(
  location: { hash: string } = window.location,
): CloudLinkCallback | null {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const error = params.get('error');
  if (error) {
    stripFragment();
    throw new Error(
      error === 'denied'
        ? 'the account link was declined at the cloud'
        : `the cloud refused this link: ${error}`,
    );
  }

  const grant = params.get('grant');
  const account = params.get('account');
  if (!grant || !account) return null;

  // Consumed once. Leaving it in the bar means a reload replays a spent grant
  // and reports a confusing failure instead of the link that already worked.
  stripFragment();
  return { grant, account };
}

function stripFragment(): void {
  if (typeof history === 'undefined' || !history.replaceState) return;
  history.replaceState(null, '', location.pathname + location.search);
}

export interface CompleteCloudLinkOptions extends CloudLinkCallback {
  /** The account root — a 64-hex secret, or a Signer over a key you cannot read. */
  root: RootSource;
  /** The **manager** API base, e.g. `https://manager.cloud.calimero.network`. */
  cloudBaseUrl?: string;
  fetch?: typeof fetch;
}

/**
 * Spend the grant: sign it with the root and hand it back to the cloud.
 *
 * Anonymous by construction — the client is built with no session, because the
 * whole point is that the page never needed one.
 *
 * @throws if the grant names a different account than the root derives, before
 * anything is sent. The cloud checks this too, but failing here says which two
 * accounts disagreed rather than returning a bare 403.
 */
export async function completeCloudLink(
  options: CompleteCloudLinkOptions,
): Promise<CloudAccountLink> {
  const root = await resolveRoot(options.root);
  if (root.accountId !== options.account) {
    throw new Error(
      `this grant is for account ${options.account}, but the root here derives ` +
        `${root.accountId} — it was minted for a different account`,
    );
  }

  const cloud = new CloudClient({
    cloudBaseUrl: options.cloudBaseUrl,
    fetch: options.fetch,
  });
  return cloud.linkAccountWithGrant({ grant: options.grant, signer: root.signer });
}
