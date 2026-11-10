/**
 * Client for Calimero 1.0, the confidential cloud: one app = one replicated log on
 * attested nodes; this client verifies the node, seals every request to it,
 * signs people in with passkeys and machines with API keys.
 *
 * ```ts
 * const cloud = new CalimeroClient({ baseUrl, policy: { release: { minReleaseVersion: '2.3.109' } } });
 * await cloud.signIn(browserPasskey());
 * const { result } = await cloud.call(appId, 'set', { key: 'a', value: '1' });
 * ```
 */

import { SealedTransportError, createSealedFetch } from '../sealed/sealed.js';
import { fetchAttestedKey, type AttestationDoc, type CloudPolicy } from './attestation.js';
import { DEFAULT_DIRECTORY, orderNodes, readDirectory } from './directory.js';
import {
  CalimeroError,
  ConfirmCancelled,
  ConfirmPromptBlocked,
  ConfirmRequired,
  LoginRequired,
  OriginNotRegistered,
  UnavailableError,
  WrongNode,
  WrongRecoveryCode,
  errorFrom,
} from './errors.js';
import { b64url, fromB64url, type PasskeyProvider, type PasskeyUserVerification } from './passkey.js';
import { signRecovery } from './recovery.js';
import {
  confirmationCode,
  pageQuery,
  pendingApprovalsFrom,
  type AppsReport,
  type ConsentRequest,
  type ConsentResult,
  type ConsentStarted,
  type OpenConsentOptions,
  type OpsAppsReport,
  type OpsOrgsReport,
  type PageOptions,
  type PendingApprovals,
  type PublisherBindingInfo,
  type PublisherProof,
  type ReleaseRules,
  type ReportedApp,
} from './approvals.js';

export {
  AppError,
  ArgsTooLarge,
  BadOrigin,
  CalimeroError,
  ConfirmCancelled,
  ConfirmPromptBlocked,
  ConfirmRequired,
  IdempotencyMismatch,
  LoginRequired,
  ConsentStale,
  NotFound,
  OriginNotRegistered,
  OriginTaken,
  PasskeyUnknownHere,
  QuotaExceeded,
  RecoveryNotReady,
  ReleaseDeadlineError,
  SignUpRefused,
  TrapError,
  UnavailableError,
  WrongNode,
  WrongRecoveryCode,
  errorFrom,
} from './errors.js';
export type { Committed, SignUpRefusal } from './errors.js';

export interface CalimeroSession {
  accountId: string;
  sessionToken: string;
  expiresAt: number;
  refreshToken: string;
}

export interface CallResult {
  index: number;
  result: unknown;
  events: Array<{ kind: string; data: unknown }>;
}

export interface ViewResult {
  index: number;
  result: unknown;
}

export interface CloudEvent {
  id: string;
  kind: string;
  data: unknown;
}

/** What installing a package release answers. */
export interface PackageInstalled {
  package: string;
  version: string;
  signerId: string;
  /** Service name (`''` for a single-service bundle) -> the bundle hash it runs as. */
  services: Record<string, string>;
}

/** An installed package and its releases. */
export interface PackageInfo {
  package: string;
  signerId: string;
  owner: string;
  latest: string | null;
  versions: Array<{
    version: string;
    mpk: string;
    size: number;
    source: 'registry' | 'upload';
    services: Record<string, string>;
    metadata: unknown;
    outbound: string[];
    installedBy: string;
    installedAt: number;
  }>;
}

/** One app instance as `listApps` answers it. */
/** What {@link CalimeroClient.moveApp} answers. */
export interface MoveAppResult {
  appId: string;
  /** The organization it left; `null` for a personal app. */
  from: string | null;
  /** The organization it is in now. */
  org: string;
  /** Its access there: `{ kind: 'team', team }` on the target's app team, or as it was. */
  access: Record<string, unknown>;
  /** Whether the target's app team of its package was made for it. */
  created: boolean;
  /** The accounts that joined the target with it (`bringMembers`). */
  added: string[];
  /** The source's invites into the team it left that were revoked. */
  revokedInvites: number;
}

export interface AppInfo {
  appId: string;
  name: string;
  owner: string;
  org: string | null;
  bundle: string;
  package: string | null;
  version: string | null;
  /** The deployment it was created from, if any. */
  deployment?: string | null;
}

/**
 * An organization-wide upgrade run, as `upgradeOrg`, `upgradeRun` and
 * `retryUpgradeRun` answer it (core's `UpgradeRun`).
 */
export interface UpgradeRun {
  runId: string;
  package: string;
  version: string;
  team?: string;
  cascade: boolean;
  /** The account that started it, or `operator`. */
  by: string;
  startedAt: number;
  apps: string[];
  done: string[];
  /** App id -> why its upgrade failed. */
  failed: Record<string, unknown>;
  finished: boolean;
}

/** One of an app's blobs: `blobId` base58 (what apps print), `id` hex. */
export interface BlobInfo {
  blobId: string;
  id: string;
  size: number;
}

/** One device present in an app (`publishPresence`); `state` hex, `null` once retracted. */
export interface PresenceEntry {
  account: string;
  device: string;
  state: string | null;
}

/** What an organization-wide upgrade targets. */
export interface OrgUpgradeTarget {
  package: string;
  version: string;
  /** Only this team's apps (and, with `cascade`, those of the teams below it). */
  team?: string;
  cascade?: boolean;
  migrate?: string;
}

/**
 * `GET /orgs/{org}`: the organization as the caller sees it. Besides its
 * members, teams and metadata, who may approve its releases, the package
 * signing keys it publishes, and whether a passed release deadline has
 * stopped new work on its own set.
 */
export interface OrgInfo extends Record<string, unknown> {
  /** Accounts holding `APPROVE_RELEASES` there (owner and admins included). */
  releaseApprovers: string[];
  /** The signer ids (`did:key`) bound to it as publisher. */
  publishes: string[];
  /** `null` unless a deadline stopped new work: approve `release` (or newer) to lift it. */
  newWorkStopped: { release: string; after: string } | null;
  /** The recovery key and any recovery under way; absent while the organization has none. */
  recovery?: OrgRecovery;
  /** How it holds its apps ({@link OrgMode}); absent from nodes before app teams. */
  mode?: OrgMode;
}

/**
 * How an organization holds its apps, derived from its app teams (core
 * `OrgMode`): `legacy` has none (its apps use organization access),
 * `standalone` has only open ones (everyone has every app), `shared` has a
 * closed one (each app lists who is in it).
 */
export type OrgMode = 'legacy' | 'standalone' | 'shared';

/** One app team, as `GET /orgs/{org}/app-teams` lists it ({@link CalimeroClient.listAppTeams}). */
export interface AppTeam {
  /** The package this team is the app team of (one per package per organization). */
  package: string;
  teamId: string;
  name: string;
  /** `everyone` (open) or `invite` (closed). */
  join: 'everyone' | 'invite';
  /** How many of the organization's people are in the team. */
  memberCount: number;
  /** Capability bits everyone in the team holds there ({@link ORG_CAPABILITIES}); `null` when unset. */
  defaultCapabilities: number | null;
  /** Whether the caller is in the team. */
  member: boolean;
  /** Whether the caller manages it (its lead, an ancestor's lead, or an admin). */
  manages: boolean;
}

/** `GET /orgs/{org}/app-teams`: the organization's mode and its app teams. A guest sees only the app teams they are in. */
export interface AppTeams {
  mode: OrgMode;
  appTeams: AppTeam[];
}

/** One package to give an app team ({@link CalimeroClient.scopeApps}, core `ScopeApp`). */
export interface ScopeApp {
  package: string;
  /** The team's name when one is made, 1..64 characters (absent: the package's display name, else the package id). */
  name?: string;
  /**
   * The instances to move onto the team (absent: every organization-access
   * instance of the package here; `[]`: none, for a fresh install).
   */
  instances?: string[];
  /**
   * Open (`everyone`) or close (`invite`) this package's app team in this
   * step, and no other (absent: as `shared` says). Naming it on any package
   * leaves an absent `shared` meaning "no other team"; `shared: true` with an
   * `everyone` is refused.
   */
  join?: 'everyone' | 'invite';
  /**
   * Closing (`join: 'invite'`) only: who keeps the app besides the team's
   * leads, members of the organization (at most 1024). Absent: everyone who
   * reaches it now keeps it. Everyone else loses it, with their rows in the
   * teams below it (its private channels); opening the team again lets them back.
   */
  keep?: string[];
}

/** What {@link CalimeroClient.scopeApps} asks for; every field absent takes the node's default. */
export interface ScopeAppsOptions {
  /** At most 64 packages (absent: every package with an organization-access instance here). */
  apps?: ScopeApp[];
  /** Close every app team (absent: when the organization then holds two or more). */
  shared?: boolean;
}

/** One package's app team after {@link CalimeroClient.scopeApps}. */
export interface ScopedAppTeam {
  package: string;
  teamId: string;
  /** Whether the team was made now (`false`: it existed already). */
  created: boolean;
  /** The instances moved onto it. */
  apps: string[];
  /** How many rows were added for people who reached those instances (or kept on a close). */
  added: number;
  /** The team's `join` after the step (absent from nodes before per-app close). */
  join?: 'everyone' | 'invite';
  /** How many people lost the app in this step (a close with `keep`; absent from nodes before per-app close). */
  dropped?: number;
}

/** `POST /orgs/{org}/app-teams`: the organization's mode after, and each package's team. */
export interface ScopeAppsResult {
  mode: OrgMode;
  teams: ScopedAppTeam[];
}

/** A pending organization invite, as `GET /orgs/{org}/invites` lists it (never its token). */
export interface OrgInvite {
  /** The invite's key, which {@link CalimeroClient.revokeInvite} takes. */
  inviteKey: string;
  role: 'guest' | 'member' | 'admin';
  /** The teams it adds its holder to. */
  teams: string[];
  usesLeft: number;
  /** Unix seconds. */
  expiresAt: number;
  /** Listed until revoked, even past `expiresAt`. */
  expired: boolean;
  /** The account that made it; `null` for invites made before core recorded it. */
  createdBy: string | null;
  /** Unix seconds; `null` for invites made before core recorded it. */
  createdAt: number | null;
}

/** One direct row of a team ({@link TeamInfo}). */
export interface TeamMemberInfo {
  account: string;
  role: 'lead' | 'member' | 'readOnly';
  /** Their effective bits there: their row's own, else the organization's with the team's default on top. */
  capabilities: number;
}

/** `GET /orgs/{org}/teams/{team}` ({@link CalimeroClient.getTeam}). */
export interface TeamInfo extends Record<string, unknown> {
  teamId: string;
  name: string;
  parent: string | null;
  join: 'everyone' | 'invite';
  metadata: unknown;
  /** The package it is the app team of (`metadata.app.package` on a top-level team), else `null`. */
  package?: string | null;
  /** Capability bits everyone in the team holds there on top of their own; `null` when unset. */
  defaultCapabilities?: number | null;
  members: TeamMemberInfo[];
  /** The child teams the caller sees. */
  children: string[];
  apps: Array<{ appId: string; name: string; contextId: string }>;
  /** The caller's direct row's role, if any. */
  myRole: 'lead' | 'member' | 'readOnly' | null;
  /** Whether the caller is in the team. */
  member: boolean;
}

/** An organization's recovery key (core `Org::recovery`). */
export interface OrgRecovery {
  /** The key's Ed25519 public half, base64url. */
  publicKey: string;
  /** When the owner set it (Unix seconds). */
  setAt: number;
  /** A recovery under way: warn every member, the owner first, who may cancel it. */
  pending: RecoveryTimes & { account: string } | null;
}

/** When a recovery started and the earliest it may finish (Unix seconds). */
export interface RecoveryTimes {
  startedAt: number;
  readyAt: number;
}

/** A blob's bytes with the content type the node serves them as. */
export interface BlobContent {
  data: Uint8Array;
  /** What the uploader gave (component apps); `application/octet-stream` otherwise. */
  contentType: string;
}

/** One xcall that was never delivered (core's `DeadLetter`). */
export interface DeadLetter {
  seq: number;
  /** The target app. */
  app: string;
  method: string;
  reason: string;
  /** The log entry's timestamp it was dead-lettered at (ms since the epoch). */
  atMs: number;
}

/** `GET /apps/{app}/xcalls`: a component app's outbox and its dead letters, newest last. */
export interface AppXcalls {
  /** Messages waiting in the outbox. */
  pending: number;
  deadLetters: DeadLetter[];
}

/**
 * An account or an organization, as a deployer, a deployment's owner or the
 * cluster's owner: `{ account: id }` or `{ org: id }`.
 */
export type Deployer = { account: string } | { org: string };

/** A deployer's key, as `GET /deployers` lists it and `DELETE /deployers/{key}` takes it. */
export function deployerKey(deployer: Deployer): string {
  return 'account' in deployer ? `account:${deployer.account}` : `org:${deployer.org}`;
}

/** One deployer grant, as `GET /deployers` lists it. */
export interface DeployerGrant {
  /** `account:{id}` or `org:{id}`. */
  key: string;
  deployer: Deployer | null;
  /** RFC 3339; `null`: it does not end. */
  until: string | null;
  untilSecs: number | null;
  grantedAt: string;
  grantedBy: string;
}

/** `GET /deployers`: who may install apps on the cluster, and who grants it. */
export interface DeployersInfo {
  /** `open` (any account) or `granted` (deployers only); absent on a default cluster. */
  deployments?: 'open' | 'granted';
  /** Who grants deployers: `operator` (its key) or `owner` (the cluster's owner, with a passkey). */
  deployers?: 'operator' | 'owner';
  owner: Deployer | null;
  grants: DeployerGrant[];
}

/** One app a deployment offers, as its managers read it. */
export interface DeploymentOffer {
  /** The app's name in the deployment. */
  app: string;
  package: string;
  version: string;
  addedBy: string;
  /** RFC 3339. */
  addedAt: string;
}

/** A deployment as its managers read it (`GET /deployments`). */
export interface DeploymentInfo {
  id: string;
  name: string;
  owner: Deployer;
  apps: DeploymentOffer[];
  createdBy: string;
  /** RFC 3339. */
  createdAt: string;
}

/**
 * `GET /deployments/{id}`, public: what a frontend and the customer's consent
 * show. Never its managers, members or customers.
 */
export interface PublicDeployment {
  id: string;
  name: string;
  /** The owner's kind and name (`null` if it is gone). */
  owner: { kind: 'account' | 'org'; name: string | null };
  apps: Array<{ app: string; package: string; version: string }>;
}

/** `GET /deployments/{id}/orgs`: the organizations with instances created from a deployment. */
export interface DeploymentOrgs {
  deployment: string;
  orgs: Array<{
    orgId: string;
    name: string | null;
    instances: number;
    /** Which of the deployment's apps they run, at which release. */
    apps: Array<{ app: string; version: string }>;
    /** RFC 3339: when its first instance from the deployment was created. */
    firstCreatedAt: string;
    /** How many members it has (counts only, never who; core #4902). Absent from an older node. */
    memberCount?: number;
    /** How many of them signed in or used a session in the last 30 days (core #4902). Absent from an older node. */
    activeMembers30d?: number;
  }>;
  /** Instances outside any organization, counted only. */
  outsideOrgs: number;
}

/**
 * A package frontend's `/.well-known/calimero.json`: the package, its
 * releases, the deployments offering it and the cluster's API URLs.
 */
export interface FrontendManifest {
  package: string;
  versions: string[];
  deployments: Array<{ id: string; name: string; app: string; version: string }>;
  api: string[];
}

/**
 * One member's lockout risk, as {@link CalimeroClient.orgMembersSecurity}
 * lists it for an organization's owner and admins (core #4902). Never a
 * credential id, a passkey's label or times, a session or an activity entry.
 */
export interface OrgMemberSecurity {
  account: string;
  /** The member's self-set name (`memberMetadata.name`); `null` when unset. */
  name: string | null;
  role: 'guest' | 'member' | 'admin' | 'owner';
  /** The teams they are in. */
  teams: string[];
  /** How many passkeys they hold, capped: whether they have a backup, not how many devices. */
  passkeys: 0 | 1 | 2 | '3+';
  /** Whether a recovery code is set. */
  recoveryCode: boolean;
  /** The UTC day (`YYYY-MM-DD`) of their latest sign-in or session exchange; `null` when unknown. */
  lastActiveDay: string | null;
  /** How many live sessions they hold. */
  sessions: number;
}

/**
 * Read the `/.well-known/calimero.json` of the frontend at `origin` (by
 * default the page's own). Served in the clear by the frontend host, like the
 * page itself: for choosing a deployment and the API URL to connect to, never
 * for trust (the client attests the node it then talks to).
 */
export async function frontendManifest(origin?: string, fetcher: typeof fetch = fetch): Promise<FrontendManifest> {
  const base = origin ?? (globalThis as { location?: { origin?: string } }).location?.origin;
  if (!base) throw new Error('no page origin to read the frontend manifest from; pass `origin`');
  const response = await fetcher(new URL('/.well-known/calimero.json', base).toString());
  if (!response.ok) throw await refusal(response);
  const manifest = (await response.json()) as FrontendManifest;
  return { ...manifest, deployments: manifest.deployments ?? [] };
}

/**
 * The deployment a frontend page was opened for: the node serves
 * `/d/{deployment}/` by redirecting to `/{version}/…?deployment={id}`, so the
 * page creates its instances from that deployment
 * (`createApp(name, { deployment, package })`). `null` when the page was
 * not opened through a deployment. `href` defaults to `window.location.href`.
 */
export function pageDeployment(href?: string): string | null {
  const at = href ?? (globalThis as { location?: { href?: string } }).location?.href;
  if (!at) return null;
  try {
    return new URL(at).searchParams.get('deployment') || null;
  } catch {
    return null;
  }
}

/** One of the account's passkeys (devices), as `GET /auth/me` lists it. */
export interface MePasskey {
  /** The credential id, which {@link CalimeroClient.labelPasskey} and {@link CalimeroClient.removePasskey} take. */
  id: string;
  /** The account's name for it; `null` when unnamed. */
  label?: string | null;
  signCount: number;
  /**
   * When it was added (Unix seconds). `null` when it was added on a release
   * that kept no times (1.0.0-rc.14 and earlier); absent from such a node.
   */
  addedAt?: number | null;
  /**
   * When it last signed in (Unix seconds): a sign-up, a sign-in or an account
   * recovery's finish; a refresh does not move it. `null` when it has not
   * signed in since the node kept times; absent from a node that keeps none.
   */
  lastSignInAt?: number | null;
}

/** An organization the account is in, as `GET /auth/me` lists it. */
export interface MeOrg {
  orgId: string;
  name: string;
  role: 'guest' | 'member' | 'admin' | 'owner';
}

/** `GET /auth/me`: who the credential is. */
export interface MeInfo extends Record<string, unknown> {
  accountId?: string;
  name?: string;
  /** The account's passkeys. */
  passkeys?: MePasskey[];
  /** The organizations the account is in, with its role in each. */
  orgs?: MeOrg[];
  /** `session` or `apiKey`. */
  via?: string;
  /**
   * The passkey (credential id) this session was opened with; `null` for an
   * API key.
   */
  passkeyId?: string | null;
  /**
   * The package the session is bound to: opened on an app's frontend or on
   * an origin its manager registered ({@link CalimeroClient.packageOrigins}).
   * `null` (or absent, on an older node) for an unbound session.
   */
  app?: string | null;
  /** The web origin the session was opened on, when the node recorded one. */
  origin?: string | null;
  /** Whether the account holds a recovery code ({@link CalimeroClient.createRecoveryCode}); never the code. */
  recoveryCode?: boolean;
  /**
   * A recovery of this account under way: someone holding its recovery code
   * started it with a new passkey. Warn on every device; a passkey the
   * account has cancels it ({@link CalimeroClient.cancelAccountRecovery})
   * until `readyAt`.
   */
  recoveryPending?: AccountRecovery | null;
}

/**
 * One of the account's live sessions, as {@link CalimeroClient.listSessions}
 * lists it (core #4894).
 */
export interface AccountSession {
  /** The session's id, which {@link CalimeroClient.revokeSession} takes. */
  session: string;
  /** The passkey (credential id) it was opened with. */
  passkey: string | null;
  /** The package it is bound to; `null` on the cluster's own origin. */
  app: string | null;
  /** The registered origin it was opened on; `null` on the cluster's own origin. */
  origin: string | null;
  /** When it opened (Unix seconds); `null` when opened before the node kept it. */
  openedAt: number | null;
  /**
   * When its refresh token was last exchanged (Unix seconds). A token younger
   * than an hour refreshes without a write and a session token lives 15
   * minutes, so the session may have been used up to about 1 h 15 min later.
   */
  lastActiveAt: number;
  /** Whether it is the caller's own session. */
  current: boolean;
}

/**
 * One thing one of the account's passkeys did, as
 * {@link CalimeroClient.listActivity} lists it (core #4901). Every key is
 * present; the ones its `kind` does not have are `null`.
 */
export interface AccountActivity {
  /** When (Unix seconds). */
  at: number;
  /** The passkey (credential id) that did it; it may since have been removed. */
  passkey: string;
  /**
   * `signIn`: a sign-up, a sign-in or an account recovery's finish (a refresh
   * is none). `approval`: a change the passkey approved with a step-up.
   */
  kind: 'signIn' | 'approval';
  /** A sign-in's package, whose frontend opened the session; `null` on the cluster's own origin. */
  app: string | null;
  /** A sign-in's registered origin; `null` on the cluster's own origin. */
  origin: string | null;
  /** An approval's method, e.g. `__add_passkey`, `__create_api_key`, `__upgrade`. */
  method: string | null;
  /** What an approval's method acted on: an app id, `org:<id>`, `account:<id>`, ... */
  subject: string | null;
}

/** A recovery of an account under way (core #4844, `docs/specs/account-recovery.md`). */
export interface AccountRecovery {
  accountId: string;
  /** The new passkey the recovery adds when it finishes. */
  credentialId: string;
  /** When it started (Unix seconds). */
  startedAt: number;
  /** The earliest it may finish (Unix seconds): 72 hours after the start. */
  readyAt: number;
}

/** One web origin registered for a package (`GET /package-origins/{package}`). */
export interface PackageOrigin {
  /** `scheme://host[:port]`. */
  origin: string;
  /** The WebAuthn relying-party id passkeys made there are bound to. */
  rpId: string;
  /** The account that registered it. */
  addedBy: string;
  addedAt: string | number;
  /**
   * The cluster serves the package's frontend on this origin too (a custom
   * domain, from its signed bundle). Absent (`false`) from a node that
   * predates served origins.
   */
  served?: boolean;
}

/** What registering an origin answers. */
export interface PackageOriginAdded extends PackageOrigin {
  package: string;
}

/** What removing an origin answers. */
export interface PackageOriginRemoved {
  package: string;
  origin: string;
  removed: true;
}

/**
 * The web origins a package's frontend may sign users in from besides the
 * cluster's own, so a developer can host it themselves. A session opened on
 * one is bound to the package. For the package's managers.
 */
export interface PackageOrigins {
  /** The origins registered for `pkg`. `NotFound` for an unknown package; `403` to anyone not managing it. */
  list(pkg: string): Promise<PackageOrigin[]>;
  /**
   * Register `origin` for `pkg`, approved with `passkey` (`412
   * CONFIRM_REQUIRED` over `__add_origin`; without a passkey it reaches the
   * caller as {@link ConfirmRequired}). `rpId` defaults to the node's choice
   * for the origin (its host). Refusals: {@link BadOrigin} (`BAD_ORIGIN`,
   * `BAD_RP_ID`), {@link OriginTaken}, {@link QuotaExceeded}.
   *
   * `served: true` makes it a custom domain: the cluster also serves the
   * package's frontend on it (`https://host`, no port; never a name under the
   * apps domain or the cluster's rp-id), and the consent the passkey signs
   * names it (`{ origin, rpId, served: true }`). Further refusals:
   * {@link NotServing} (the cluster serves no frontends),
   * {@link ClusterNotUpgraded} (a node of the cluster is on an older release),
   * {@link QuotaExceeded} for the served limits (4 per package, 64 per
   * cluster), {@link OriginTaken} when the origin is held with the other
   * `served` (remove it first). Serving it to browsers also needs the
   * certificate and route Calimero Cloud sets up for the domain.
   */
  add(
    pkg: string,
    origin: string,
    passkey?: PasskeyProvider,
    options?: { rpId?: string; served?: boolean },
  ): Promise<PackageOriginAdded>;
  /**
   * Remove `origin` from `pkg`, approved with `passkey` (`__remove_origin`).
   * Sessions opened there stop working (`401`). `NotFound` if it was not registered.
   */
  remove(pkg: string, origin: string, passkey?: PasskeyProvider): Promise<PackageOriginRemoved>;
}

/** One served origin (custom domain) of the cluster, as `GET /ops/served-origins` lists it. */
export interface ServedOrigin {
  /** `https://host`. */
  origin: string;
  /** The origin's host, the name a certificate and a route are for. */
  host: string;
  /** The package's app-host label (`{label}.{apps domain}`); the listing names no package. */
  label: string;
  addedAt: string;
}

/** `GET /ops/served-origins`: every served origin the cluster's log holds. Operator token. */
export interface ServedOrigins {
  /** This node had caught up with the system leader. */
  fresh: boolean;
  origins: ServedOrigin[];
}

/**
 * Where a sign-up or sign-in says it runs. By default the page's origin
 * (`window.location.origin`) when it is not the origin of a node the client
 * talks to; nothing outside a browser. A string sends that origin; `null`
 * sends none (the cluster's own origins).
 */
export interface SignInOptions {
  origin?: string | null;
  /**
   * Closes an open passkey prompt when it aborts (a Cancel button): the
   * ceremony then rejects as a dismissed prompt does (`NotAllowedError`; in a
   * sign-up's confirmation, {@link ConfirmCancelled}). Given to the
   * {@link PasskeyProvider} as `signal`.
   */
  signal?: AbortSignal;
}

/**
 * {@link SignInOptions} for a sign-up, and the invite it is made with: an
 * organization invite's token (the new account joins the organization at
 * the invite's role) or a cluster sign-up invite's. A cluster whose policy
 * is `invite` or `closed` ({@link CalimeroClient.signUpPolicy}) needs one.
 */
export interface SignUpOptions extends SignInOptions {
  invite?: string;
}

/**
 * `GET /sign-up`: who may create an account on the cluster (core's sign-up
 * policy, read without a session), so a page can say "invite only" before
 * any passkey prompt.
 */
export interface SignUpPolicy {
  /** `open` (anyone), `invite` (an organization or sign-up invite), `closed` (a sign-up invite only). */
  policy: 'open' | 'invite' | 'closed';
  /** Whether an organization invite lets a new person sign up (and join it). */
  orgInvites: boolean;
  /** Whether a cluster sign-up invite does (always). */
  signUpInvites: boolean;
  /** Whether a sign-up without an invite is refused. */
  inviteRequired: boolean;
}

/**
 * The user verification a confirmation asks the passkey for: what the node's
 * `412` details name, if it names one WebAuthn knows, else `fallback` (the
 * flow's own requirement: `required` for a step-up, which the node takes only
 * with the user verified; `preferred` for the sign-up confirmation, which it
 * takes with the user present).
 */
function userVerificationOf(named: unknown, fallback: PasskeyUserVerification): PasskeyUserVerification {
  return named === 'required' || named === 'preferred' || named === 'discouraged' ? named : fallback;
}

/**
 * What a failed confirmation prompt means to the caller. The browser or a
 * password manager refusing to show the prompt (the page not focused because
 * an extension's popup still holds focus, or another prompt still open) is
 * {@link ConfirmPromptBlocked}; the user dismissing it (`NotAllowedError`, or
 * `AbortError` when it was aborted) is {@link ConfirmCancelled}; anything
 * else is a real failure, passed through.
 */
function promptFailure(error: unknown): unknown {
  const e = error as { name?: unknown; message?: unknown } | null;
  const name = e?.name;
  const message = typeof e?.message === 'string' ? e.message : '';
  if (name === 'InvalidStateError' || /not focused|already pending/i.test(message)) {
    return new ConfirmPromptBlocked(error);
  }
  if (name === 'NotAllowedError' || name === 'AbortError') return new ConfirmCancelled(error);
  return error;
}

/** One URL path segment, so an id cannot reach another route. */
function seg(value: string): string {
  return encodeURIComponent(value);
}

/**
 * The node refuses an envelope past its 64 MiB sealed cap with `413` in the
 * clear, before opening it, so the refusal arrives as the transport's. To the
 * caller it is the API's `TOO_LARGE`, as the Rust client reports it.
 */
function sealedError(error: unknown): unknown {
  if (error instanceof SealedTransportError && error.status === 413) {
    return errorFrom(413, {
      error: 'TOO_LARGE',
      message: error.message.replace(/^Sealed request refused: /, ''),
    });
  }
  return error;
}

/** Read a refused response's body and map it ({@link errorFrom}). */
async function refusal(response: Response): Promise<CalimeroError> {
  const text = await response.text().catch(() => '');
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text };
  }
  return errorFrom(response.status, body, response.headers.get('retry-after'));
}

/** Server-sent event frames from a response body: `{ id, kind, data }` each, `data` parsed as JSON when it is. */
async function* sseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<CloudEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      let id = '';
      let kind = '';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('id:')) id = line.slice(3).trim();
        else if (line.startsWith('event:')) kind = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!kind && !data) continue;
      let parsed: unknown = data;
      try {
        parsed = JSON.parse(data);
      } catch {
        /* plain text */
      }
      yield { id, kind, data: parsed };
    }
  }
}

/** Bytes as lower-case hex. */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A key for a call the caller gave none, made once so every retry shares it:
 * `node:c-` and 16 random bytes in base64url without padding, as the Rust
 * client mints it. It only has to outlive this client's own retries, so it
 * takes the node's short-lived class: a key starting `node:` is kept 10
 * minutes, a caller's own key 24 hours.
 * `getRandomValues`, not `randomUUID`, which a page outside a secure context lacks.
 */
function newIdempotencyKey(): string {
  return `node:c-${b64url(crypto.getRandomValues(new Uint8Array(16)))}`;
}

/**
 * How a call or a view is sent again while the node is unavailable (D70): with
 * the same key, after a backoff that starts at `baseDelayMs` and doubles up to
 * `maxDelayMs`, no jitter, at most `retries` times. The defaults are the Rust
 * client's: 6 retries, 200 ms doubling, at most 2 s (about 9 s in all, past a
 * leader election).
 */
export interface CloudRetryOptions {
  /** Retries after the first attempt. Default 6. */
  retries?: number;
  /** The first backoff; each retry doubles it. Default 200 ms. */
  baseDelayMs?: number;
  /** The longest backoff. Default 2 s. */
  maxDelayMs?: number;
}

export const DEFAULT_RETRY = { retries: 6, baseDelayMs: 200, maxDelayMs: 2000 } as const;

/** The backoff before retry `retry` (0 for the first): `baseDelayMs` doubling, at most `maxDelayMs`. */
export function retryDelayMs(retry: number, options: { baseDelayMs: number; maxDelayMs: number }): number {
  return Math.min(options.baseDelayMs * 2 ** retry, options.maxDelayMs);
}

export interface CalimeroClientOptions {
  /** One node of the cluster: the one the client talks to first. */
  baseUrl: string;
  /**
   * Other nodes of the same cluster, in the order to move to them when a node
   * answers `421 WRONG_NODE` (its release may not serve this account), or stays
   * unavailable to a call or a view through all its retries. Each is attested
   * under the same `policy` before anything is sent to it. Without them a `421`
   * reaches the caller as {@link WrongNode}.
   */
  nodes?: string[];
  policy: CloudPolicy;
  /** Fetch that carries attestation and envelopes. Defaults to global `fetch`. */
  fetch?: typeof fetch;
  /** How calls and views retry a 503 or a failed connection. */
  retry?: CloudRetryOptions;
}

/** How {@link CalimeroClient.connect} reaches a Calimero Cloud cluster by name. */
export interface CalimeroConnectOptions {
  /** The cluster's name, e.g. `eu-shared-1`. */
  cluster: string;
  /** What every node must attest to before anything is sent to it. */
  policy: CloudPolicy;
  /** The node directory to ask. Default {@link DEFAULT_DIRECTORY}. */
  directory?: string;
  /** Try the nodes in this zone (e.g. `europe-west4-a`) first. */
  zone?: string;
  /** Fetch for the directory, attestation and envelopes. Defaults to global `fetch`. */
  fetch?: typeof fetch;
  /** How calls and views retry a 503 or a failed connection. */
  retry?: CloudRetryOptions;
  /** Randomness for the weighted node order, in [0, 1). Defaults to `Math.random`. */
  random?: () => number;
}

/** Where a client made by {@link CalimeroClient.connect} re-reads its node list. */
interface DirectorySource {
  directory: string;
  cluster: string;
  zone: string | undefined;
  random: () => number;
  /** When the listing is due to be read again (ms since the epoch). */
  due: number;
  /** The re-read under way, if any. */
  reading?: Promise<void>;
}

/**
 * The ceremonies that mint a session, which {@link CalimeroClient.send} never
 * repeats by itself: a sign-in or sign-up is started again by its caller (with
 * the passkey), and a refresh moves through the nodes in
 * {@link CalimeroClient.exchangeRefresh}. A node answers them `421 WRONG_NODE`
 * before it spends the challenge or the refresh token (core #4774).
 */
function ceremony(path: string): boolean {
  return path === 'auth/refresh' || path.startsWith('auth/passkey/') || RECOVERY_CEREMONIES.has(path);
}

/** The signed-out halves of an account recovery: a `401` there is the code's, not a session's. */
const RECOVERY_CEREMONIES = new Set(['auth/recovery/begin', 'auth/recovery/start', 'auth/recovery/finish']);

export class CalimeroClient {
  /** Every node this client may use, `baseUrl` first (or as the directory last ordered them). */
  private nodeUrls: string[];
  /** The one in use: an index into {@link nodeUrls}. */
  private at = 0;
  /** A sealed fetch per node, each attesting its own node on first use. */
  private readonly channels = new Map<string, typeof fetch>();
  private readonly policy: CloudPolicy;
  /** The unsealed fetch, for the one route served in the clear (`/attestation`). */
  private readonly raw: typeof fetch;
  private auth: string | undefined;
  private current: CalimeroSession | undefined;
  /** The refresh under way, which every request that needs one shares. */
  private refreshing: Promise<CalimeroSession> | undefined;
  private readonly retry: Required<CloudRetryOptions>;
  /** Rejections of the underlying `fetch` itself: the node could not be reached or dropped the connection. */
  private readonly networkFailures = new WeakSet<object>();
  /** The directory the node list came from, for a client made by {@link connect}. */
  private source: DirectorySource | undefined;

  /**
   * A client for the Calimero Cloud cluster named `cluster`: its node list read
   * from the public node directory, those in `zone` first, each group in
   * weighted-random order. The directory only picks which nodes to try: each is
   * attested under `policy` before anything is sent to it. Throws
   * {@link DirectoryError} when the directory names no usable node.
   *
   * The list is read again in the background after a failover, and at the
   * first request once the directory's `refreshAfterSeconds` has passed.
   */
  static async connect(options: CalimeroConnectOptions): Promise<CalimeroClient> {
    const directory = options.directory ?? DEFAULT_DIRECTORY;
    const random = options.random ?? Math.random;
    const fetcher = options.fetch ?? ((input, init) => fetch(input, init));
    const listing = await readDirectory(directory, options.cluster, fetcher);
    const [baseUrl, ...nodes] = orderNodes(listing.nodes, options.zone, random);
    const client = new CalimeroClient({ baseUrl, nodes, policy: options.policy, fetch: options.fetch, retry: options.retry });
    client.source = {
      directory,
      cluster: options.cluster,
      zone: options.zone,
      random,
      due: Date.now() + listing.refreshAfterSeconds * 1000,
    };
    return client;
  }

  constructor(options: CalimeroClientOptions) {
    const trim = (url: string) => url.replace(/\/+$/, '');
    this.nodeUrls = [...new Set([options.baseUrl, ...(options.nodes ?? [])].map(trim))];
    this.policy = options.policy;
    this.retry = { ...DEFAULT_RETRY, ...options.retry };
    const given = options.fetch ?? ((input, init) => fetch(input, init));
    // `fetch` rejects with a `TypeError` when it gets no answer: the connection
    // was refused, reset or dropped before the response. The sealed fetch passes
    // that rejection on unchanged, so it is recognised here, at its source, and
    // not by its type alone (a bad URL is a `TypeError` too, and is not retried).
    const raw: typeof fetch = async (input, init) => {
      try {
        return await given(input, init);
      } catch (error) {
        if (error instanceof TypeError) this.networkFailures.add(error);
        throw error;
      }
    };
    this.raw = raw;
  }

  /** The node requests go to now: `baseUrl`, until a `421 WRONG_NODE` or a failover moved the client on. */
  get nodeUrl(): string {
    return this.nodeUrls[this.at];
  }

  /** Every node this client may use, in the order it moves through them. */
  get nodes(): string[] {
    return [...this.nodeUrls];
  }

  /** The sealed channel to `url`, attested under the client's policy before its first request. */
  private channel(url: string): typeof fetch {
    let sealed = this.channels.get(url);
    if (!sealed) {
      sealed = createSealedFetch({
        baseUrl: url,
        transportPublicKey: () => fetchAttestedKey(url, this.policy, this.raw),
        fetch: this.raw,
      });
      this.channels.set(url, sealed);
    }
    return sealed;
  }

  /**
   * Move on from node `from` (the one that answered `421 WRONG_NODE`) to the
   * next one. False when there is no other. A request that saw the same node
   * refuse after another request moved on already does not move again.
   */
  private moveOn(from: string): boolean {
    if (this.nodeUrls.length < 2) return false;
    if (this.nodeUrl === from) this.at = (this.at + 1) % this.nodeUrls.length;
    return true;
  }

  /**
   * Fail over from node `from`, where a request's retries ran out, to the next
   * node it has not `tried`. False when it has tried them all. A request whose
   * node another request moved away from already goes to that node, if untried.
   */
  private failOver(from: string, tried: Set<string>): boolean {
    if (this.nodeUrl !== from && !tried.has(this.nodeUrl)) return true;
    const count = this.nodeUrls.length;
    for (let step = 1; step < count; step++) {
      const next = (this.at + step) % count;
      if (!tried.has(this.nodeUrls[next])) {
        this.at = next;
        this.reread();
        return true;
      }
    }
    return false;
  }

  /**
   * Read the node list again from the directory, in the background, for a
   * client made by {@link connect}: the node in use stays first, then the
   * directory's order; a node no longer listed is dropped. A failed read is
   * ignored. One read at a time.
   */
  private reread(): void {
    const source = this.source;
    if (!source || source.reading) return;
    source.reading = readDirectory(source.directory, source.cluster, this.raw)
      .then((listing) => {
        const current = this.nodeUrl;
        const listed = orderNodes(listing.nodes, source.zone, source.random);
        this.nodeUrls = [current, ...listed.filter((url) => url !== current)];
        this.at = 0;
        source.due = Date.now() + listing.refreshAfterSeconds * 1000;
      })
      .catch(() => undefined)
      .finally(() => {
        source.reading = undefined;
      });
  }

  /** Authenticate every request with an API key. */
  useApiKey(key: string): void {
    this.auth = key;
    this.current = undefined;
  }

  useSession(session: CalimeroSession): void {
    this.auth = session.sessionToken;
    this.current = session;
  }

  get session(): CalimeroSession | undefined {
    return this.current;
  }

  /**
   * Send one request to the node in use, with the credential held now, and
   * answer the response, whatever its status. {@link send} judges it.
   */
  private async request(
    method: string,
    path: string,
    body?: unknown,
    raw?: Uint8Array,
    contentType = 'application/wasm',
    signal?: AbortSignal,
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (this.auth) headers.authorization = `Bearer ${this.auth}`;
    let payload: BodyInit | undefined;
    if (raw) {
      headers['content-type'] = contentType;
      payload = raw as unknown as BodyInit;
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    if (this.source && Date.now() >= this.source.due) this.reread();
    const url = this.nodeUrl;
    try {
      return await this.channel(url)(`${url}/${path}`, { method, headers, body: payload, signal });
    } catch (error) {
      throw sealedError(error);
    }
  }

  /**
   * {@link request}, answering what a lost issuing node or a node on the
   * wrong release does to a session: a successful response, or the refusal as a
   * typed error ({@link errorFrom}).
   *
   * - `401 UNAUTHENTICATED` to a request that carried a session: the node that
   *   signed the session may be gone, replaced, or out of reach of the node
   *   asked, which any node of the cluster answers with a refresh. The client
   *   refreshes once, shared by every request that needs it at the same time
   *   ({@link refresh}), and repeats the request once. A refresh that is
   *   refused surfaces as {@link LoginRequired}.
   * - `421 WRONG_NODE`: this node's release may not serve the account. The
   *   client moves to the next node it knows and repeats the request once; with
   *   none, the {@link WrongNode} reaches the caller.
   *
   * Repeating is safe even for a request that is not idempotent: the node
   * answers `401` and `421` when it judges the credential, before it reads what
   * the request asks, so the first attempt ran nothing. The exceptions are the
   * ceremonies that mint a session ({@link ceremony}), never repeated here.
   */
  private async send(
    method: string,
    path: string,
    body?: unknown,
    raw?: Uint8Array,
    contentType?: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    let refreshed = false;
    let moved = false;
    for (;;) {
      const [token, at] = [this.auth, this.nodeUrl];
      const response = await this.request(method, path, body, raw, contentType, signal);
      if (response.ok) return response;
      const error = await refusal(response);
      if (error instanceof WrongNode && !moved) {
        moved = true;
        if (this.moveOn(at) && !ceremony(path)) continue;
      } else if (error instanceof LoginRequired && !refreshed && this.mayRefresh(token, path)) {
        refreshed = true;
        await this.renew(token as string);
        continue;
      }
      throw error;
    }
  }

  /** Whether a `401` to a request sent with `token` is one a refresh may answer. */
  private mayRefresh(token: string | undefined, path: string): boolean {
    return token !== undefined && this.current !== undefined && !ceremony(path);
  }

  /**
   * A fresh session in place of the one `token` belonged to: by the refresh
   * another request already made, or by one this request starts.
   */
  private async renew(token: string): Promise<void> {
    if (this.auth !== token) return;
    await this.refresh();
  }

  private async json<T>(
    method: string,
    path: string,
    body?: unknown,
    raw?: Uint8Array,
    contentType?: string,
  ): Promise<T> {
    const response = await this.send(method, path, body, raw, contentType);
    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  /**
   * {@link json} for a call or a view (D70): while the node answers 503 or
   * cannot be reached, the same request, with the same idempotency key, is sent
   * again after {@link retryDelayMs} (or the pause the node asked for, if
   * longer), at most `retries` times. Every other answer is final.
   *
   * When a node's retries run out, the request fails over to the next node the
   * client knows and its retries start again there, with the same key: the
   * key is kept in the app's replicated log, so the cluster answers it once
   * whichever node it reaches. Each node is tried once per request. The last
   * failure surfaces as {@link UnavailableError}: the node's 503, or reason
   * `network` for a connection that failed, whose `committed` is `'unknown'`.
   *
   * `once` sends the request exactly once, to the node in use (the confirmed
   * attempt of {@link callConfirmed}, whose challenge is single-use).
   */
  private async retried<T>(method: string, path: string, body: Record<string, unknown>, once = false): Promise<T> {
    const retries = once ? 0 : this.retry.retries;
    const tried = new Set<string>();
    for (;;) {
      let unavailable: UnavailableError | undefined;
      let node = this.nodeUrl;
      for (let attempt = 0; ; attempt++) {
        node = this.nodeUrl;
        tried.add(node);
        try {
          return await this.json<T>(method, path, body);
        } catch (error) {
          if (error instanceof UnavailableError) unavailable = error;
          else if (error instanceof TypeError && this.networkFailures.has(error)) {
            unavailable = new UnavailableError('NETWORK', `the node could not be reached: ${error.message}`, {}, undefined, error);
          } else throw error;
        }
        if (attempt >= retries) break;
        const backoff = retryDelayMs(attempt, this.retry);
        await new Promise((resolve) => setTimeout(resolve, Math.max(backoff, (unavailable.retryAfter ?? 0) * 1000)));
      }
      if (once || !this.failOver(node, tried)) throw unavailable;
    }
  }

  post<T = Record<string, unknown>>(path: string, body: unknown = {}): Promise<T> {
    return this.json<T>('POST', path, body);
  }

  get<T = Record<string, unknown>>(path: string): Promise<T> {
    return this.json<T>('GET', path);
  }

  put<T = Record<string, unknown>>(path: string, body: unknown = {}): Promise<T> {
    return this.json<T>('PUT', path, body);
  }

  delete<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
    return this.json<T>('DELETE', path, body);
  }

  // ---------------------------------------------------------------- identity

  /**
   * Create an account with a new passkey, and sign in. The node then asks the
   * new passkey to sign the account it creates (`412 CONFIRM_REQUIRED`), so a
   * sign-up prompts twice: create, then sign. On a page whose origin is not
   * the cluster's ({@link SignInOptions}), the node makes the passkey for that
   * origin's relying party (the confirmation's `rpId` is that origin's too)
   * and binds the session to the package the origin is registered for; an
   * unregistered origin is refused with {@link OriginNotRegistered}.
   *
   * `invite` ({@link SignUpOptions}) goes on both halves and on the retry,
   * as the node judges it on each before it spends anything; a sign-up the
   * cluster's policy refuses, or an unknown, expired or used invite, is
   * {@link SignUpRefused} (from `begin`, before any passkey is made).
   */
  async signUp(passkey: PasskeyProvider, name: string, options: SignUpOptions = {}): Promise<CalimeroSession> {
    const origin = this.pageOrigin(options);
    const invite = options.invite ? { invite: options.invite } : {};
    const begin = await this.begin<{ challengeId: string; options: Record<string, unknown> }>(
      'auth/passkey/register/begin',
      origin === undefined ? { name, ...invite } : { name, origin, ...invite },
      origin,
    );
    const signal = options.signal;
    const registration = await (signal ? passkey.create(begin.options, { signal }) : passkey.create(begin.options));
    // The node checks the sign-up's confirmation with the user present, not
    // verified (core `api.rs`: `rp(node)`, `require_uv: false`), as it made
    // the passkey with `preferred`: asking `required` here would refuse a
    // security key without a PIN after it has made the passkey, leaving a
    // passkey with no account.
    const session = await this.confirmed<CalimeroSession>(
      'POST',
      'auth/passkey/register/finish',
      { challengeId: begin.challengeId, registration, ...invite },
      passkey,
      undefined,
      'preferred',
      signal,
    );
    this.useSession(session);
    return session;
  }

  /** Who may create an account on the cluster (`GET /sign-up`); needs no session. */
  signUpPolicy(): Promise<SignUpPolicy> {
    return this.get('sign-up');
  }

  /**
   * Sign in with an existing passkey. On a page whose origin is not the
   * cluster's ({@link SignInOptions}), the assertion is made for that
   * origin's relying-party id, as the node answers it, and the session is
   * bound to the origin's package; an unregistered origin is refused with
   * {@link OriginNotRegistered}. A passkey this cluster does not know (made
   * on another cluster, or removed) is refused with {@link PasskeyUnknownHere}.
   */
  async signIn(passkey: PasskeyProvider, options: SignInOptions = {}): Promise<CalimeroSession> {
    const origin = this.pageOrigin(options);
    const begin = await this.begin<{
      challengeId: string;
      options: { challenge: string; rpId?: string; rp?: { id?: string } };
    }>('auth/passkey/login/begin', origin === undefined ? undefined : { origin }, origin);
    const rpId = begin.options.rpId ?? begin.options.rp?.id ?? '';
    const challenge = fromB64url(begin.options.challenge);
    const assertion = await (options.signal
      ? passkey.get(challenge, rpId, undefined, { signal: options.signal })
      : passkey.get(challenge, rpId));
    const session = await this.post<CalimeroSession>('auth/passkey/login/finish', {
      challengeId: begin.challengeId,
      assertion,
    });
    this.useSession(session);
    return session;
  }

  /**
   * The origin a sign-up or sign-in sends: the one given, or the page's own
   * when it is not a node's origin; `undefined` for none.
   */
  private pageOrigin(options: SignInOptions): string | undefined {
    if (options.origin !== undefined) return options.origin ?? undefined;
    const page = (globalThis as { location?: { origin?: string } }).location?.origin;
    if (!page || page === 'null') return undefined;
    const nodes = new Set(
      this.nodeUrls.map((url) => {
        try {
          return new URL(url).origin;
        } catch {
          return url;
        }
      }),
    );
    return nodes.has(page) ? undefined : page;
  }

  /** POST a ceremony's `begin`, naming the page's `origin` in an {@link OriginNotRegistered} the node leaves it out of. */
  private async begin<T>(path: string, body: Record<string, unknown> | undefined, origin: string | undefined): Promise<T> {
    try {
      return await this.post<T>(path, body);
    } catch (error) {
      if (error instanceof OriginNotRegistered && !error.origin && origin !== undefined) {
        throw new OriginNotRegistered(error.nodeMessage, { ...error.details, origin });
      }
      throw error;
    }
  }

  /**
   * Swap the refresh token for a new session, on whichever node the client
   * uses: any node of the cluster takes it. A refresh token is used once, so
   * calls made while one refresh is under way share it rather than sending the
   * same token again (which would revoke the session).
   */
  refresh(): Promise<CalimeroSession> {
    if (!this.refreshing) {
      const pending = this.exchangeRefresh();
      this.refreshing = pending;
      const clear = () => {
        if (this.refreshing === pending) this.refreshing = undefined;
      };
      pending.then(clear, clear);
    }
    return this.refreshing;
  }

  private async exchangeRefresh(): Promise<CalimeroSession> {
    const current = this.current;
    if (!current) throw new Error('no session to refresh');
    let session: CalimeroSession | undefined;
    // A node that may not serve the account answers `421 WRONG_NODE` before it
    // spends the refresh token (core #4774), so the same token goes to the next
    // node (`send` moved there already): once per node, at most.
    for (let tried = 1; session === undefined; tried++) {
      try {
        session = await this.post<CalimeroSession>('auth/refresh', { refreshToken: current.refreshToken });
      } catch (error) {
        if (!(error instanceof WrongNode) || tried >= this.nodeUrls.length) throw error;
      }
    }
    // A sign-in or another session taken while this one was refreshing wins.
    if (this.current === current) this.useSession(session);
    return session;
  }

  /**
   * End this session. The client is signed out whether or not the node
   * answers: the revoke (`POST /auth/logout`) is attempted, and its failure
   * (the node unreachable, say) is thrown after the session is dropped, so a
   * caller can say the server may still hold it, but no request after this
   * one carries its token.
   */
  async signOut(): Promise<void> {
    await this.signingOut('auth/logout');
  }

  /**
   * End every session of the signed-in account, on every device, this one
   * too. Like {@link signOut}, this client is signed out even when the
   * request fails, and the failure is thrown.
   */
  async signOutEverywhere(): Promise<void> {
    await this.signingOut('auth/logout-all');
  }

  /**
   * The signed-in account's live sessions, latest active first (at most 256,
   * `GET /auth/sessions`); `current` marks this one. The account holder's own
   * session on the cluster's origin only: an API key or a package-bound
   * session is refused (`403`). A node before core #4894 has no such route
   * ({@link NotFound}).
   */
  async listSessions(): Promise<AccountSession[]> {
    const { sessions } = await this.get<{ sessions: AccountSession[] }>('auth/sessions');
    return sessions;
  }

  /**
   * End one of the signed-in account's sessions (`DELETE
   * /auth/sessions/{session}`), say a lost phone's, from another; no passkey
   * is asked. A session the account does not hold live (ended already, or
   * another account's) is {@link NotFound}; gated as {@link listSessions}.
   * To end this client's own session ({@link AccountSession.current}) use
   * {@link signOut}, which also drops its tokens: ended here, they stay
   * held and the next request or refresh is {@link LoginRequired}.
   */
  async revokeSession(session: string): Promise<void> {
    await this.delete(`auth/sessions/${seg(session)}`);
  }

  /**
   * What the signed-in account's passkeys did, newest first (the last 100,
   * `GET /auth/activity`): each sign-in, with the package and origin its
   * session is bound to, and each change a passkey approved, with its method
   * and subject. `after` (Unix seconds) keeps only what came later. Gated as
   * {@link listSessions}: the account holder's own session on the cluster's
   * origin only. A node before core #4901 has no such route ({@link NotFound}).
   */
  async listActivity(after?: number): Promise<AccountActivity[]> {
    const query = after === undefined ? '' : `?after=${encodeURIComponent(String(after))}`;
    const { activity } = await this.get<{ activity: AccountActivity[] }>(`auth/activity${query}`);
    return activity;
  }

  private async signingOut(path: string): Promise<void> {
    try {
      await this.post(path);
    } finally {
      this.auth = undefined;
      this.current = undefined;
    }
  }

  /** Who the credential is: the account, how it signed in, and the package (`app`) and `origin` a session is bound to. */
  me(): Promise<MeInfo> {
    return this.get('auth/me');
  }

  /**
   * Add another passkey (another device, `passkey`) to the signed-in account;
   * answers its credential id. The node asks for the approval of a passkey
   * the account already has (`412 CONFIRM_REQUIRED`, never the new one),
   * which `approver` gives.
   */
  async addPasskey(passkey: PasskeyProvider, approver: PasskeyProvider): Promise<string> {
    const begin = await this.post<{ challengeId: string; options: Record<string, unknown> }>('auth/passkeys/add/begin');
    const registration = await passkey.create(begin.options);
    const { credentialId } = await this.postConfirmed<{ credentialId: string }>(
      'auth/passkeys/add/finish',
      { challengeId: begin.challengeId, registration },
      approver,
    );
    return credentialId;
  }

  /** Remove one of the account's passkeys (not the last), approved with `passkey` (one it has). */
  async removePasskey(credentialId: string, passkey: PasskeyProvider): Promise<void> {
    await this.deleteConfirmed(`auth/passkeys/${seg(credentialId)}`, passkey);
  }

  /** Name one of the account's passkeys (a device label); `''` clears the name. */
  async labelPasskey(credentialId: string, label: string): Promise<void> {
    await this.post(`auth/passkeys/${seg(credentialId)}`, { label });
  }

  // ---------------------------------------------------------------- account recovery
  //
  // core #4844 (`docs/specs/account-recovery.md`): a recovery code, made with
  // a passkey and shown once, lets someone who lost every passkey register a
  // new one; it is added, and the account signed in, 72 hours later unless a
  // passkey the account still has cancels it first.

  /**
   * Make the account's recovery code (replacing any it had), approved with
   * `passkey` (`412 CONFIRM_REQUIRED`). Answers the code, once: show it to
   * the person to keep offline; the node keeps only its public key. A passkey
   * session on the cluster's own origin only (never an API key or a
   * package-bound session).
   */
  async createRecoveryCode(passkey: PasskeyProvider): Promise<string> {
    const { code } = await this.postConfirmed<{ code: string }>('auth/recovery', {}, passkey);
    return code;
  }

  /** Remove the account's recovery code, approved with `passkey`. */
  async removeRecoveryCode(passkey: PasskeyProvider): Promise<void> {
    await this.deleteConfirmed('auth/recovery', passkey);
  }

  /**
   * Signed out: start recovering the account `code` names. `passkey` makes a
   * new passkey for it (the browser's create prompt, user verified); the
   * node spends the code and keeps the passkey as pending. Nothing is added
   * and no session opens: finish with {@link finishAccountRecovery} at
   * `readyAt`. A code the cluster does not hold (mistyped, replaced or
   * spent) is {@link WrongRecoveryCode}; an account with a recovery already
   * under way `409 RECOVERY_PENDING`.
   */
  async startAccountRecovery(code: string, passkey: PasskeyProvider): Promise<AccountRecovery> {
    try {
      const begin = await this.post<{ challengeId: string; options: Record<string, unknown> }>('auth/recovery/begin', { code });
      const registration = await passkey.create(begin.options);
      return await this.post<AccountRecovery>('auth/recovery/start', { challengeId: begin.challengeId, code, registration });
    } catch (error) {
      if (error instanceof LoginRequired) throw new WrongRecoveryCode(error.message.replace(/^401 UNAUTHENTICATED: /, ''), error.details);
      throw error;
    }
  }

  /**
   * Cancel the recovery of the signed-in account under way, approved with
   * `passkey` (one the account already has). The code stays spent: make a
   * new one.
   */
  async cancelAccountRecovery(passkey: PasskeyProvider): Promise<void> {
    await this.postConfirmed('auth/recovery/cancel', {}, passkey);
  }

  /**
   * Signed out, once the delay passed: finish the recovery with the passkey
   * it registered (`passkey` signs the node's sign-in challenge). The passkey
   * joins the account, every other session of the account ends, and this
   * client is signed in. `accountId` (from the start) lets the node refuse
   * early and offer only that passkey; before `readyAt` it is
   * {@link RecoveryNotReady}, with no recovery under way {@link NotFound}.
   */
  async finishAccountRecovery(passkey: PasskeyProvider, accountId?: string): Promise<CalimeroSession> {
    const session = await this.postConfirmed<CalimeroSession>(
      'auth/recovery/finish',
      accountId ? { accountId } : {},
      passkey,
    );
    this.useSession(session);
    return session;
  }

  /** What this account uses (apps, bundle bytes, API keys, owned orgs), with the cluster's quotas. */
  usage(): Promise<Record<string, unknown>> {
    return this.get('auth/usage');
  }

  /**
   * The node's attestation document, unverified: for display only. Every
   * request this client sends is sealed to a key it verified itself first.
   */
  async attestation(): Promise<AttestationDoc> {
    const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const response = await this.raw(`${this.nodeUrl}/attestation?nonce=${nonce}`);
    if (!response.ok) throw await refusal(response);
    return (await response.json()) as AttestationDoc;
  }

  /** The account's API keys (never the keys themselves). */
  async listApiKeys(): Promise<Array<Record<string, unknown>>> {
    const { keys } = await this.get<{ keys: Array<Record<string, unknown>> }>('auth/apikeys');
    return keys;
  }

  /** Revoke one of the account's API keys, approved with its `passkey` (`412 CONFIRM_REQUIRED`). */
  async revokeApiKey(keyId: string, passkey: PasskeyProvider): Promise<void> {
    await this.deleteConfirmed(`auth/apikeys/${seg(keyId)}`, passkey);
  }

  /**
   * Create an API key for an agent or server, approved with the account's
   * `passkey` (`412 CONFIRM_REQUIRED`); needs a passkey session (an API key
   * is refused `403`). The key is returned once.
   *
   * `upgrades: { app, package? }` makes an upgrade key, for CI: it upgrades
   * that one app to signed releases of its package (default: the one the app
   * runs, by that package's pinned signer) with {@link upgradeApp} and no
   * passkey, and every other request with it is refused
   * `403 UPGRADE_KEY_ONLY`. It takes no other scope field.
   */
  createApiKey(
    options: {
      label?: string;
      apps?: string[];
      methods?: string[];
      readOnly?: boolean;
      allowConfirm?: boolean;
      ttlSecs?: number;
      upgrades?: { app: string; package?: string };
    },
    passkey: PasskeyProvider,
  ): Promise<{ keyId: string; key: string }> {
    return this.postConfirmed('auth/apikeys', { ...options }, passkey);
  }

  // ---------------------------------------------------------------- apps

  /** Upload a raw WASM bundle (development clusters only); answers its hash. */
  async uploadBundle(wasm: Uint8Array): Promise<string> {
    const { hash } = await this.json<{ hash: string }>('POST', 'bundles', undefined, wasm);
    return hash;
  }

  /**
   * Upload a blob for `app`: `blobId` is base58 (what apps print), `id` hex.
   * `contentType` (default `application/octet-stream`; printable ASCII, the
   * node refuses another with `400`) is sent as the upload's `Content-Type`:
   * a component app records it and serves downloads with it. A component
   * app holding as many blobs as it may answers `429 QUOTA_EXCEEDED`.
   */
  uploadBlob(
    app: string,
    data: Uint8Array,
    contentType: string | { contentType?: string } = {},
  ): Promise<{ blobId: string; id: string; size: number }> {
    const mime = (typeof contentType === 'string' ? contentType : contentType.contentType) ?? 'application/octet-stream';
    return this.json('POST', `apps/${seg(app)}/blobs`, undefined, data, mime);
  }

  /** One of `app`'s blobs, by id (base58 or hex). */
  async downloadBlob(app: string, id: string): Promise<Uint8Array> {
    return (await this.blobContent(app, id)).data;
  }

  /**
   * Download a component app's blob with a grant one of its runs handed out
   * (`BlobRef::grant`, up to 24 h). No session needed: the grant is the
   * permission. A bad or expired grant answers `NotFound`, as a missing blob.
   */
  async downloadBlobGranted(app: string, id: string, grant: string): Promise<Uint8Array> {
    return (await this.blobContent(app, id, { grant })).data;
  }

  /**
   * {@link downloadBlob} (or, with `grant`, {@link downloadBlobGranted}) with
   * the content type the node serves it as: the uploader's, for a component
   * app; `application/octet-stream` otherwise.
   */
  async blobContent(app: string, id: string, options: { grant?: string } = {}): Promise<BlobContent> {
    const query = options.grant === undefined ? '' : `?grant=${encodeURIComponent(options.grant)}`;
    const response = await this.send('GET', `apps/${seg(app)}/blobs/${seg(id)}${query}`);
    return {
      data: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  /** `app`'s blobs. */
  async listBlobs(app: string): Promise<BlobInfo[]> {
    const { blobs } = await this.get<{ blobs: BlobInfo[] }>(`apps/${seg(app)}/blobs`);
    return blobs;
  }

  /** One of `app`'s blobs' id and size; `NotFound` if the app has no such blob. */
  blobInfo(app: string, id: string): Promise<BlobInfo> {
    return this.get(`apps/${seg(app)}/blobs/${seg(id)}/info`);
  }

  /** Delete one of `app`'s blobs (its owner, or an admin of its organization). */
  async deleteBlob(app: string, id: string): Promise<void> {
    await this.delete(`apps/${seg(app)}/blobs/${seg(id)}`);
  }

  // ---------------------------------------------------------------- packages

  /** Install a signed `.mpk` package file. */
  uploadPackage(mpk: Uint8Array): Promise<PackageInstalled> {
    return this.json('POST', 'packages', undefined, mpk, 'application/octet-stream');
  }

  /** Install `package@version` from the cluster's registry; every node that runs it verifies it. */
  installPackage(pkg: string, version: string): Promise<PackageInstalled> {
    return this.post('packages/install', { package: pkg, version });
  }

  /** Installed packages and their versions. */
  async packages(): Promise<PackageInfo[]> {
    const { packages } = await this.get<{ packages: PackageInfo[] }>('packages');
    return packages;
  }

  /** One installed package and its versions. */
  package(pkg: string): Promise<PackageInfo> {
    return this.get(`packages/${seg(pkg)}`);
  }

  /** Uninstall one version, or the whole package. Refused while an app runs it. */
  uninstallPackage(pkg: string, version?: string): Promise<Record<string, unknown>> {
    return this.delete(version === undefined ? `packages/${seg(pkg)}` : `packages/${seg(pkg)}/${seg(version)}`);
  }

  // ---------------------------------------------------------------- app instances

  /** Apps this caller reaches, optionally only those of one package or bundle. */
  async listApps(filter: { package?: string; bundle?: string } = {}): Promise<AppInfo[]> {
    const q = new URLSearchParams();
    if (filter.package) q.set('package', filter.package);
    if (filter.bundle) q.set('bundle', filter.bundle);
    const query = q.toString();
    const { apps } = await this.get<{ apps: AppInfo[] }>(query ? `apps?${query}` : 'apps');
    return apps;
  }

  getApp(app: string): Promise<Record<string, unknown>> {
    return this.get(`apps/${seg(app)}`);
  }

  /** Delete an app instance (its owner, or an admin of its organization). */
  async deleteApp(app: string): Promise<void> {
    await this.delete(`apps/${seg(app)}`);
  }

  /** Who may reach the app: `{ kind: 'owner' | 'org' | 'public' | 'accounts' | 'team', ... }`. */
  async setAccess(app: string, access: Record<string, unknown>): Promise<void> {
    await this.post(`apps/${seg(app)}/access`, { access });
  }

  /** Set the app instance's metadata (its owner, or an admin of its organization); at most 16 KiB. */
  async setAppMetadata(app: string, metadata: unknown): Promise<void> {
    await this.post(`apps/${seg(app)}/metadata`, { metadata });
  }

  /**
   * A component app's xcalls: how many messages wait in its outbox, and the
   * dead letters (never delivered), newest last. Its owner's or an org
   * admin's (`403` to anyone else); `409 NOT_SUPPORTED` for an app on the
   * wasmer runtime, whose xcalls are follow-ups.
   */
  appXcalls(app: string): Promise<AppXcalls> {
    return this.get(`apps/${seg(app)}/xcalls`);
  }

  /** What the app's storage holds: `{ keys, bytes, blobs, blobBytes }`. */
  appStorage(app: string): Promise<Record<string, unknown>> {
    return this.get(`apps/${seg(app)}/storage`);
  }

  /** The ABI the app's bundle embeds: `{ bundle, abi }`. */
  appAbi(app: string): Promise<Record<string, unknown>> {
    return this.get(`apps/${seg(app)}/abi`);
  }

  /**
   * The app's OpenAPI 3.1 document, generated by the node from the ABI its
   * bundle embeds: one `POST /apps/{app}/methods/{name}` per method, its
   * errors, step-ups and event stream. Same access as {@link appAbi}; a node
   * from before the route (core 1.0.0-rc.15 and earlier) answers `404`.
   */
  appOpenApi(app: string): Promise<Record<string, unknown>> {
    return this.get(`apps/${seg(app)}/openapi.json`);
  }

  /**
   * Run `method` by its own route, `POST /apps/{app}/methods/{method}`, which
   * the node answers as `/intents` (a call) or `/views` (a view the ABI
   * declares), with the same gate and step-up. `body` is theirs without
   * `method`; a call gets an idempotency key when it has none, so retries of a
   * 503 run once. With `passkey`, a `412 CONFIRM_REQUIRED` is approved and the
   * call sent again once, as {@link callConfirmed} does.
   */
  callMethod<T = CallResult | ViewResult>(
    app: string,
    method: string,
    body: { args?: unknown; idempotencyKey?: string; consistency?: 'strong' | 'stale'; minIndex?: number } = {},
    passkey?: PasskeyProvider,
  ): Promise<T> {
    const path = `apps/${seg(app)}/methods/${seg(method)}`;
    const sent: Record<string, unknown> = {
      ...body,
      args: body.args ?? {},
      idempotencyKey: body.idempotencyKey ?? newIdempotencyKey(),
    };
    if (!passkey) return this.retried<T>('POST', path, sent);
    return this.confirmed<T>('POST', path, sent, passkey, (b) => this.retried<T>('POST', path, b, b.confirm !== undefined));
  }

  /**
   * Hand the app to another account (an organization's app only to one of its
   * members), approved with `passkey`. The app's owner may; for an
   * organization's app, its owner only while a member of the organization
   * (`member` or above), and the organization's admins (`admin`, `owner`)
   * too, so an organization can hand on an app whose owner left (core #4893).
   */
  async transferApp(app: string, to: string, passkey: PasskeyProvider): Promise<void> {
    await this.postConfirmed(`apps/${seg(app)}/transfer`, { to }, passkey);
  }

  /**
   * Move an app instance to another organization (`toOrg`), its data where it
   * is (core `POST /apps/{app}/move`), approved with `passkey`. Whoever
   * manages the app now (its owner while a member of its organization, an
   * admin there, or a personal app's owner) moves it, as an admin or the
   * owner of `toOrg`. Its files, runs and quotas go to the target; `org` or
   * app-team access becomes the target's app team of its package.
   * `bringMembers` adds the people of its organization who reach it to the
   * target (capped at `member`). A node from before the route answers `404`
   * ({@link NotFound}): the feature is not there yet.
   */
  moveApp(
    app: string,
    toOrg: string,
    options: { bringMembers?: boolean } = {},
    passkey?: PasskeyProvider,
  ): Promise<MoveAppResult> {
    const path = `apps/${seg(app)}/move`;
    const body = { toOrg, bringMembers: options.bringMembers ?? false };
    return passkey ? this.postConfirmed(path, body, passkey) : this.post(path, body);
  }

  /**
   * Move an app to another release of its package (`{ version }`), another
   * package, or a bundle hash, running its migration. Answers the upgrade's
   * entry; a failed migration rejects with code `UPGRADE_FAILED` (422).
   * Where owners hold app upgrades, the node asks for the approval of
   * whoever the package's manifest names (`412 CONFIRM_REQUIRED`), which
   * `passkey` gives. Refused (`403`) to a session opened on an app's
   * frontend: an app asks its user with {@link requestConsent} instead. Past
   * a release deadline its approver has not met: {@link ReleaseDeadlineError}.
   * With an upgrade key ({@link createApiKey} `upgrades`) pass no passkey and
   * a `version` of the key's package: the key's own proof stands in for it.
   */
  upgradeApp(
    app: string,
    target: { version?: string; package?: string; service?: string; bundle?: string; migrate?: string },
    passkey?: PasskeyProvider,
  ): Promise<{ index: number; status: string; error: unknown }> {
    const path = `apps/${seg(app)}/upgrade`;
    return passkey ? this.postConfirmed(path, target, passkey) : this.post(path, target);
  }

  /**
   * POST `body` to `path`, answering a `412 CONFIRM_REQUIRED` with `passkey`'s
   * assertion over the node's challenge (deleting an org, approving a release,
   * adding a member, ...): the same body again, with `confirm`. Without a
   * passkey (a caller in plain JavaScript passing none) the `412` reaches the
   * caller as {@link ConfirmRequired}, carrying the challenge.
   */
  postConfirmed<T>(path: string, body: Record<string, unknown>, passkey: PasskeyProvider): Promise<T> {
    return this.confirmed<T>('POST', path, body, passkey);
  }

  /**
   * {@link postConfirmed} for a DELETE (deleting an organization, removing a
   * member or a passkey): `body` (`{}` by default) goes as JSON, and the
   * confirmed retry carries `confirm` beside it.
   */
  deleteConfirmed<T>(path: string, passkey: PasskeyProvider, body: Record<string, unknown> = {}): Promise<T> {
    return this.confirmed<T>('DELETE', path, body, passkey);
  }

  private async confirmed<T>(
    method: 'POST' | 'DELETE',
    path: string,
    body: Record<string, unknown>,
    passkey: PasskeyProvider | undefined,
    send: (body: Record<string, unknown>) => Promise<T> = (b) => this.json<T>(method, path, b),
    userVerification: PasskeyUserVerification = 'required',
    signal?: AbortSignal,
  ): Promise<T> {
    try {
      return await send(body);
    } catch (error) {
      if (!(error instanceof ConfirmRequired) || !passkey) throw error;
      const d = error.details as {
        challengeId: string;
        challenge: string;
        rpId: string;
        allowCredentials?: string[];
        userVerification?: unknown;
      };
      let assertion: Awaited<ReturnType<PasskeyProvider['get']>>;
      try {
        // A step-up is taken only with the user verified (PIN or biometric);
        // `preferred` lets a password manager skip it, and the node then
        // refuses. Only the sign-up confirmation passes `preferred`. A
        // requirement the node names itself wins.
        assertion = await passkey.get(fromB64url(d.challenge), d.rpId, d.allowCredentials, {
          userVerification: userVerificationOf(d.userVerification, userVerification),
          ...(signal ? { signal } : {}),
        });
      } catch (declined) {
        throw promptFailure(declined);
      }
      return send({ ...body, confirm: { challengeId: d.challengeId, assertion } });
    }
  }

  /**
   * Create an app instance from a bundle hash, or from a package release
   * (`{ package, version?, service? }`, installed from the registry first if
   * the cluster lacks it). With `deployment`, the instance runs the release
   * that deployment offers for `package` (`version`, if given, must be it)
   * and records the deployment; no install, no deployer grant. A package or
   * version it does not offer answers `400 NOT_OFFERED`, several offered
   * releases with no `version` `400 VERSION_REQUIRED`, and an unknown
   * `service` `400 NO_SUCH_SERVICE`. A page opened through `/d/{deployment}/`
   * finds its deployment with {@link pageDeployment}.
   */
  async createApp(
    name: string,
    bundle: string | { package: string; version?: string; service?: string; deployment?: string },
    options: {
      org?: string;
      access?: Record<string, unknown>;
      confirmMethods?: string[];
      /** Arguments for the app's `init`. A failed init rejects with code `INIT_FAILED`. */
      initArgs?: unknown;
    } = {},
  ): Promise<string> {
    const target = typeof bundle === 'string' ? { bundle } : bundle;
    const { appId } = await this.post<{ appId: string }>('apps', { name, ...target, ...options });
    return appId;
  }

  /**
   * Call a method. A retry with the same `idempotencyKey` is answered once.
   * Without one, the client makes one, so its own retries of a 503 share it.
   */
  call(app: string, method: string, args: unknown = {}, idempotencyKey?: string): Promise<CallResult> {
    const key = idempotencyKey ?? newIdempotencyKey();
    return this.retried('POST', `apps/${seg(app)}/intents`, { method, args, idempotencyKey: key });
  }

  /**
   * Call a method that needs the account holder's approval: the node returns a
   * challenge over this exact call, which `passkey` signs. A declined prompt
   * rejects with {@link ConfirmCancelled}.
   */
  async callConfirmed(
    app: string,
    method: string,
    args: unknown,
    passkey: PasskeyProvider,
    idempotencyKey?: string,
  ): Promise<CallResult> {
    const path = `apps/${seg(app)}/intents`;
    const key = idempotencyKey ?? newIdempotencyKey();
    // The confirmed attempt goes out exactly once: its challenge is single-use,
    // so a resend would be refused on the challenge, not answered from the key.
    return this.confirmed<CallResult>('POST', path, { method, args, idempotencyKey: key }, passkey, (body) =>
      this.retried<CallResult>('POST', path, body, body.confirm !== undefined),
    );
  }

  /** Run a read-only method: strong by default, or stale from any replica. */
  view(app: string, method: string, args: unknown = {}, options: { stale?: boolean; minIndex?: number } = {}): Promise<ViewResult> {
    return this.retried('POST', `apps/${seg(app)}/views`, {
      method,
      args,
      consistency: options.stale ? 'stale' : 'strong',
      minIndex: options.minIndex ?? 0,
    });
  }

  /** Committed events from index `from`, then live, until `signal` aborts. */
  events(app: string, from = 0, signal?: AbortSignal): AsyncGenerator<CloudEvent> {
    return this.stream(`apps/${seg(app)}/events?from=${from}`, signal);
  }

  /** A server-sent event stream on `path`, sealed like every other answer. */
  private async *stream(path: string, signal?: AbortSignal): AsyncGenerator<CloudEvent> {
    const response = await this.send('GET', path, undefined, undefined, undefined, signal);
    if (!response.body) throw new CalimeroError(response.status, 'EVENTS', 'the event stream has no body');
    yield* sseFrames(response.body);
  }

  // ---------------------------------------------------------------- presence

  /**
   * Publish this device's presence in `app`: `state` (at most 4 KiB) or `null`
   * to retract it. The newest `seq` wins; send the same `seq` and state again
   * as a heartbeat, since an entry not refreshed within 7 s is gone.
   */
  async publishPresence(app: string, seq: number, state: Uint8Array | null): Promise<void> {
    await this.post(`apps/${seg(app)}/presence`, { seq, state: state === null ? null : toHex(state) });
  }

  /** Who is present in `app` now. */
  async presence(app: string): Promise<PresenceEntry[]> {
    const { present } = await this.get<{ present: PresenceEntry[] }>(`apps/${seg(app)}/presence`);
    return present;
  }

  /**
   * Presence as a stream until `signal` aborts: a `snapshot` event (`data` the
   * entries present), then a `presence` event (`data` one entry) per change.
   */
  presenceStream(app: string, signal?: AbortSignal): AsyncGenerator<CloudEvent> {
    return this.stream(`apps/${seg(app)}/presence/stream`, signal);
  }

  // ---------------------------------------------------------------- aliases

  /** Name an app (its id or context id) for this account. */
  async setAlias(alias: string, app: string): Promise<void> {
    await this.put(`auth/aliases/${seg(alias)}`, { app });
  }

  /** This account's aliases, alias → app id. */
  async aliases(): Promise<Record<string, string>> {
    const { aliases } = await this.get<{ aliases: Record<string, string> }>('auth/aliases');
    return aliases;
  }

  /** The app an alias names. */
  async alias(alias: string): Promise<string> {
    const { appId } = await this.get<{ appId: string }>(`auth/aliases/${seg(alias)}`);
    return appId;
  }

  async deleteAlias(alias: string): Promise<void> {
    await this.delete(`auth/aliases/${seg(alias)}`);
  }

  // ---------------------------------------------------------------- organizations

  /**
   * Create an organization. `recoveryKey` (from {@link recoveryPublicKey}) lets
   * whoever holds its seed recover the organization if its owner loses every
   * passkey; keep the seed offline ({@link recoverySeedText}).
   */
  async createOrg(name: string, options: { recoveryKey?: string } = {}): Promise<string> {
    const body: Record<string, unknown> = { name };
    if (options.recoveryKey !== undefined) body.recoveryKey = options.recoveryKey;
    const { orgId } = await this.post<{ orgId: string }>('orgs', body);
    return orgId;
  }

  /**
   * Set or rotate (`publicKey`, from {@link recoveryPublicKey}) or remove
   * (`null`) the organization's recovery key: its owner only, approved with
   * `passkey`. A recovery under way is cancelled, and the old seed's
   * signatures are refused from then on.
   */
  async setRecoveryKey(org: string, publicKey: string | null, passkey: PasskeyProvider): Promise<void> {
    await this.postConfirmed(`orgs/${seg(org)}/recovery`, { publicKey }, passkey);
  }

  /**
   * Start handing `org` to the signed-in account with the recovery seed,
   * which signs here and never leaves this process. Finish with
   * {@link finishRecovery} once `readyAt` has passed; until then the owner may
   * cancel. A wrong seed (or no organization, or none set) is a `403`.
   */
  async startRecovery(org: string, seed: Uint8Array): Promise<RecoveryTimes> {
    const account = (await this.me()).accountId as string;
    const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
    const signature = await signRecovery(seed, org, account, nonce);
    return this.post(`orgs/${seg(org)}/recovery/start`, { nonce, signature });
  }

  /** Cancel the recovery under way: the organization's owner, approved with `passkey`. */
  async cancelRecovery(org: string, passkey: PasskeyProvider): Promise<void> {
    await this.postConfirmed(`orgs/${seg(org)}/recovery/cancel`, {}, passkey);
  }

  /**
   * Finish a recovery this account started, once its delay passed
   * (`409 RECOVERY_NOT_READY` before, with `readyAt`), approved with this
   * account's `passkey`. The account becomes the owner; the previous owner
   * leaves the organization.
   */
  finishRecovery(org: string, passkey: PasskeyProvider): Promise<{ org: string; previousOwners: string[] }> {
    return this.postConfirmed(`orgs/${seg(org)}/recovery/finish`, {}, passkey);
  }

  /** The organization, with the teams this caller reaches or manages. */
  getOrg(org: string): Promise<OrgInfo> {
    return this.get(`orgs/${seg(org)}`);
  }

  /**
   * Each member's lockout risk (`GET /orgs/{org}/members?detail=security`),
   * for the organization's owner and admins: name, role, teams, passkeys held
   * (to `'3+'`), recovery code set, last active UTC day and live sessions.
   * A member below admin is refused (`403 FORBIDDEN`), someone outside the
   * organization gets {@link NotFound}; the admin's own session on the
   * cluster's origin only, never an API key or a package-bound session. A
   * node before core #4902 has no such route (a bare `404`).
   */
  async orgMembersSecurity(org: string): Promise<OrgMemberSecurity[]> {
    const { members } = await this.get<{ members: OrgMemberSecurity[] }>(
      `orgs/${seg(org)}/members?detail=security`,
    );
    return members;
  }

  /**
   * Delete an organization with its teams, invites and apps (its owner only).
   * The node asks for the owner's passkey (`412 CONFIRM_REQUIRED`), which `passkey` gives.
   */
  async deleteOrg(org: string, passkey: PasskeyProvider): Promise<void> {
    await this.deleteConfirmed(`orgs/${seg(org)}`, passkey);
  }

  /** Set the organization's metadata (an admin, or a holder of `MANAGE_METADATA`); at most 16 KiB. */
  async setOrgMetadata(org: string, metadata: unknown): Promise<void> {
    await this.post(`orgs/${seg(org)}/metadata`, { metadata });
  }

  /** Set a member's metadata (theirs, or an admin's); `null` clears it. */
  async setMemberMetadata(org: string, account: string, metadata: unknown): Promise<void> {
    await this.post(`orgs/${seg(org)}/members/${seg(account)}/metadata`, { metadata });
  }

  /**
   * Upgrade every app of `org` that runs `target.package` to `target.version`
   * (optionally one team's, with `cascade` the teams below it). The org's owner,
   * or a holder of `MANAGE_APPLICATION`, approves the whole run with `passkey`.
   * Answers the run; {@link upgradeRun} follows it.
   */
  upgradeOrg(org: string, target: OrgUpgradeTarget, passkey: PasskeyProvider): Promise<UpgradeRun> {
    return this.postConfirmed(`orgs/${seg(org)}/upgrade`, { ...target }, passkey);
  }

  /** An organization-wide upgrade run: its apps, those done and those that failed. */
  upgradeRun(org: string, run: string): Promise<UpgradeRun> {
    return this.get(`orgs/${seg(org)}/upgrades/${seg(run)}`);
  }

  /** Run the apps that failed in `run` again, as a new run, approved with `passkey`. */
  retryUpgradeRun(org: string, run: string, passkey: PasskeyProvider): Promise<UpgradeRun> {
    return this.postConfirmed(`orgs/${seg(org)}/upgrades/${seg(run)}/retry`, {}, passkey);
  }

  /**
   * Approve a mero-tee release to hold the apps of `org`, or of this account
   * outside any organization (`org` `null`); `approved: false` withdraws it.
   * Until then, nodes on that release get none of those apps' data. For an
   * organization, a member holding `APPROVE_RELEASES` approves with `passkey`;
   * the node binds the release's measurements itself. Refused (`403`) to a
   * session opened on an app's frontend: an app asks its user with
   * {@link requestConsent} instead.
   */
  async approveRelease(
    org: string | null,
    version: string,
    passkey: PasskeyProvider,
    approved = true,
  ): Promise<Record<string, unknown>> {
    const path = org === null ? 'auth/releases' : `orgs/${seg(org)}/releases`;
    return this.postConfirmed(path, { version, approved }, passkey);
  }

  /**
   * Approve the URL prefixes apps from `pkg`'s publisher may call out to, for
   * `org`'s apps or this account's own (`org` `null`). `prefixes` `'manifest'`
   * (the default) approves every prefix the package's latest release declares;
   * `replace` sets exactly `prefixes`, which is how one is revoked. Approved
   * with `passkey`. Refused (`403`) to a session opened on an app's frontend:
   * an app asks with {@link requestConsent} (`kind: 'outbound'`) instead.
   */
  async approveOutbound(
    org: string | null,
    pkg: string,
    passkey: PasskeyProvider,
    options: { prefixes?: string[] | 'manifest'; replace?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    const path = org === null ? 'auth/outbound' : `orgs/${seg(org)}/outbound`;
    return this.postConfirmed(
      path,
      { package: pkg, prefixes: options.prefixes ?? 'manifest', replace: options.replace ?? false },
      passkey,
    );
  }

  // ---------------------------------------------------------------- approvals

  /**
   * One page of the report of a scope's apps: an organization's (any member;
   * `404` to anyone else) or, with `org` `null`, the account's own outside any
   * organization (a session bound to an app's frontend: that package's apps).
   * The governance, the scope's approved releases, the releases the cluster's
   * nodes run and whether each is approved, and per app its release, newer
   * releases it may move to, last upgrade and replicas.
   */
  appsReport(org: string | null, page: PageOptions = {}): Promise<AppsReport> {
    const path = org === null ? 'auth/apps' : `orgs/${seg(org)}/apps`;
    return this.get(`${path}${pageQuery(page)}`);
  }

  /** {@link appsReport}, every page, with the apps of all of them in `apps`. */
  async appsReportAll(org: string | null): Promise<AppsReport> {
    const first = await this.appsReport(org);
    const apps: ReportedApp[] = [...first.apps];
    let next = first.next;
    while (next !== null) {
      const page = await this.appsReport(org, { after: next });
      apps.push(...page.apps);
      next = page.next;
    }
    return { ...first, apps, next: null };
  }

  /** `GET /releases`: the cluster's governance and every release deadline. Public. */
  releaseRules(): Promise<ReleaseRules> {
    return this.get('releases');
  }

  /**
   * What waits for a decision in a scope (`org`, or the account's own apps
   * with `null`): mero-tee releases the cluster's nodes run that the scope has
   * not approved, apps with newer releases of their package, and whether a
   * passed deadline stops new work. Read over the sealed channel; act on an
   * item by sending the user to the consent page ({@link requestConsent},
   * `releaseConsent`, `upgradeConsent`).
   */
  async pendingApprovals(org: string | null = null): Promise<PendingApprovals> {
    const [report, rules] = await Promise.all([this.appsReportAll(org), this.releaseRules()]);
    return pendingApprovalsFrom(report, rules);
  }

  /**
   * Ask the node to ask the user: a release, upgrade or outbound approval
   * that only the account holder may make, decided on the node's own consent
   * page, never in the app. Needs a passkey session (a session bound to the
   * app's frontend is fine). Send the person to the answer's `url`; the page
   * sends them back to `returnTo?request_id=…&result=approved|declined`
   * (`consentReturn`), and {@link consentResult} confirms the decision.
   */
  requestConsent(request: ConsentRequest): Promise<ConsentStarted> {
    return this.post('consent/requests', request);
  }

  /**
   * {@link requestConsent}, then send the browser to the consent page
   * (`navigate`, by default `window.location.assign`). Pass `navigate` itself
   * or {@link OpenConsentOptions}, whose `confirm` runs first with the node's
   * answer so the app can show the person its `code`; when it answers `false`
   * the page is not opened. When the node sends a `code` that is not
   * {@link confirmationCode} of `requestId`, it throws `CalimeroError`
   * (`CONSENT_CODE_MISMATCH`) and does not navigate. Answers the request
   * once `navigate` returns (or `confirm` declines): with a popup
   * (`url => window.open(url)`), poll it with {@link waitForConsent}.
   */
  async openConsentPage(
    request: ConsentRequest,
    navigateOrOptions: ((url: string) => void) | OpenConsentOptions = {},
  ): Promise<ConsentStarted> {
    const options = typeof navigateOrOptions === 'function' ? { navigate: navigateOrOptions } : navigateOrOptions;
    const navigate =
      options.navigate ??
      ((url: string) => {
        const w = (globalThis as { window?: { location: { assign(url: string): void } } }).window;
        if (!w) throw new Error('no window to open the consent page in; pass `navigate`');
        w.location.assign(url);
      });
    const started = await this.requestConsent(request);
    if (started.code !== undefined) {
      const expected = await confirmationCode(started.requestId);
      if (started.code !== expected) {
        throw new CalimeroError(200, 'CONSENT_CODE_MISMATCH', 'the consent page code does not match the request', {
          requestId: started.requestId,
          code: started.code,
          expected,
        });
      }
    }
    if (options.confirm && !(await options.confirm(started))) return started;
    navigate(started.url);
    return started;
  }

  /** The decision on a consent request (any node answers, for the account that asked). */
  consentResult(requestId: string): Promise<ConsentResult> {
    return this.get(`consent/${seg(requestId)}/result`);
  }

  /**
   * Poll {@link consentResult} until the request is decided, every
   * `intervalMs` (2 s), until `signal` aborts or `expiresAt` (Unix seconds)
   * passes, when it answers the last `pending` result.
   */
  async waitForConsent(
    requestId: string,
    options: { intervalMs?: number; signal?: AbortSignal; expiresAt?: number } = {},
  ): Promise<ConsentResult> {
    const interval = options.intervalMs ?? 2000;
    for (;;) {
      const result = await this.consentResult(requestId);
      if (result.status !== 'pending') return result;
      if (options.signal?.aborted) return result;
      if (options.expiresAt !== undefined && Date.now() / 1000 >= options.expiresAt) return result;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  /** `GET /publishers/{signerId}`: the cluster name and binding generation a key signs to bind it next. */
  publisherBinding(signerId: string): Promise<PublisherBindingInfo> {
    return this.get(`publishers/${seg(signerId)}`);
  }

  /**
   * Bind a package signing key to `org`, which then approves the node images
   * every instance of the key's packages runs on, and upgrades those whose
   * package declares `upgrades: publisher`. `proof` is the key's signature
   * over `publisherBindingMessage(cluster, org, signerId, generation)`; a
   * member holding `APPROVE_RELEASES` sends it with `passkey`.
   */
  bindPublisher(org: string, proof: PublisherProof, passkey: PasskeyProvider): Promise<Record<string, unknown>> {
    return this.postConfirmed(`orgs/${seg(org)}/publishers`, { ...proof }, passkey);
  }

  /**
   * Upgrade every instance of `pkg` whose release declares `upgrades:
   * publisher`, whoever owns it, as its publisher `org` (a
   * `MANAGE_APPLICATION` holder there), with one passkey approval. Answers
   * the run, kept on the publisher.
   */
  upgradePublished(
    org: string,
    pkg: string,
    target: { version: string; migrate?: string },
    passkey: PasskeyProvider,
  ): Promise<UpgradeRun> {
    return this.postConfirmed(`orgs/${seg(org)}/packages/${seg(pkg)}/upgrade`, { ...target }, passkey);
  }

  // ---------------------------------------------------------------- operator

  /** `GET /ops/apps`: what every app runs, without names or accounts. Operator token (`useApiKey`). */
  opsApps(page: PageOptions = {}): Promise<OpsAppsReport> {
    return this.get(`ops/apps${pageQuery(page)}`);
  }

  /** `GET /ops/orgs`: each organization's approved releases. Operator token. */
  opsOrgs(page: PageOptions = {}): Promise<OpsOrgsReport> {
    return this.get(`ops/orgs${pageQuery(page)}`);
  }

  /**
   * `GET /ops/served-origins`: every served origin (custom domain) the
   * cluster's log holds, with its package's label and no package name or
   * account. Operator token.
   */
  opsServedOrigins(): Promise<ServedOrigins> {
    return this.get('ops/served-origins');
  }

  /**
   * Announce when work on images older than `version` ends: from `after` on,
   * a scope that has not approved it (or newer) starts no new work. Operator
   * token.
   */
  async setReleaseDeadline(version: string, after: Date | string): Promise<void> {
    const at = typeof after === 'string' ? after : after.toISOString();
    await this.post(`ops/releases/${seg(version)}/deadline`, { after: at });
  }

  /** Lift a release's deadline. Operator token. */
  async liftReleaseDeadline(version: string): Promise<void> {
    await this.delete(`ops/releases/${seg(version)}/deadline`);
  }

  /** Add a member, or change their role, approved with the caller's `passkey`. */
  async setMember(
    org: string,
    account: string,
    role: 'guest' | 'member' | 'admin' | 'owner',
    passkey: PasskeyProvider,
  ): Promise<void> {
    await this.postConfirmed(`orgs/${seg(org)}/members`, { account, role }, passkey);
  }

  /**
   * Remove a member, or leave (`account` the caller's own), approved with the
   * caller's `passkey`.
   */
  removeMember(org: string, account: string, passkey: PasskeyProvider): Promise<Record<string, unknown>> {
    return this.deleteConfirmed(`orgs/${seg(org)}/members/${seg(account)}`, passkey);
  }

  /**
   * Set capability bits ({@link ORG_CAPABILITIES}): for a member (`account`),
   * for a member of one team (`account` and `team`), a team's default
   * (`team` alone, {@link setTeamDefaultCapabilities}), or the
   * organization's default (neither). Approved with the caller's `passkey`.
   */
  async setCapabilities(
    org: string,
    capabilities: number,
    passkey: PasskeyProvider,
    at: { account?: string; team?: string } = {},
  ): Promise<void> {
    await this.postConfirmed(`orgs/${seg(org)}/capabilities`, { capabilities, ...at }, passkey);
  }

  /**
   * Set the capability bits everyone in `team` holds there on top of their
   * own, unless their row sets its own (`POST /orgs/{org}/capabilities` with
   * `team` and no `account`): `ORG_CAPABILITIES.INVITE_MEMBERS` is "members
   * may invite others to this app". The team's managers, or whoever holds
   * `MANAGE_MEMBERS` on it; approved with the caller's `passkey`
   * (`__set_default_capabilities { team, capabilities }`).
   */
  async setTeamDefaultCapabilities(
    org: string,
    team: string,
    capabilities: number,
    passkey: PasskeyProvider,
  ): Promise<void> {
    await this.postConfirmed(`orgs/${seg(org)}/capabilities`, { team, capabilities }, passkey);
  }

  async createTeam(org: string, name: string, join: 'everyone' | 'invite', parent?: string): Promise<string> {
    const { teamId } = await this.post<{ teamId: string }>(`orgs/${seg(org)}/teams`, { name, join, parent });
    return teamId;
  }

  /**
   * A team the caller sees: its rows (each with its effective capabilities),
   * children, apps, the package it is the app team of and its default
   * capabilities.
   */
  getTeam(org: string, team: string): Promise<TeamInfo> {
    return this.get(`orgs/${seg(org)}/teams/${seg(team)}`);
  }

  /**
   * Rename, change who may join, set the app's metadata, or move the team:
   * `parent: null` moves it to the top, an absent `parent` leaves it.
   */
  async updateTeam(
    org: string,
    team: string,
    update: { name?: string; join?: 'everyone' | 'invite'; parent?: string | null; metadata?: unknown },
  ): Promise<void> {
    await this.post(`orgs/${seg(org)}/teams/${seg(team)}`, update);
  }

  /**
   * Delete a team, the teams below it and their apps. When any of those
   * teams holds apps the node asks for the caller's passkey (`412
   * CONFIRM_REQUIRED`, its details listing the `apps` that go, which the
   * approval names; an app added after it is refused), which `passkey` gives.
   * Without one that `412` reaches the caller as {@link ConfirmRequired}. A
   * team with no apps is deleted without a passkey.
   */
  async deleteTeam(org: string, team: string, passkey?: PasskeyProvider): Promise<void> {
    const path = `orgs/${seg(org)}/teams/${seg(team)}`;
    await (passkey ? this.deleteConfirmed(path, passkey) : this.delete(path));
  }

  /**
   * Add a member to a team, or change their row: role, lead, capability bits.
   * Approved with the caller's `passkey`.
   */
  async setTeamMember(
    org: string,
    team: string,
    account: string,
    passkey: PasskeyProvider,
    row: { role?: 'lead' | 'member' | 'readOnly'; lead?: boolean; capabilities?: number } = {},
  ): Promise<void> {
    await this.postConfirmed(`orgs/${seg(org)}/teams/${seg(team)}/members`, { account, ...row }, passkey);
  }

  /** Remove a member from a team, approved with the caller's `passkey`. */
  async removeTeamMember(org: string, team: string, account: string, passkey: PasskeyProvider): Promise<void> {
    await this.deleteConfirmed(`orgs/${seg(org)}/teams/${seg(team)}/members/${seg(account)}`, passkey);
  }

  /**
   * Make an invite into `org` (and `teams`), approved with the caller's
   * `passkey`; answers its token, which {@link redeemInvite} takes (no
   * approval there).
   */
  async invite(
    org: string,
    role: 'guest' | 'member' | 'admin',
    passkey: PasskeyProvider,
    teams: string[] = [],
    options: { ttlSecs?: number; uses?: number } = {},
  ): Promise<string> {
    const { token } = await this.postConfirmed<{ token: string }>(
      `orgs/${seg(org)}/invites`,
      { role, teams, ...options },
      passkey,
    );
    return token;
  }

  redeemInvite(token: string): Promise<Record<string, unknown>> {
    return this.post(`invites/${seg(token)}/redeem`);
  }

  /**
   * The organization's pending invites the caller may see (never a token):
   * every one for an owner or admin, their own, and those naming only teams
   * they manage. Expired ones are listed (`expired: true`) until revoked. A
   * caller outside the organization: {@link NotFound}.
   */
  async listInvites(org: string): Promise<OrgInvite[]> {
    const { invites } = await this.get<{ invites: OrgInvite[] }>(`orgs/${seg(org)}/invites`);
    return invites;
  }

  /**
   * Withdraw an invite by its key ({@link listInvites}), approved with the
   * caller's `passkey` (`__revoke_invite { inviteKey }`). One the caller may
   * not see: {@link NotFound}.
   */
  async revokeInvite(org: string, inviteKey: string, passkey: PasskeyProvider): Promise<void> {
    await this.deleteConfirmed(`orgs/${seg(org)}/invites/${seg(inviteKey)}`, passkey);
  }

  // ---------------------------------------------------------------- app teams

  /**
   * The organization's mode and its app teams (one per package), for any
   * member; a guest sees only those they are in. A caller outside the
   * organization: {@link NotFound}.
   */
  listAppTeams(org: string): Promise<AppTeams> {
    return this.get(`orgs/${seg(org)}/app-teams`);
  }

  /**
   * Give apps their own access lists in one step (owner or admin): find or
   * make each package's app team, add everyone who reaches its instances now,
   * and move those instances onto it; with `shared`, close every app team.
   * A package's own `join` opens or closes its team alone, a close keeping
   * everyone who reaches it or only the leads and `keep`.
   * Idempotent per package. Approved with the caller's `passkey`
   * (`__scope_apps { apps, shared }`); a refusal is `400 REJECTED` with the
   * node's reason. For a fresh standalone install pass
   * `{ apps: [{ package, name, instances: [] }] }`.
   */
  scopeApps(org: string, passkey: PasskeyProvider, options: ScopeAppsOptions = {}): Promise<ScopeAppsResult> {
    // The node refuses unknown fields and reads an absent one as its default,
    // so only the fields given go.
    const body: Record<string, unknown> = {};
    if (options.apps !== undefined) body.apps = options.apps;
    if (options.shared !== undefined) body.shared = options.shared;
    return this.postConfirmed(`orgs/${seg(org)}/app-teams`, body, passkey);
  }

  // ---------------------------------------------------------------- package origins

  /**
   * The web origins `{package}`'s managers registered so a frontend they host
   * themselves can sign users in with passkeys ({@link PackageOrigins}).
   * Adding and removing one is approved with a passkey.
   */
  readonly packageOrigins: PackageOrigins = {
    list: async (pkg) => {
      const { origins } = await this.get<{ origins: PackageOrigin[] }>(`package-origins/${seg(pkg)}`);
      return origins ?? [];
    },
    add: (pkg, origin, passkey, options = {}) =>
      this.confirmed<PackageOriginAdded>(
        'POST',
        `package-origins/${seg(pkg)}`,
        // Only the fields set: the node refuses unknown ones, and one that
        // predates served origins takes a plain add unchanged.
        {
          origin,
          ...(options.rpId === undefined ? {} : { rpId: options.rpId }),
          ...(options.served ? { served: true } : {}),
        },
        passkey,
      ),
    remove: (pkg, origin, passkey) =>
      this.confirmed<PackageOriginRemoved>('DELETE', `package-origins/${seg(pkg)}`, { origin }, passkey),
  };

  // ---------------------------------------------------------------- deployers

  /**
   * Let an account or organization install apps where the cluster's
   * deployments are `granted`, until `until` (RFC 3339 or a `Date`; absent,
   * the grant does not end). The cluster's owner grants it, approved with
   * `passkey`, where governance says `deployers: owner`; elsewhere the
   * operator grants with its key, and this is refused `403`.
   */
  grantDeployer(
    deployer: Deployer,
    passkey: PasskeyProvider,
    options: { until?: Date | string } = {},
  ): Promise<{ key: string; deployer: Deployer; grant: Record<string, unknown> }> {
    const until = options.until instanceof Date ? options.until.toISOString() : options.until;
    return this.postConfirmed('deployers', { deployer, ...(until === undefined ? {} : { until }) }, passkey);
  }

  /**
   * Who may install apps on the cluster: its deployments rule, who grants
   * deployers, its owner and every grant. For the cluster's owner, or the
   * operator (its token, `useApiKey`).
   */
  deployers(): Promise<DeployersInfo> {
    return this.get('deployers');
  }

  /**
   * End a deployer's grant (`deployer`, or its key `account:{id}` /
   * `org:{id}`), as the cluster's owner, approved with `passkey`. Apps it
   * installed, and the apps running them, stay.
   */
  async revokeDeployer(deployer: Deployer | string, passkey: PasskeyProvider): Promise<void> {
    const key = typeof deployer === 'string' ? deployer : deployerKey(deployer);
    await this.deleteConfirmed(`deployers/${seg(key)}`, passkey);
  }

  // ---------------------------------------------------------------- deployments

  /**
   * Create a deployment: `owner`'s (the caller's own account, or an
   * organization where it holds `MANAGE_APPLICATION` org-wide) list of the
   * apps it offers, named `name` (1 to 64 characters, one line) for
   * customers. Approved with `passkey`; where deployments are `granted` the
   * caller needs a deployer grant. Answers the deployment's id.
   */
  async createDeployment(name: string, owner: Deployer, passkey: PasskeyProvider): Promise<string> {
    const { id } = await this.postConfirmed<{ id: string }>('deployments', { name, owner }, passkey);
    return id;
  }

  /** The deployments the caller manages: its account's, and its organizations' where it holds `MANAGE_APPLICATION`. */
  async deployments(): Promise<DeploymentInfo[]> {
    const { deployments } = await this.get<{ deployments: DeploymentInfo[] }>('deployments');
    return deployments;
  }

  /** A deployment as anyone may read it: its name, its owner's kind and name, and the apps it offers. Public. */
  deployment(id: string): Promise<PublicDeployment> {
    return this.get(`deployments/${seg(id)}`);
  }

  /** Delete a deployment that offers nothing and has no instances, approved with `passkey`. */
  async deleteDeployment(id: string, passkey: PasskeyProvider): Promise<void> {
    await this.deleteConfirmed(`deployments/${seg(id)}`, passkey);
  }

  /**
   * Offer `package@version` (installed, and seen by the caller) as `app`
   * (1 to 64 letters, digits, `.`, `_`, `-`) in deployment `id`, or move an
   * offered app to another release of its package. Approved with `passkey`.
   */
  offerApp(
    id: string,
    offer: { app: string; package: string; version: string },
    passkey: PasskeyProvider,
  ): Promise<{ deployment: string; app: string; offer: Record<string, unknown> }> {
    return this.postConfirmed(`deployments/${seg(id)}/apps`, { ...offer }, passkey);
  }

  /**
   * Withdraw `app` from deployment `id`, approved with `passkey`; refused
   * while an instance created from the deployment still runs it.
   */
  async withdrawApp(id: string, app: string, passkey: PasskeyProvider): Promise<void> {
    await this.deleteConfirmed(`deployments/${seg(id)}/apps/${seg(app)}`, passkey);
  }

  /**
   * The organizations with instances created from deployment `id`, for its
   * managers: each one's id, name, instance count, apps and releases, first
   * instance, and (core #4902) how many members it has and how many were
   * active in 30 days. Never who the members are, teams or app data.
   */
  deploymentOrgs(id: string): Promise<DeploymentOrgs> {
    return this.get(`deployments/${seg(id)}/orgs`);
  }
}
