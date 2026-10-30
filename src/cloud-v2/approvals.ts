/**
 * Release and upgrade approvals as core's node reports them, and the consent
 * page an app sends its user to when one is theirs to make.
 *
 * An app never approves in its own page. A passkey assertion is blind (the
 * authenticator shows a site name, never what the challenge commits to), so
 * the page that runs the ceremony decides what the person believes they
 * approve. The node therefore refuses every approval route to a session
 * opened on an app's frontend, and serves its own **consent page** instead:
 * the app asks for a request (`POST /consent/requests`), sends the person to
 * the page's `url` on the node's own origin, and reads the decision when the
 * page sends them back (`returnTo?request_id=…&result=…`) or from
 * `GET /consent/{id}/result`. See core's
 * [consent page](https://calimero-network.github.io/core/protocol/consent-page/)
 * and [governance](https://calimero-network.github.io/core/protocol/governance/).
 */

import { compareReleaseVersions } from '../sealed/release.js';

// ---------------------------------------------------------------- governance

/**
 * Who holds one decision on a cluster (core's `Authority`), fixed at genesis
 * and attested by every replica. `owner`: the parties around each app, with a
 * passkey (for release approvals the app's publisher, for upgrades whoever
 * its package's manifest names); `operator`: the operator, for every app.
 */
export type Authority = 'owner' | 'operator';

/** Core's `Governance`: which side holds each decision on this cluster. */
export interface Governance {
  releases: Authority;
  appUpgrades: Authority;
  outbound: Authority;
}

/**
 * Who upgrades a package's instances, as its signed manifest declares
 * (`upgrades`; absent means `owner`), where the cluster leaves app upgrades to
 * owners. `owner`: each instance's owner (an organization's
 * `MANAGE_APPLICATION` holders); `publisher`: the `MANAGE_APPLICATION`
 * holders of the organization the package's signing key is bound to, for
 * every instance ({@link CalimeroClient.upgradePublished}). A package may move
 * from `publisher` to `owner` in a later release, never back.
 */
export type UpgradeAuthority = 'owner' | 'publisher';

// ---------------------------------------------------------------- reports

/** Whose approvals a report covers: an organization's, or the account's own apps. */
export type ReportScope = { kind: 'account' } | { kind: 'org'; org: string };

/** A package release as a report names it. */
export interface ReportedRelease {
  package: string;
  version: string;
  /** The service, for a multi-service bundle (account reports only). */
  service?: string | null;
}

/** A bundle as a report names it: its digest, and its release where the reader may see it. */
export interface ReportedBundle {
  bundle: string;
  package?: string;
  version?: string;
}

/** Who made an upgrade, by kind. */
export type ActorKind = 'owner' | 'member' | 'operator';

/** An app's last upgrade. `actor`, `error` and `run` are left out of the operator's report. */
export interface LastUpgrade {
  from: ReportedBundle;
  to: ReportedBundle;
  /** Unix seconds. */
  at: number;
  ok: boolean;
  actorKind: ActorKind;
  actor?: string;
  error?: unknown;
  run?: string;
}

/** One replica of an app: its node, the node's attested release, and whether the app's set approves it. */
export interface ReportedReplica {
  node: number;
  /** `null` while the node's release is not known yet (it then holds nothing). */
  release: string | null;
  approved: boolean;
}

/** One app in a report. `name`, `team` and `availableVersions` are in members' and accounts' reports only. */
export interface ReportedApp {
  app: string;
  group: number;
  scope: ReportScope;
  /** `hex(SHA-256)` of the WASM it runs. */
  bundle: string;
  package: ReportedRelease | null;
  /** The package's pinned signer (`did:key`). */
  publisher: { signer: string } | null;
  upgradesHeldBy: Authority;
  lastUpgrade: LastUpgrade | null;
  /** The releases approved to hold this app (its publisher's set, or its scope's); `null`: unrestricted. */
  approvedReleases: string[] | null;
  replicas: ReportedReplica[];
  name?: string;
  team?: string;
  /** Newer releases of its package it may be upgraded to, oldest first (at most 16, the newest). */
  availableVersions?: string[];
}

/** A mero-tee release the cluster's nodes run, with how many and whether the scope approved it. */
export interface ClusterRelease {
  release: string;
  nodes: number;
  approved: boolean;
}

/** `GET /auth/apps` or `GET /orgs/{org}/apps`: one page. */
export interface AppsReport {
  scope: ReportScope;
  governance: Governance;
  /** The scope's own approved set, newest last; `null`: none ever recorded (unrestricted). */
  approvedReleases: string[] | null;
  clusterReleases: ClusterRelease[];
  apps: ReportedApp[];
  /** Pass as `after` for the next page; `null` on the last. */
  next: string | null;
}

/** `GET /ops/apps`: one page, for the operator. */
export interface OpsAppsReport {
  /** This node had caught up with the system leader. */
  fresh: boolean;
  governance: Governance;
  apps: ReportedApp[];
  next: string | null;
}

/** `GET /ops/orgs`: one page, for the operator. */
export interface OpsOrgsReport {
  fresh: boolean;
  governance: Governance;
  orgs: Array<{ org: string; approvedReleases: string[] | null }>;
  next: string | null;
}

/** A page of a report: entries after the id `after`, at most `limit` (1 to {@link MAX_REPORT_PAGE}). */
export interface PageOptions {
  after?: string;
  limit?: number;
}

/** The most entries one page of a report answers (core's `MAX_REPORT_PAGE`). */
export const MAX_REPORT_PAGE = 100;

/** `?after=&limit=` for a report route; `limit` outside 1 to 100 is refused before sending. */
export function pageQuery(page: PageOptions = {}): string {
  const q = new URLSearchParams();
  if (page.after !== undefined) q.set('after', page.after);
  if (page.limit !== undefined) {
    if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > MAX_REPORT_PAGE) {
      throw new RangeError(`limit is 1 to ${MAX_REPORT_PAGE}`);
    }
    q.set('limit', String(page.limit));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

// ---------------------------------------------------------------- deadlines

/** A release's end-of-new-work deadline. */
export interface ReleaseDeadline {
  version: string;
  /** RFC 3339. */
  after: string;
  /** Unix seconds. */
  afterSecs: number;
}

/** `GET /releases`: the cluster's release rules, public inside the sealed channel. */
export interface ReleaseRules {
  governance: Governance;
  /** Oldest release first. */
  deadlines: ReleaseDeadline[];
}

/** Semver order (core's `compare_versions`); text order for versions that are not semver. */
export function compareVersions(a: string, b: string): number {
  try {
    return compareReleaseVersions(a, b);
  } catch {
    return a < b ? -1 : a > b ? 1 : 0;
  }
}

/**
 * Whether a scope whose approved set is `approved` has lost new work at `now`
 * (Unix seconds), as core's `SystemState::stalled` judges it: a release's
 * deadline has passed and the newest approved release is older. Names the
 * newest such release, since approving it lifts every one. `null` approved
 * (unrestricted) is never stalled.
 */
export function stalledBy(
  approved: string[] | null,
  deadlines: ReleaseDeadline[],
  now: number = Date.now() / 1000,
): ReleaseDeadline | null {
  if (approved === null || approved.length === 0) return null;
  const newest = approved.reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b));
  let stall: ReleaseDeadline | null = null;
  for (const d of deadlines) {
    if (d.afterSecs <= now && compareVersions(newest, d.version) < 0) {
      if (stall === null || compareVersions(d.version, stall.version) > 0) stall = d;
    }
  }
  return stall;
}

// ---------------------------------------------------------------- publishers

/** `GET /publishers/{signerId}`: what a key signs to bind it here next. */
export interface PublisherBindingInfo {
  signerId: string;
  /** The cluster's name, as the binding message names it. */
  cluster: string;
  /** How many bindings the key has had here: a signature binds once. */
  generation: number;
  bound: boolean;
}

/**
 * The text a package signing key signs to bind it to `org` as its publisher
 * (core's `system::publisher_binding_message`). Take `cluster` and
 * `generation` from {@link CalimeroClient.publisherBinding}; sign the UTF-8
 * bytes with the key's Ed25519 secret and send
 * {@link CalimeroClient.bindPublisher}.
 */
export function publisherBindingMessage(cluster: string, org: string, signerId: string, generation: number): string {
  return `calimero-publisher-binding/v1\n${cluster}\n${org}\n${signerId}\n${generation}`;
}

/** {@link publisherBindingMessage} as the bytes to sign. */
export function publisherBindingBytes(cluster: string, org: string, signerId: string, generation: number): Uint8Array {
  return new TextEncoder().encode(publisherBindingMessage(cluster, org, signerId, generation));
}

/** `POST /orgs/{org}/publishers`: the key's proof, base64url without padding. */
export interface PublisherProof {
  signerId: string;
  /** The Ed25519 public key the `did:key` names. */
  publicKey: string;
  /** Its signature over {@link publisherBindingMessage}. */
  signature: string;
}

// ---------------------------------------------------------------- consent page

/** Whose approval a release or outbound request is for. */
export type ConsentScope = 'account' | { org: string };

/** What the app asks its user to approve (`POST /consent/requests`). Unknown fields are refused. */
export type ConsentRequest =
  | {
      kind: 'release';
      scope: ConsentScope;
      /** `withdraw: true` asks to withdraw the release's approval instead of approving it. */
      subject: { version: string; withdraw?: boolean };
      /** Where the page sends the person back: the package's frontend origin, or one its manifest names. */
      returnTo: string;
    }
  | {
      kind: 'upgrade';
      subject: { app: string; toVersion: string };
      returnTo: string;
    }
  | {
      kind: 'outbound';
      scope: ConsentScope;
      /** `package`: a package-bound session's own when left out; `prefixes`: every one the latest release declares. */
      subject: { package?: string; prefixes?: string[] };
      returnTo: string;
    };

/** The node's answer to a consent request: send the person to `url`. */
export interface ConsentStarted {
  requestId: string;
  /** The consent page, on the node's own origin. */
  url: string;
  /** Unix seconds; a request lives 10 minutes. */
  expiresAt: number;
  /**
   * The confirmation code the consent page shows, `XXX-XXX`
   * ({@link confirmationCode} of `requestId`). Show it to the person before
   * sending them to `url`: the page they land on should show the same code,
   * which tells them it is the page their request opened. Not a secret.
   * Nodes older than the code leave it out.
   */
  code?: string;
}

/** How {@link CalimeroClient.openConsentPage} sends the person to the page. */
export interface OpenConsentOptions {
  /** Sends the browser to the page's `url`; by default `window.location.assign`. */
  navigate?: (url: string) => void;
  /**
   * Runs after the node answers and before navigating, with the answer: show
   * the person `started.code` here so they can check the page shows the same.
   * Answer `false` and the page is not opened (the request stays on the node
   * until it expires).
   */
  confirm?: (started: ConsentStarted) => boolean | Promise<boolean>;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * The confirmation code the node's consent page shows for `requestId`: the
 * first 30 bits of SHA-256 of its UTF-8 bytes, big-endian, as six Crockford
 * base32 characters written `XXX-XXX` (core's consent page). Compare it with
 * {@link ConsentStarted.code} to check the node's answer.
 */
export async function confirmationCode(requestId: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(requestId)));
  const word = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
  let code = '';
  for (let i = 0; i < 6; i++) {
    if (i === 3) code += '-';
    code += CROCKFORD[(word >>> (27 - 5 * i)) & 31];
  }
  return code;
}

export type ConsentStatus = 'pending' | 'approved' | 'declined';

/** `GET /consent/{id}/result`. */
export interface ConsentResult {
  requestId: string;
  kind: ConsentRequest['kind'];
  status: ConsentStatus;
  /** Unix seconds, once decided. */
  decidedAt: number | null;
}

/**
 * What the consent page put on `returnTo` when it sent the person back, or
 * `null` when `href` carries none. A hint only (anyone can type a URL): confirm
 * with {@link CalimeroClient.consentResult} before acting on it.
 */
export function consentReturn(href: string | URL): { requestId: string; result: 'approved' | 'declined' } | null {
  const url = typeof href === 'string' ? new URL(href) : href;
  const requestId = url.searchParams.get('request_id');
  const result = url.searchParams.get('result');
  if (!requestId || (result !== 'approved' && result !== 'declined')) return null;
  return { requestId, result };
}

// ---------------------------------------------------------------- pending

/** The public verifier for mero-tee releases (`attestation-verifier`). */
export const RELEASE_VERIFIER = 'https://mero-tee.vercel.app';

/** A mero-tee release's notes on GitHub. */
export function releaseNotesUrl(version: string): string {
  return `https://github.com/calimero-network/mero-tee/releases/tag/mero-tee-v${encodeURIComponent(version)}`;
}

/** The public verifier's page for a mero-tee release. */
export function verifyReleaseUrl(version: string): string {
  return `${RELEASE_VERIFIER}/mero-tee?release_tag=${encodeURIComponent(`mero-tee-v${version}`)}`;
}

/** A mero-tee release the cluster's nodes run that the scope has not approved. */
export interface PendingRelease {
  version: string;
  /** How many of the cluster's nodes run it. */
  nodes: number;
  /** Whether the scope's side holds release approvals (else the operator does). */
  actionable: boolean;
  releaseNotesUrl: string;
  verifyUrl: string;
  /** Its deadline, when it carries one. */
  deadline: ReleaseDeadline | null;
}

/** An app with newer releases of its package. */
export interface PendingUpgrade {
  app: string;
  name: string | null;
  package: string;
  from: string;
  /** The newest it may move to. */
  to: string;
  /** Every newer release it may move to, oldest first. */
  available: string[];
  /** Whether owners hold app upgrades on this cluster; the node checks the package's own `upgrades` when asked. */
  actionable: boolean;
}

/** What {@link CalimeroClient.pendingApprovals} answers. */
export interface PendingApprovals {
  scope: ReportScope;
  governance: Governance;
  approvedReleases: string[] | null;
  releases: PendingRelease[];
  upgrades: PendingUpgrade[];
  /** A passed deadline has stopped new work for the scope: approve `stalledBy.version` (or newer) to lift it. */
  stalledBy: ReleaseDeadline | null;
  /** Whether anything here is the user's to approve. */
  actionable: boolean;
}

/**
 * The pending list from a scope's report pages (every page's apps
 * concatenated into `report.apps`) and the cluster's release rules.
 */
export function pendingApprovalsFrom(report: AppsReport, rules: ReleaseRules, now: number = Date.now() / 1000): PendingApprovals {
  const deadlineOf = (v: string) => rules.deadlines.find((d) => d.version === v) ?? null;
  const releasesActionable = report.governance.releases === 'owner';
  const upgradesActionable = report.governance.appUpgrades === 'owner';
  const releases: PendingRelease[] = report.clusterReleases
    .filter((r) => !r.approved)
    .sort((a, b) => compareVersions(b.release, a.release))
    .map((r) => ({
      version: r.release,
      nodes: r.nodes,
      actionable: releasesActionable,
      releaseNotesUrl: releaseNotesUrl(r.release),
      verifyUrl: verifyReleaseUrl(r.release),
      deadline: deadlineOf(r.release),
    }));
  const upgrades: PendingUpgrade[] = [];
  for (const a of report.apps) {
    const available = a.availableVersions ?? [];
    if (a.package === null || available.length === 0) continue;
    upgrades.push({
      app: a.app,
      name: a.name ?? null,
      package: a.package.package,
      from: a.package.version,
      to: available[available.length - 1],
      available,
      actionable: upgradesActionable,
    });
  }
  return {
    scope: report.scope,
    governance: report.governance,
    approvedReleases: report.approvedReleases,
    releases,
    upgrades,
    stalledBy: stalledBy(report.approvedReleases, rules.deadlines, now),
    actionable: releases.some((r) => r.actionable) || upgrades.some((u) => u.actionable),
  };
}

/**
 * The consent request that approves `version` for `scope`, or with
 * `{ withdraw: true }` withdraws its approval ({@link withdrawConsent}).
 */
export function releaseConsent(
  scope: ReportScope,
  version: string,
  returnTo: string,
  options: { withdraw?: boolean } = {},
): ConsentRequest {
  return {
    kind: 'release',
    scope: scope.kind === 'org' ? { org: scope.org } : 'account',
    subject: options.withdraw ? { version, withdraw: true } : { version },
    returnTo,
  };
}

/**
 * The consent request that withdraws `version`'s approval for `scope`: nodes
 * on it are then sent none of the scope's apps' data (nothing already there
 * moves). The page fetches no measurements for it. Withdrawing the scope's
 * last approved release is refused on the page (`400 REJECTED`, the request
 * stays pending), and the page warns before.
 */
export function withdrawConsent(scope: ReportScope, version: string, returnTo: string): ConsentRequest {
  return releaseConsent(scope, version, returnTo, { withdraw: true });
}

/**
 * The `release` part of a release request's model, as the consent page reads
 * it (`GET /consent/{id}/model`, on the node's origin; the app never needs
 * it). An approval carries the release's signed measurements; a withdrawal
 * carries none, and says whether the release is approved now and whether it
 * is the scope's last approved release (which cannot be withdrawn).
 */
export type ConsentReleaseModel =
  | {
      version: string;
      change: 'approve';
      alreadyApproved: boolean;
      approved: unknown;
      nodes: unknown;
      profile: string | null;
      measurements: Record<string, unknown>;
    }
  | {
      version: string;
      change: 'withdraw';
      currentlyApproved: boolean;
      lastApproved: boolean;
      approved: unknown;
      nodes: unknown;
      profile: string | null;
    };

/** The consent request that upgrades `app` to `toVersion`. */
export function upgradeConsent(app: string, toVersion: string, returnTo: string): ConsentRequest {
  return { kind: 'upgrade', subject: { app, toVersion }, returnTo };
}
