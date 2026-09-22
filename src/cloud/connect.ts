/**
 * The second way to log in: sign in to Calimero Cloud instead of connecting to
 * a node.
 *
 * # Two connection shapes, one SDK
 *
 * `createMeroJs({ baseUrl })` is the node connection: point at a node, hold a
 * credential on it, and drive its admin API and JSON-RPC. It assumes the caller
 * has a node — their own, or one they have an account on.
 *
 * `connectCloud(...)` is for the caller who has neither. They sign in with the
 * identity they already use (Google, through the cloud), and the cloud answers
 * with an attested TEE relay serving their namespace. Writes then go through
 * delegated execution: signed here, run there, attributed here.
 *
 * The two are not alternatives to be picked at random — they answer different
 * questions. "Which node do I talk to?" has an answer for a desktop app and no
 * answer at all for a web app whose user has never installed anything. This
 * function is that missing answer, which is why the login step it replaces is
 * the *node URL prompt* rather than the authentication.
 *
 * `connectCloudWithAccount(...)` is the same connection reached by the other
 * door: the caller holds an account root and signs in as the account itself,
 * with no Google login anywhere in it. Identical from there on, deliberately —
 * which login proved who you are changes nothing about how a relay is found or
 * how a write is authorised.
 *
 * # What it does not do
 *
 * It does not read state. A relay writes on the author's behalf; reads still
 * come from a node the client can query, or from the app's own projection of
 * the events it receives. `connectCloud` is deliberately narrow about this
 * rather than presenting a half-working `MeroJs` whose `admin` and `rpc` would
 * need a credential nobody holds.
 */

import { CloudClient } from './cloud-client.js';
import type { CloudClientConfig, CloudNamespace, CloudRelay } from './cloud-client.js';
import { RelayClient } from '../relay/relay-client.js';
import type { IntentResult, NonceSource } from '../relay/index.js';
import { createLocalStorageNonceSource, createMemoryNonceSource } from '../relay/nonce-source.js';
import { resolveSigner, type Signer } from '../signer/signer.js';
import { resolveRoot, type RootSource } from '../account/account.js';

export interface ConnectCloudOptions {
  /** Defaults to the hosted cloud. */
  cloudBaseUrl?: string;
  /** A stored MDMA session token. Provide this or `googleIdToken`. */
  sessionToken?: string;
  /** A Google ID token to exchange for a session. Provide this or `sessionToken`. */
  googleIdToken?: string;
  /** Persist a new or rolling-refreshed session. See {@link CloudClientConfig.onSession}. */
  onSession?: CloudClientConfig['onSession'];

  /** The author's account, hex — whose writes these will be. */
  authorAccount: string;
  /** The author's `AccountProof<DeviceCert>`, hex-encoded borsh. */
  authorProof: string;
  /**
   * The author device's ed25519 signing secret, hex. Never transmitted.
   *
   * Mutually exclusive with {@link ConnectCloudOptions.signer}, and the weaker
   * of the two in a browser — a secret that exists as a string can be read by
   * anything on the origin.
   */
  deviceSecret?: string;
  /**
   * The author device's signer — use instead of
   * {@link ConnectCloudOptions.deviceSecret}.
   *
   * A browser wallet holds its device key as a non-extractable `CryptoKey`,
   * which has no hex form to pass. Without this, that wallet — the case this
   * whole path was built for — had to hand-assemble the `RelayClient` the
   * one-call path exists to build.
   */
  signer?: Signer;

  /**
   * Which namespace to write in.
   *
   * Optional only when the user owns exactly one: guessing among several would
   * pick a tenant for them, and the failure would be a write landing in the
   * wrong place rather than an error.
   */
  namespaceId?: string;

  /**
   * Where nonces come from.
   *
   * Defaults to `localStorage`, keyed by the author's device public key, so a
   * reload continues the sequence instead of replaying it. Pass
   * {@link createMemoryNonceSource} explicitly for a process that owns its
   * whole sequence, or your own source to coordinate across tabs.
   */
  nonces?: NonceSource;
  /** Seconds a minted warrant stays presentable. Defaults to 300. */
  ttlSeconds?: number;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** A signed-in cloud session with a relay ready to write through. */
export interface CloudConnection {
  /** The cloud API, for namespaces, billing, HA and sign-out. */
  cloud: CloudClient;
  /** The relay chosen for this namespace. */
  relay: RelayClient;
  /** The namespace writes will land in. */
  namespaceId: string;
  namespace: CloudNamespace;
  /** What the cloud reported about the chosen relay. */
  relayInfo: CloudRelay;
  /** Run one method in one context, on the author's behalf. */
  execute<T = unknown>(
    contextId: string,
    method: string,
    argsJson?: unknown,
  ): Promise<IntentResult<T>>;
}

/**
 * Sign in to the cloud and return a connection that can write.
 *
 * Throws rather than returning a half-usable connection, and the message says
 * which step is missing — no namespace, several to choose between, HA not
 * enabled, or no relay holding the authorship grant. Every one of those is
 * something the user has to go and do, and a client that reports them alike
 * cannot tell them what.
 */
export async function connectCloud(options: ConnectCloudOptions): Promise<CloudConnection> {
  if (!options.sessionToken && !options.googleIdToken) {
    throw new Error('connectCloud needs either a sessionToken or a googleIdToken');
  }

  // Resolved before the first network call: a missing or duplicated key is the
  // caller's mistake to fix, and finding out after signing in leaves a session
  // minted for a connection that was never going to be built.
  const signer = await resolveSigner(options.deviceSecret, options.signer, 'deviceSecret');

  const cloud = new CloudClient({
    cloudBaseUrl: options.cloudBaseUrl,
    sessionToken: options.sessionToken,
    onSession: options.onSession,
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
  });

  if (!options.sessionToken && options.googleIdToken) {
    await cloud.signInWithGoogle(options.googleIdToken);
  }

  const namespaces = await cloud.getMyNamespaces();
  const namespace = pickNamespace(namespaces, options.namespaceId);

  // One read, used for both the choice and the diagnostic. `findExecutingRelay`
  // would fetch again to explain itself, and a second call can disagree with the
  // first — reporting "waiting for the grant" about a relay that was already
  // usable a moment ago.
  const relays = await cloud.getNamespaceRelays(namespace.namespaceId);
  const relayInfo =
    relays.find((r) => r.authorshipReady && r.relayUrl !== null && r.executorAccount !== null) ??
    null;
  if (!relayInfo) {
    throw new Error(explainNoRelay(namespace, relays));
  }

  const relay = new RelayClient({
    // Checked by `findExecutingRelay`, which is the only thing that returns a
    // relay — narrowed here rather than re-validated, so the invariant lives in
    // one place.
    relayUrl: relayInfo.relayUrl as string,
    executorAccount: relayInfo.executorAccount as string,
    authorAccount: options.authorAccount,
    authorProof: options.authorProof,
    signer,
    nonces: options.nonces ?? defaultNonceSource(signer.publicKey),
    ttlSeconds: options.ttlSeconds,
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
  });

  return {
    cloud,
    relay,
    namespaceId: namespace.namespaceId,
    namespace,
    relayInfo,
    execute: (contextId, method, argsJson) => relay.execute(contextId, method, argsJson),
  };
}

/** What {@link connectCloudWithAccount} needs on top of a root. */
export interface ConnectCloudWithAccountOptions
  extends Omit<ConnectCloudOptions, 'sessionToken' | 'googleIdToken' | 'authorAccount'> {
  /**
   * The account root — a 64-hex secret, or a `Signer` over a key that cannot be
   * exported. The whole credential: no Google login is involved.
   */
  root: RootSource;
  /**
   * Whose writes these are, hex. Defaults to the account the root derives,
   * which is the only account it can open a session as.
   *
   * Worth passing only when the device certificate was issued by a *different*
   * root than the one signing in — which core accepts and nothing here needs to
   * forbid, but which is rare enough that defaulting to the signing root is the
   * safer shape.
   */
  authorAccount?: string;
}

/**
 * The same connection, opened with an account root instead of a cloud session.
 *
 * The two sign-in paths end in the same place, and until now only one of them
 * ended in a usable client: a caller signing in with a root had to open the
 * session, read the relays and assemble a {@link RelayClient} by hand, which is
 * three chances to pair the wrong author with the wrong executor.
 *
 * It is one call rather than one function: the session is minted here and
 * everything after it is {@link connectCloud}, unchanged. Duplicating the
 * namespace choice and the three no-relay diagnostics would mean two copies of
 * the messages that tell a user what to go and do.
 *
 * The author defaults to the account the root derives. That is not a
 * convenience — passing an account the root does not own is the mistake this
 * shape removes, since the cloud would answer with that root's namespaces while
 * every warrant claimed somebody else's authorship.
 */
export async function connectCloudWithAccount(
  options: ConnectCloudWithAccountOptions,
): Promise<CloudConnection> {
  const { root, authorAccount, ...rest } = options;
  // Both keys resolved before the sign-in, for the reason `connectCloud` gives:
  // a session minted for a connection that cannot be built is a credential
  // issued for nothing.
  const signer = await resolveSigner(rest.deviceSecret, rest.signer, 'deviceSecret');
  const resolved = await resolveRoot(root);

  const cloud = new CloudClient({
    cloudBaseUrl: options.cloudBaseUrl,
    // Reported here as well as on the connection's own client: this is where
    // the session is first minted, and a caller persisting it would otherwise
    // only hear about the rolling refreshes of a token it never saw.
    onSession: options.onSession,
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
  });
  const session = await cloud.signInWithAccount(resolved.signer);

  return connectCloud({
    ...rest,
    // Already resolved above, and passing both forms on would be refused.
    deviceSecret: undefined,
    signer,
    sessionToken: session.sessionToken,
    authorAccount: authorAccount ?? resolved.accountId,
  });
}

/** The one namespace to write in, or an error naming the actual ambiguity. */
function pickNamespace(namespaces: CloudNamespace[], requested?: string): CloudNamespace {
  if (requested) {
    const found = namespaces.find((n) => n.namespaceId === requested);
    if (!found) {
      throw new Error(
        `this account owns no namespace ${requested}; it owns: ${
          namespaces.map((n) => n.namespaceId).join(', ') || '(none)'
        }`,
      );
    }
    return found;
  }
  if (namespaces.length === 0) {
    throw new Error(
      'this account owns no namespaces in the cloud: claim one first, then enable HA on it so a relay is assigned',
    );
  }
  if (namespaces.length > 1) {
    throw new Error(
      `this account owns ${namespaces.length} namespaces — pass namespaceId to say which: ${namespaces
        .map((n) => n.namespaceId)
        .join(', ')}`,
    );
  }
  return namespaces[0];
}

/**
 * Why no relay can write here — the three states, kept apart.
 *
 * They are three different asks of the user (turn HA on, wait, or get an admin
 * to grant a capability) and one message for all of them would send them to
 * the wrong one.
 */
function explainNoRelay(namespace: CloudNamespace, relays: CloudRelay[]): string {
  if (relays.length === 0) {
    return namespace.haStatus === 'enabled'
      ? `namespace ${namespace.namespaceId} has HA enabled but no relay has been assigned to it yet — retry shortly`
      : `namespace ${namespace.namespaceId} has no relays: enable HA on it in the cloud to have an attested node assigned`;
  }
  const waitingOnGrant = relays.filter((r) => !r.authorshipReady);
  if (waitingOnGrant.length === relays.length) {
    // Name the call, not just the capability. The grant is a governance op only
    // a namespace admin can publish, so this message is read by someone who has
    // to go ask for it — and "grant CAN_AUTHOR_ON_BEHALF" alone leaves them
    // relaying a constant to an admin who then has to work out the command.
    // `openToDelegatedExecution` is the durable half (every relay assigned from
    // then on lands open), `grantAuthorship` the one for relays already here.
    return (
      `every relay on namespace ${namespace.namespaceId} is waiting for the authorship grant: ` +
      `an admin of the namespace must grant CAN_AUTHOR_ON_BEHALF to ${
        waitingOnGrant.map((r) => r.executorAccount ?? r.peerId).join(', ') || 'the relay account'
      } — with AdminClient.grantAuthorship(namespaceId, account) for these relays, and ` +
      `AdminClient.openToDelegatedExecution(namespaceId) so relays assigned later need no further op`
    );
  }
  return `namespace ${namespace.namespaceId} has ${relays.length} relay(s), but none reported both a URL and an executor account yet — retry shortly`;
}

/**
 * A persisted nonce source keyed by the author's device public key.
 *
 * The key is the *public* key: a per-device key is required (two devices of one
 * account are independent replicas) and the secret must never end up in a
 * storage key an extension or another script can enumerate. The signer names
 * its own public key, which is also the only form available when the private
 * half cannot be exported.
 *
 * Falls back to memory where there is no `localStorage` — Node, a worker, an
 * edge runtime. Those are processes that own their whole sequence, which is
 * exactly the case a memory counter is correct for.
 */
function defaultNonceSource(devicePublicKey: string): NonceSource {
  const key = `mero-js:warrant-nonce:${devicePublicKey}`;
  try {
    return createLocalStorageNonceSource(key);
  } catch {
    return createMemoryNonceSource(1);
  }
}
