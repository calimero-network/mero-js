/**
 * What the signed-in account has to decide for the apps it owns outside any
 * organization: mero-tee releases (node images) waiting for its approval, and
 * app upgrades it may run. Both are the data owner's decisions, made with
 * their own passkey (consent the node logs); the operator cannot make them
 * for an owner-governed cluster, so an app shows them to its own users.
 *
 * PROVISIONAL: core's read endpoints for this (branch
 * `claude/report-app-versions-and-approvals`) were not published when this was
 * written. Today `GET /auth/me` carries `approvedReleases` and `GET /apps` each
 * app's package and version; the cluster's node releases, each app's available
 * versions and the governance holders are read here under every name that
 * branch is expected to use, and are absent (`null`, empty) until a node
 * reports them. So are release deadlines (branch
 * `claude/release-approval-capability-and-deadlines`): past a release's
 * deadline an owner who has not approved it cannot create apps, install
 * packages or upgrade apps, while running apps keep working. The node enforces
 * every decision and deadline either way.
 */

import { compareReleaseVersions } from '../sealed/release.js';

/** Who holds a decision on this cluster (core's `Authority`); `null` when the node did not say. */
export type ApprovalAuthority = 'owner' | 'operator' | null;

/** Core's `Governance`: which party makes each decision on this cluster. */
export interface ApprovalGovernance {
  releases: ApprovalAuthority;
  appUpgrades: ApprovalAuthority;
  outbound: ApprovalAuthority;
}

/** A mero-tee release the cluster's nodes run that this account has not approved. */
export interface PendingRelease {
  version: string;
  /** How many of the cluster's nodes run it, when the node said. */
  nodes: number | null;
  /** `operator` where the cluster gives release approvals to its operator: nothing for the user to do. */
  managedBy: 'owner' | 'operator';
  /** Whether this account can approve it (`approveRelease(version, passkey)`). */
  actionable: boolean;
  /** The release's notes on GitHub. */
  releaseNotesUrl: string;
  /** The public verifier for the release's signed measurements. */
  verifyUrl: string;
  /**
   * Approve by then (ISO 8601), when the release carries a deadline: past it,
   * an owner who has not approved it cannot create apps, install packages or
   * upgrade apps (running apps keep working). Provisional.
   */
  deadline: string | null;
  /** The deadline has passed. */
  overdue: boolean;
}

/** An app this account owns that has a newer release of its package. */
export interface PendingUpgrade {
  appId: string;
  name: string | null;
  package: string;
  /** The version the app runs now. */
  from: string | null;
  /** The newest version available (`upgradeApp(appId, to, passkey)`). */
  to: string;
  /** Every newer version, newest first. */
  available: string[];
  managedBy: 'owner' | 'operator';
  actionable: boolean;
  /** Upgrade by then (ISO 8601), when the node names a deadline. Provisional. */
  deadline: string | null;
  overdue: boolean;
}

/** What {@link CalimeroClient.pendingApprovals} answers. */
export interface PendingApprovals {
  accountId: string | null;
  /** Releases approved for this account's own apps, newest first. */
  approvedReleases: string[];
  /** Releases waiting for this account's decision (or the operator's, see `managedBy`). */
  releases: PendingRelease[];
  upgrades: PendingUpgrade[];
  /** `null` when the node does not report governance yet (provisional). */
  governance: ApprovalGovernance | null;
  /** Whether anything here needs the user's passkey: show the prompt when true. */
  actionable: boolean;
  /**
   * A release the account has not approved is past its deadline: until it
   * approves, the node refuses to create its apps, install packages or upgrade
   * apps. Running apps keep working.
   */
  restricted: boolean;
}

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

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The first of `names` (dotted paths) that `o` holds. */
function pick(o: unknown, ...names: string[]): unknown {
  for (const name of names) {
    let v: unknown = o;
    for (const k of name.split('.')) v = isRecord(v) ? v[k] : undefined;
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** `2.3.10` → `2.3.10`, `mero-tee-v2.3.10` and `v2.3.10` too. */
const bare = (v: string): string => v.trim().replace(/^mero-tee-v/, '').replace(/^v/, '');

/** Semver order; versions that are not semver after those that are, then by text. */
export function compareVersions(a: string, b: string): number {
  try {
    return compareReleaseVersions(bare(a), bare(b));
  } catch {
    return a < b ? -1 : a > b ? 1 : 0;
  }
}

const newestFirst = (list: string[]): string[] => [...new Set(list)].sort((a, b) => compareVersions(b, a));

/** A version from a string or `{ version | release }`. */
function versionOf(v: unknown): string | null {
  const s = str(v) ?? str(pick(v, 'version', 'release', 'releaseVersion', 'release_version'));
  return s === null ? null : bare(s);
}

function versionsOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(versionOf).filter((x): x is string => x !== null);
  if (isRecord(v)) return Object.keys(v).map(bare);
  const one = versionOf(v);
  return one === null ? [] : [one];
}

function authority(v: unknown): ApprovalAuthority {
  const s = String((isRecord(v) ? pick(v, 'kind', 'holder', 'authority') : v) ?? '').toLowerCase();
  return s === 'owner' || s === 'operator' ? s : null;
}

/** Core's governance, from `{ releases, appUpgrades, outbound }` under any of the names it may use. */
export function governanceFrom(raw: unknown): ApprovalGovernance | null {
  if (!isRecord(raw)) return null;
  const g: ApprovalGovernance = {
    releases: authority(pick(raw, 'releases', 'releaseApprovals', 'release_approvals')),
    appUpgrades: authority(pick(raw, 'appUpgrades', 'app_upgrades', 'upgrades')),
    outbound: authority(pick(raw, 'outbound', 'outboundApprovals', 'outbound_approvals')),
  };
  return g.releases || g.appUpgrades || g.outbound ? g : null;
}

/** An instant as ISO 8601: an ISO string, or a number of seconds, milliseconds or nanoseconds since the epoch. */
export function instantFrom(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v))) {
    let n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (n > 1e17) n /= 1e6;
    else if (n < 1e11) n *= 1e3;
    return new Date(n).toISOString();
  }
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

const DEADLINE = ['deadline', 'approveBy', 'approve_by', 'deadlineAt', 'deadline_at', 'upgradeDeadline', 'upgrade_deadline'];

/**
 * `version → deadline` from release entries carrying one (`{ version, deadline }`)
 * and from a `{ version: deadline | { deadline } }` map.
 */
function deadlinesFrom(lists: unknown[], map: unknown): Map<string, string> {
  const out = new Map<string, string>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const x of list) {
      const version = versionOf(x);
      const at = isRecord(x) ? instantFrom(pick(x, ...DEADLINE)) : null;
      if (version !== null && at !== null) out.set(version, at);
    }
  }
  if (isRecord(map)) {
    for (const [version, v] of Object.entries(map)) {
      const at = instantFrom(isRecord(v) ? pick(v, ...DEADLINE) : v);
      if (at !== null) out.set(bare(version), at);
    }
  }
  return out;
}

/** `version → nodes` from a list of versions, of `{ version, nodes }`, or a `{ version: count | nodes[] }` map. */
function nodeReleasesFrom(raw: unknown): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const add = (version: string | null, nodes: number | null) => {
    if (version === null) return;
    const prev = out.get(version);
    out.set(version, nodes === null ? prev ?? null : (prev ?? 0) + nodes);
  };
  const count = (n: unknown): number | null =>
    Array.isArray(n) ? n.length : typeof n === 'number' && Number.isFinite(n) ? n : null;
  if (Array.isArray(raw)) {
    for (const x of raw) add(versionOf(x), isRecord(x) ? count(pick(x, 'nodes', 'count')) : null);
  } else if (isRecord(raw)) {
    for (const [version, n] of Object.entries(raw)) add(bare(version), count(n));
  }
  return out;
}

/** What `GET /auth/me` says about releases and governance (today's fields, and the provisional ones). */
export interface AccountReleases {
  accountId: string | null;
  approved: string[];
  /** Releases the cluster's nodes run (approved or not), with node counts. */
  onNodes: Map<string, number | null>;
  /** Releases the node itself names as awaiting approval. */
  unapproved: string[];
  /** Release deadlines, ISO 8601 (provisional). */
  deadlines: Map<string, string>;
  governance: ApprovalGovernance | null;
}

export function accountReleasesFrom(me: unknown): AccountReleases {
  const onNodes = pick(me, 'nodeReleases', 'node_releases', 'clusterReleases', 'cluster_releases', 'releases.nodes', 'cluster.releases');
  const unapproved = pick(
    me,
    'unapprovedReleases',
    'unapproved_releases',
    'pendingReleases',
    'pending_releases',
    'releases.unapproved',
    'releases.pending',
  );
  return {
    accountId: str(pick(me, 'accountId', 'account_id', 'id')),
    approved: newestFirst(versionsOf(pick(me, 'approvedReleases', 'approved_releases', 'releases.approved'))),
    onNodes: nodeReleasesFrom(onNodes),
    unapproved: versionsOf(unapproved),
    deadlines: deadlinesFrom(
      [onNodes, unapproved],
      pick(me, 'releaseDeadlines', 'release_deadlines', 'deadlines', 'releases.deadlines'),
    ),
    governance: governanceFrom(pick(me, 'governance', 'cluster.governance', 'governanceHolders', 'governance_holders')),
  };
}

/** An app as `GET /apps` answers it, with the newer versions the node may report on it. */
interface AppRow {
  appId: string;
  name: string | null;
  owner: string | null;
  org: string | null;
  package: string | null;
  version: string | null;
  /** `null`: the node did not say (look the package up). */
  available: string[] | null;
  deadline: string | null;
}

function appRowFrom(raw: unknown): AppRow | null {
  const appId = str(pick(raw, 'appId', 'app_id', 'id'));
  if (appId === null) return null;
  const listed = pick(raw, 'availableVersions', 'available_versions', 'available', 'versions');
  const latest = versionOf(pick(raw, 'latestVersion', 'latest_version', 'latest'));
  const available = listed !== undefined ? versionsOf(listed) : latest !== null ? [latest] : null;
  return {
    appId,
    name: str(pick(raw, 'name')),
    owner: str(pick(raw, 'owner')),
    org: str(pick(raw, 'org', 'orgId', 'org_id')),
    package: str(pick(raw, 'package', 'pkg')),
    version: versionOf(pick(raw, 'version', 'currentVersion', 'current_version', 'packageVersion')),
    available,
    deadline: instantFrom(pick(raw, ...DEADLINE)),
  };
}

/** The apps of `apps` that are this account's own (owned by it, outside any organization). */
function ownApps(apps: unknown[], accountId: string | null): AppRow[] {
  return apps
    .map(appRowFrom)
    .filter((a): a is AppRow => a !== null && a.org === null && accountId !== null && a.owner === accountId);
}

/**
 * The packages whose versions {@link pendingApprovalsFrom} needs looked up:
 * those of the account's own apps the node listed without available versions.
 */
export function packagesToLookUp(me: unknown, apps: unknown[]): string[] {
  const own = ownApps(apps, accountReleasesFrom(me).accountId);
  return [...new Set(own.filter((a) => a.available === null && a.version !== null).map((a) => a.package))].filter(
    (p): p is string => p !== null,
  );
}

/** A package's versions from `GET /packages/{p}` (`latest`, `versions[].version`). */
export function packageVersionsFrom(raw: unknown): string[] {
  return newestFirst([
    ...versionsOf(pick(raw, 'versions')),
    ...versionsOf(pick(raw, 'latest')),
  ]);
}

/**
 * Put the pending list together from what the node answered: `me` is
 * `GET /auth/me`, `apps` `GET /apps`, `packageVersions` each package's versions
 * (for apps the node gave no available versions for).
 */
export function pendingApprovalsFrom(
  me: unknown,
  apps: unknown[],
  packageVersions: Record<string, string[]> = {},
  now: number = Date.now(),
): PendingApprovals {
  const account = accountReleasesFrom(me);
  const overdue = (at: string | null) => at !== null && Date.parse(at) <= now;
  const releasesBy: 'owner' | 'operator' = account.governance?.releases === 'operator' ? 'operator' : 'owner';
  const upgradesBy: 'owner' | 'operator' = account.governance?.appUpgrades === 'operator' ? 'operator' : 'owner';

  const waiting = new Set([...account.unapproved, ...account.onNodes.keys()]);
  for (const v of account.approved) waiting.delete(v);
  const releases: PendingRelease[] = newestFirst([...waiting]).map((version) => ({
    version,
    nodes: account.onNodes.get(version) ?? null,
    managedBy: releasesBy,
    actionable: releasesBy === 'owner',
    releaseNotesUrl: releaseNotesUrl(version),
    verifyUrl: verifyReleaseUrl(version),
    deadline: account.deadlines.get(version) ?? null,
    overdue: overdue(account.deadlines.get(version) ?? null),
  }));

  const upgrades: PendingUpgrade[] = [];
  for (const app of ownApps(apps, account.accountId)) {
    if (app.package === null || app.version === null) continue;
    const current = app.version;
    const known = app.available ?? packageVersions[app.package] ?? [];
    const newer = newestFirst(known.filter((v) => compareVersions(v, current) > 0));
    if (newer.length === 0) continue;
    upgrades.push({
      appId: app.appId,
      name: app.name,
      package: app.package,
      from: app.version,
      to: newer[0],
      available: newer,
      managedBy: upgradesBy,
      actionable: upgradesBy === 'owner',
      deadline: app.deadline,
      overdue: overdue(app.deadline),
    });
  }

  return {
    accountId: account.accountId,
    approvedReleases: account.approved,
    releases,
    upgrades,
    governance: account.governance,
    actionable: releases.some((r) => r.actionable) || upgrades.some((u) => u.actionable),
    restricted: releases.some((r) => r.actionable && r.overdue),
  };
}
