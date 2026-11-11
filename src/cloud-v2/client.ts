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

import {
  DEFAULT_RETRY,
  NodeTransport,
  directoryTransport,
  refusal,
  retryDelayMs,
  routePath,
  type CalimeroSession,
  type CloudEvent,
  type CloudRetryOptions,
  type HttpMethod,
} from '../runtime/transport.js';
import { type CloudPolicy } from './attestation.js';
import { DEFAULT_DIRECTORY } from './directory.js';
import { CalimeroError, LoginRequired, OriginNotRegistered, WrongRecoveryCode } from './errors.js';
import { b64url, fromB64url, type PasskeyProvider } from './passkey.js';
import { createApiClient, type ApiClient, type ApiClientOptions } from '../api/client.js';
import type { MethodOptions } from '../api/operation.js';
import { createRoutes, type Routes } from '../generated/methods.js';
import { passkeyConfirm, type PasskeyConfirmOptions } from '../api/step-up.js';

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
  type PageOptions,
  type PendingApprovals,
  type ReportedApp,
} from './approvals.js';
import type { ApiAnswer, ApiSchema } from '../api/types.js';

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
  FeatureNotActive,
  NotFound,
  OriginNotRegistered,
  OriginTaken,
  PasskeyUnknownHere,
  QuotaExceeded,
  RecoveryNotReady,
  ReleaseDeadlineError,
  RuntimeTooOld,
  SignUpRefused,
  TrapError,
  UnavailableError,
  WrongNode,
  WrongRecoveryCode,
  errorFrom,
} from './errors.js';
export type { Committed, SignUpRefusal } from './errors.js';

export type { CalimeroSession, CloudEvent };

export type CallResult = ApiAnswer<'intents'>;

export type ViewResult = ApiAnswer<'views'>;

/** What installing a package release answers. */
export type PackageInstalled = ApiAnswer<'package_install'>;

/** An installed package and its releases. */
export type PackageInfo = ApiSchema<'Package'>;

/** One app instance as `listApps` answers it. */
/** What {@link CalimeroClient.moveApp} answers. */
export type MoveAppResult = ApiAnswer<'app_move'>;

export type AppInfo = ApiSchema<'AppEntry'>;

/**
 * An organization-wide upgrade run, as `upgradeOrg`, `upgradeRun` and
 * `retryUpgradeRun` answer it (core's `UpgradeRun`).
 */
export type UpgradeRun = ApiSchema<'UpgradeRun'>;

/** One of an app's blobs: `blobId` base58 (what apps print), `id` hex. */
export type BlobInfo = ApiAnswer<'blob_info'>;

/** One device present in an app (`publishPresence`); `state` hex, `null` once retracted. */
export type PresenceEntry = ApiAnswer<'presence_get'>['present'][number];

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
export type OrgInfo = ApiSchema<'Org'>;

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
export type AppTeams = ApiAnswer<'app_team_list'>;

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
export type ScopedAppTeam = ApiAnswer<'app_teams_scope'>['teams'][number];

/** `POST /orgs/{org}/app-teams`: the organization's mode after, and each package's team. */
export type ScopeAppsResult = ApiAnswer<'app_teams_scope'>;

/** A pending organization invite, as `GET /orgs/{org}/invites` lists it (never its token). */
export type OrgInvite = ApiAnswer<'invite_list'>['invites'][number];

/** One direct row of a team ({@link TeamInfo}). */
export interface TeamMemberInfo {
  account: string;
  role: 'lead' | 'member' | 'readOnly';
  /** Their effective bits there: their row's own, else the organization's with the team's default on top. */
  capabilities: number;
}

/** `GET /orgs/{org}/teams/{team}` ({@link CalimeroClient.getTeam}). */
export type TeamInfo = ApiSchema<'TeamView'>;

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
export type DeadLetter = ApiSchema<'DeadLetter'>;

/** `GET /apps/{app}/xcalls`: a component app's outbox and its dead letters, newest last. */
export type AppXcalls = ApiAnswer<'app_xcalls'>;

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
export type DeployersInfo = ApiAnswer<'deployer_list'>;

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
export type DeploymentInfo = ApiSchema<'Deployment'>;

/**
 * `GET /deployments/{id}`, public: what a frontend and the customer's consent
 * show. Never its managers, members or customers.
 */
export type PublicDeployment = ApiAnswer<'deployment_get'>;

/** `GET /deployments/{id}/orgs`: the organizations with instances created from a deployment. */
export type DeploymentOrgs = ApiAnswer<'deployment_orgs'>;

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
export type MeInfo = ApiAnswer<'me'>;

/**
 * One of the account's live sessions, as {@link CalimeroClient.listSessions}
 * lists it (core #4894).
 */
export type AccountSession = ApiAnswer<'sessions_list'>['sessions'][number];

/**
 * One thing one of the account's passkeys did, as
 * {@link CalimeroClient.listActivity} lists it (core #4901). Every key is
 * present; the ones its `kind` does not have are `null`.
 */
export type AccountActivity = ApiAnswer<'activity_list'>['activity'][number];

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
export type PackageOrigin = ApiAnswer<'origins_list'>['origins'][number];

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
export type ServedOrigin = ApiAnswer<'ops_served'>['origins'][number];

/** `GET /ops/served-origins`: every served origin the cluster's log holds. Operator token. */
export type ServedOrigins = ApiAnswer<'ops_served'>;

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
export type SignUpPolicy = ApiAnswer<'sign_up_public'>;

/** {@link PageOptions} as a generated route's query, checked as {@link pageQuery} checks them. */
function pageParams(page: PageOptions): { after?: string; limit?: number } {
  pageQuery(page);
  return { after: page.after, limit: page.limit };
}

/** Bytes as lower-case hex. */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A presence state as `POST /apps/{app}/presence` takes it: the bytes as
 * lower-case hex, or `null`, which retracts this device's entry
 * (`client.apps.presencePublish({ app, seq, state: presenceState(bytes) })`).
 */
export function presenceState(state: Uint8Array | null): string | null {
  return state === null ? null : toHex(state);
}

export { DEFAULT_RETRY, retryDelayMs };
export type { CloudRetryOptions };

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

export class CalimeroClient {
  /**
   * The runtime every route of this client is sent through
   * (`@calimero-network/mero-js/runtime`): the attested, sealed channel to each
   * node, the credential and its refresh, the `412 CONFIRM_REQUIRED` step-up,
   * D70 retries and error mapping. A route layer of its own (one generated from
   * the node's OpenAPI document, say) sends through it and shares this
   * client's session.
   */
  readonly transport: NodeTransport;

  /**
   * Low level: the raw `openapi-fetch` client of the node's routes, typed
   * from core's OpenAPI document and sent through {@link transport} (its
   * session is this client's). It answers `{ data, error, response }` and
   * takes openapi-fetch's `params` / `body` / `middleware` shapes. Write
   * against the generated methods ({@link apps}, {@link orgs}, ...) instead;
   * this stays as an escape hatch (a request header, a response header, a
   * route the generated methods leave out).
   */
  readonly api: ApiClient;

  /**
   * The node's routes as methods, generated from core's OpenAPI document
   * (`src/generated/methods.ts`), one group per tag. Each takes one argument
   * object (path parameters, query and body fields merged) and answers the
   * route's payload; a refusal is thrown as the typed {@link CalimeroError}.
   * A step-up or an operator signature is answered by the client's `confirm`
   * / `operatorProof`, or the call's own (`{ confirm: passkeyConfirm(passkey) }`).
   *
   * `client.apps.call({ app, method, args })`, `client.orgs.get({ org })`,
   * `client.orgs.inviteCreate({ org, role }, { confirm })`.
   */
  readonly apps: Routes['apps'];
  /** Account, session, passkey and API-key routes: `client.auth.me()`. See {@link apps}. */
  readonly auth: Routes['auth'];
  /** The consent page's routes. See {@link apps}. */
  readonly consent: Routes['consent'];
  /** Operator routes (the ops token). See {@link apps}. */
  readonly ops: Routes['ops'];
  /** Organization, member, team and invite routes. See {@link apps}. */
  readonly orgs: Routes['orgs'];
  /** Routes anyone may read: attestation, health, releases, publisher bindings. See {@link apps}. */
  readonly public: Routes['public'];
  /** Package routes (`client.packages.install({ package, version })`). See {@link apps}. */
  readonly packages: Routes['packages'];
  /**
   * Deployment, deployer and sign-up routes (`client.deployments.create({ name, owner }, { confirm })`).
   * See {@link apps}.
   */
  readonly deployments: Routes['deployments'];

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
  static async connect(options: CalimeroConnectOptions, api: ApiClientOptions = {}): Promise<CalimeroClient> {
    const transport = await directoryTransport({ ...options, directory: options.directory ?? DEFAULT_DIRECTORY });
    return new CalimeroClient(transport, api);
  }

  /**
   * A client of the nodes `options` names, or one sending through an existing
   * `transport`. `api` answers the node's challenges for every request of
   * {@link api} (a `428 OPERATOR_SIGNATURE_REQUIRED` with the operator key, say).
   */
  constructor(options: CalimeroClientOptions | NodeTransport, api: ApiClientOptions = {}) {
    this.transport = options instanceof NodeTransport ? options : new NodeTransport(options);
    this.api = createApiClient(this.transport, api);
    const routes = createRoutes(this.api);
    this.apps = routes.apps;
    this.auth = routes.auth;
    this.consent = routes.consent;
    this.ops = routes.ops;
    this.orgs = routes.orgs;
    this.public = routes.public;
    this.packages = routes.packages;
    this.deployments = routes.deployments;
  }

  /** A generated method's answer, as the type this class has always answered. */
  private as<T>(result: Promise<unknown>): Promise<T> {
    return result as Promise<T>;
  }

  /** The options that answer a `412 CONFIRM_REQUIRED` with `passkey`, when one is given. */
  private confirmWith(passkey: PasskeyProvider | undefined, options: PasskeyConfirmOptions = {}): MethodOptions | undefined {
    return passkey ? { confirm: passkeyConfirm(passkey, options) } : undefined;
  }

  /** The node requests go to now: `baseUrl`, until a `421 WRONG_NODE` or a failover moved the client on. */
  get nodeUrl(): string {
    return this.transport.nodeUrl;
  }

  /** Every node this client may use, in the order it moves through them. */
  get nodes(): string[] {
    return this.transport.nodes;
  }

  /** Authenticate every request with an API key. */
  useApiKey(key: string): void {
    this.transport.useApiKey(key);
  }

  useSession(session: CalimeroSession): void {
    this.transport.useSession(session);
  }

  get session(): CalimeroSession | undefined {
    return this.transport.session;
  }

  /** A JSON request through the transport, to an untyped path. */
  private json<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    return this.transport.json<T>(method, path, { body });
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
      this.auth.registerBegin({ ...origin === undefined ? { name, ...invite } : { name, origin, ...invite } }),
      origin,
    );
    const signal = options.signal;
    const registration = await (signal ? passkey.create(begin.options, { signal }) : passkey.create(begin.options));
    // The node checks the sign-up's confirmation with the user present, not
    // verified (core `api.rs`: `rp(node)`, `require_uv: false`), as it made
    // the passkey with `preferred`: asking `required` here would refuse a
    // security key without a PIN after it has made the passkey, leaving a
    // passkey with no account. The document says so
    // (`x-calimero-user-verification: preferred`), and the generated method
    // asks the passkey for it.
    const session = await this.auth.registerFinish({ challengeId: begin.challengeId, registration, ...invite }, this.confirmWith(passkey, { signal }));
    this.useSession(session);
    return session;
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
    }>(this.auth.loginBegin({ ...origin === undefined ? {} : { origin } }), origin);
    const rpId = begin.options.rpId ?? begin.options.rp?.id ?? '';
    const challenge = fromB64url(begin.options.challenge);
    const assertion = await (options.signal
      ? passkey.get(challenge, rpId, undefined, { signal: options.signal })
      : passkey.get(challenge, rpId));
    const session = await this.auth.loginFinish({ challengeId: begin.challengeId, assertion });
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
      this.transport.nodes.map((url) => {
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
  private async begin<T>(result: Promise<unknown>, origin: string | undefined): Promise<T> {
    try {
      return await this.as<T>(result);
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
    return this.transport.refresh();
  }

  /**
   * End this session. The client is signed out whether or not the node
   * answers: the revoke (`POST /auth/logout`) is attempted, and its failure
   * (the node unreachable, say) is thrown after the session is dropped, so a
   * caller can say the server may still hold it, but no request after this
   * one carries its token.
   */
  async signOut(): Promise<void> {
    await this.signingOut(this.auth.logout());
  }

  /**
   * End every session of the signed-in account, on every device, this one
   * too. Like {@link signOut}, this client is signed out even when the
   * request fails, and the failure is thrown.
   */
  async signOutEverywhere(): Promise<void> {
    await this.signingOut(this.auth.logoutAll());
  }

  private async signingOut(result: Promise<unknown>): Promise<void> {
    try {
      await result;
    } finally {
      this.transport.signOut();
    }
  }

  /**
   * Add another passkey (another device, `passkey`) to the signed-in account;
   * answers its credential id. The node asks for the approval of a passkey
   * the account already has (`412 CONFIRM_REQUIRED`, never the new one),
   * which `approver` gives.
   */
  async addPasskey(passkey: PasskeyProvider, approver: PasskeyProvider): Promise<string> {
    const begin = await this.as<{ challengeId: string; options: Record<string, unknown> }>(this.auth.passkeyAddBegin());
    const registration = await passkey.create(begin.options);
    const { credentialId } = await this.auth.passkeyAddFinish({ challengeId: begin.challengeId, registration }, this.confirmWith(approver));
    return credentialId;
  }

  // ---------------------------------------------------------------- account recovery
  //
  // core #4844 (`docs/specs/account-recovery.md`): a recovery code, made with
  // a passkey and shown once, lets someone who lost every passkey register a
  // new one; it is added, and the account signed in, 72 hours later unless a
  // passkey the account still has cancels it first.

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
      const begin = await this.as<{ challengeId: string; options: Record<string, unknown> }>(this.auth.accountRecoveryBegin({ code }));
      const registration = await passkey.create(begin.options);
      return await this.auth.accountRecoveryStart({ challengeId: begin.challengeId, code, registration });
    } catch (error) {
      if (error instanceof LoginRequired) throw new WrongRecoveryCode(error.message.replace(/^401 UNAUTHENTICATED: /, ''), error.details);
      throw error;
    }
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
    const session = await this.auth.accountRecoveryFinish({ ...accountId ? { accountId } : {} }, this.confirmWith(passkey));
    this.useSession(session);
    return session;
  }

  // ---------------------------------------------------------------- apps

  /** One of `app`'s blobs, by id (base58 or hex). */
  async downloadBlob(app: string, id: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.apps.blobDownload({ app, id })).arrayBuffer());
  }

  /**
   * Download a component app's blob with a grant one of its runs handed out
   * (`BlobRef::grant`, up to 24 h). No session needed: the grant is the
   * permission. A bad or expired grant answers `NotFound`, as a missing blob.
   */
  async downloadBlobGranted(app: string, id: string, grant: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.apps.blobDownload({ app, id, grant })).arrayBuffer());
  }

  // ---------------------------------------------------------------- packages

  // ---------------------------------------------------------------- app instances

  /** Committed events from index `from`, then live, until `signal` aborts. */
  events(app: string, from = 0, signal?: AbortSignal): AsyncGenerator<CloudEvent> {
    return this.transport.events(routePath('apps/{app}/events', { app }), { query: { from }, signal });
  }

  // ---------------------------------------------------------------- presence

  /**
   * Presence as a stream until `signal` aborts: a `snapshot` event (`data` the
   * entries present), then a `presence` event (`data` one entry) per change.
   */
  presenceStream(app: string, signal?: AbortSignal): AsyncGenerator<CloudEvent> {
    return this.transport.events(routePath('apps/{app}/presence/stream', { app }), { signal });
  }

  // ---------------------------------------------------------------- aliases

  // ---------------------------------------------------------------- organizations

  /**
   * Start handing `org` to the signed-in account with the recovery seed,
   * which signs here and never leaves this process. Finish with
   * {@link finishRecovery} once `readyAt` has passed; until then the owner may
   * cancel. A wrong seed (or no organization, or none set) is a `403`.
   */
  async startRecovery(org: string, seed: Uint8Array): Promise<RecoveryTimes> {
    const account = (await this.auth.me()).accountId as string;
    const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
    const signature = await signRecovery(seed, org, account, nonce);
    return this.orgs.recoveryStart({ org, nonce, signature });
  }

  // ---------------------------------------------------------------- approvals

  /** The report of a scope's apps (`GET /orgs/{org}/apps`, or with `org` `null` the account's own, `GET /auth/apps`), every page, with the apps of all of them in `apps`. */
  async appsReportAll(org: string | null): Promise<AppsReport> {
    const report = (page: PageOptions = {}) =>
      org === null ? this.auth.accountApps(pageParams(page)) : this.orgs.apps({ org, ...pageParams(page) });
    const first = await report();
    const apps: ReportedApp[] = [...first.apps];
    let next = first.next;
    while (next !== null) {
      const page = await report({ after: next });
      apps.push(...page.apps);
      next = page.next;
    }
    return { ...first, apps, next: null };
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
    const [report, rules] = await Promise.all([this.appsReportAll(org), this.public.releasesPublic()]);
    return pendingApprovalsFrom(report, rules);
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
    const started = await this.consent.pageCreate({ body: request });
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
      const result = await this.consent.pageResult({ request: requestId });
      if (result.status !== 'pending') return result;
      if (options.signal?.aborted) return result;
      if (options.expiresAt !== undefined && Date.now() / 1000 >= options.expiresAt) return result;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  // ---------------------------------------------------------------- operator

  // ---------------------------------------------------------------- app teams

  // ---------------------------------------------------------------- package origins

  // ---------------------------------------------------------------- deployers

  // ---------------------------------------------------------------- deployments

}
