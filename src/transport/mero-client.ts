/**
 * One client, two transports — chosen once, at construction.
 *
 * # The problem this exists for
 *
 * An app that wants to move from "the user has a node" to "the user has a key
 * and a relay" had to rewrite itself, because the two write paths are different
 * objects with different method shapes. That makes the transport a property of
 * the *application source*, when it is really a property of the connection: the
 * same screen, the same hook, the same `execute` call wants to work either way.
 *
 * `createMeroClient` takes the decision at construction and nowhere else. After
 * that, `client.rpc.execute({ contextId, method, argsJson })` is the same call
 * against a node and against a relay — same arguments, same return type. The
 * node shape is the one both speak, because shipped apps already write it and
 * the alternative would be a breaking change wearing an abstraction's clothes.
 *
 * # Defaulting to the node is a compatibility guarantee
 *
 * `createMeroClient({ baseUrl })` is `createMeroJs({ baseUrl })` with a facade
 * in front. No `transport` field means `'node'`, so nothing an existing app
 * does can accidentally select the relay.
 *
 * # Events work on both transports, given one input
 *
 * A relay is an ordinary node, so it serves `/sse` and `/ws` to a credential it
 * issued, and a keyholder can obtain one by logging in with its account proof.
 * `client.events` and `client.ws` are therefore the same call on both
 * transports — provided the caller supplies the relay node's device signing
 * key, which must be learned out of band and is the one thing that cannot be
 * inferred. See `./relay-observer.ts` for why, and mdma #312 for the hosted
 * case. Without it, {@link MeroClient.canSubscribe} is `false` and the
 * accessors throw naming exactly that.
 *
 * # What is deliberately NOT unified
 *
 * Reads and admin. A relay serves exactly two routes to a caller with no
 * credential — `GET` and `POST /admin-api/contexts/:id/intents` — and while a
 * session obtained by logging in carries `context:query`, `sdk.admin` wants
 * `admin`, which the `account_proof` provider does not grant and a keyholder
 * should never ask for.
 *
 * So those accessors throw on a relay client, with a message naming what is
 * missing, rather than returning something that quietly connects somewhere
 * else. Falling back to "some node" would be the worst of the options: the app
 * would observe a node it never chose, under a credential it never granted, and
 * find out only when the two disagreed. `canSubscribe` and `transport` are
 * there so an app can branch *before* touching any of it.
 */

import { MeroJs } from '../mero-js.js';
import type { MeroJsConfig } from '../mero-js.js';
import { RelayClient } from '../relay/relay-client.js';
import type { RelayClientConfig } from '../relay/relay-client.js';
import { RelayTransport } from './relay-transport.js';
import { RelayObserver, defaultAudience } from './relay-observer.js';
import type { RelayObserveConfig } from './relay-observer.js';
import type { ExecuteTransport, TransportKind } from './types.js';
import type { AdminApiClient } from '../admin-api/index.js';
import type { AuthApiClient } from '../auth-api/index.js';
import type { SseClient } from '../events/sse.js';
import type { WsClient } from '../events/ws.js';
import type { EphemeralClient } from '../ephemeral/index.js';
import type { CloudClient } from '../cloud/cloud-client.js';
import type { Signer } from '../signer/signer.js';

/** The node transport: everything `createMeroJs` takes, plus an explicit opt-in. */
export interface NodeTransportConfig extends MeroJsConfig {
  /**
   * Optional, and the default. Spelled out so a config object can be built
   * generically without the node case looking like an omission.
   */
  transport?: 'node';
}

/** The relay transport: delegated execution, no node and no node credential. */
export interface RelayTransportConfig {
  transport: 'relay';
  /**
   * The relay to write through — a configured {@link RelayClient}, or the
   * config to build one from.
   *
   * An already-built client is accepted because the useful ones are not built
   * by hand: `connectCloud` discovers the relay URL and executor account from a
   * cloud sign-in and hands back a ready client. Requiring the config here
   * would have that caller take the client apart to put it back together.
   */
  relay: RelayClient | RelayClientConfig;
  /**
   * How this client observes the relay node, if it can.
   *
   * Omit it — or pass it with no `nodeKey` — and the client writes but does not
   * observe: `canSubscribe` is `false` and `events`/`ws` throw naming the
   * missing key. Supply `{ nodeKey }` and `client.events` is the very same
   * `SseClient` a node client hands out.
   *
   * The shape takes a nullable key on purpose, so the hosted path is one code
   * path rather than two: `connectCloud` always passes this object, with
   * whatever key the cloud reported, and starts working the day mdma #312
   * publishes one. Nothing here ever fills the key in.
   */
  observe?: RelayObserveConfig;
}

export type MeroClientConfig = NodeTransportConfig | RelayTransportConfig;

/** Message shared by every node-only accessor, so the reason is stated once. */
function relayHasNo(surface: string, why: string): Error {
  return new Error(
    `this client was constructed with the relay transport, which has no ${surface}: ${why}. ` +
      'Construct a node client (createMeroClient({ baseUrl })) for that surface — ' +
      'nothing here will silently connect to a node you did not choose.',
  );
}

/**
 * The one thing a relay client can be missing, named precisely.
 *
 * Deliberately not the same message as {@link relayHasNo}: this is not "the
 * relay transport has no such surface". The relay has the surface — it serves
 * `/sse` and `/ws`, and the `account_proof` provider grants
 * `context:subscribe`. What is missing is a single 32-byte value, and a caller
 * who can obtain it needs to be told that, not told to go and build a node
 * client.
 */
function missingNodeKey(surface: string): Error {
  return new Error(
    `this relay-transport client cannot open ${surface}: it was given no relay node key. ` +
      'A relay is an ordinary node and does serve /sse and /ws — but the login statement must be ' +
      "signed against the node's device signing key, learned out of band (never read from the node, " +
      'and never derived from its peerId). Pass it as `observe: { nodeKey }`. ' +
      'For a cloud-hosted relay the cloud does not publish it yet — see mdma #312.',
  );
}

/**
 * Resolve an observe config against the relay client that will do the writing.
 *
 * Returns `null` for "no key, so no observation" — the single place that
 * decision is made, so `canSubscribe`, `events` and `ws` cannot disagree about
 * it. The signer and proof default to the relay's own: the same device that
 * authors is the device that observes, and taking a second copy from the caller
 * is how the two come to name different keys.
 */
function buildObserver(relay: RelayClient, observe?: RelayObserveConfig): RelayObserver | null {
  const nodeKey = observe?.nodeKey;
  if (!nodeKey) return null;
  return new RelayObserver({
    nodeUrl: observe?.nodeUrl ?? relay.relayUrl,
    nodeKey,
    accountProof: observe?.accountProof ?? relay.authorProof,
    audience: observe?.audience ?? defaultAudience(),
    signer: observe?.signer ? async () => observe.signer as Signer : () => relay.authorSigner(),
    clientName: observe?.clientName,
    ttlSeconds: observe?.ttlSeconds,
    fetch: observe?.fetch,
    timeoutMs: observe?.timeoutMs,
  });
}

/**
 * A connection whose transport was decided at construction.
 *
 * Everything reachable on a node client is reachable in exactly the shape
 * `MeroJs` exposes it, by delegation rather than re-implementation — this adds
 * no behaviour to the node path and cannot drift from it.
 */
export class MeroClient {
  /** Which path writes take. Set once, never changes. */
  readonly transport: TransportKind;

  private readonly nodeClient: MeroJs | null;
  private readonly rpcTransport: ExecuteTransport;
  /** The relay's event session, or `null` on a node client / with no node key. */
  private readonly relayObserver: RelayObserver | null = null;

  constructor(config: MeroClientConfig) {
    if (config.transport === 'relay') {
      this.transport = 'relay';
      this.nodeClient = null;
      const relay =
        config.relay instanceof RelayClient ? config.relay : new RelayClient(config.relay);
      this.relayObserver = buildObserver(relay, config.observe);
      this.rpcTransport = new RelayTransport(relay, this.relayObserver);
      return;
    }

    this.transport = 'node';
    // `transport` is a marker this class reads and `MeroJs` has never seen.
    // Stripped rather than passed through, so nothing downstream has to know
    // that the field exists.
    const { transport: _ignored, ...nodeConfig } = config;
    this.nodeClient = new MeroJs(nodeConfig);
    this.rpcTransport = this.nodeClient.rpc;
  }

  /**
   * The write surface. Identical on both transports — this is the whole point.
   *
   * On a node this IS the `RpcClient` a `MeroJs` would have handed out, not a
   * wrapper around it, so `client.rpc` and `client.node.rpc` are the same
   * object.
   */
  get rpc(): ExecuteTransport {
    return this.rpcTransport;
  }

  /**
   * Whether `events` / `ws` will work on this client.
   *
   * Always `true` on the node transport. On the relay transport it says whether
   * a node key was supplied — the relay can be observed, but only by a caller
   * who can name the key the login statement is signed against.
   */
  get canSubscribe(): boolean {
    return this.rpcTransport.canSubscribe;
  }

  /** The underlying `MeroJs`. Node transport only. */
  get node(): MeroJs {
    if (!this.nodeClient) {
      throw relayHasNo('node connection', 'it holds a signing key and a relay URL, not a node');
    }
    return this.nodeClient;
  }

  /** The underlying `RelayClient`, for `describe()`. Relay transport only. */
  get relay(): RelayClient {
    if (!(this.rpcTransport instanceof RelayTransport)) {
      throw new Error('this client was constructed with the node transport and has no relay');
    }
    return this.rpcTransport.client;
  }

  /**
   * Admin API. Node transport only.
   *
   * Two different things live behind this accessor today, and only one of them
   * is genuinely unavailable through a relay.
   *
   * The **mutations** — `createNamespace`, `setMemberCapabilities`,
   * `upgradeGroup` and the rest — are operator actions on somebody else's
   * machine. A keyholder does not get those, and should not; admin is for
   * admins.
   *
   * The **reads** are a different matter. `getContext`, `getContexts`,
   * `getApplication`, `listNamespaces`, `getBlob` are an app asking what it is
   * looking at, not an operator administering anything. They sit under
   * `/admin-api/` for historical reasons, and a delegated session is refused
   * them (measured: `403`, while the same session reads context state through
   * `POST /contexts/{ctx}/query` and writes through `/intents` quite happily).
   *
   * So this is the one place where "the same code runs on both transports"
   * does not hold yet, and it is a missing surface rather than a missing
   * permission. A transport-independent read API is designed but not built; the
   * throw below is deliberate until it exists, because the alternative — quietly
   * reaching for a node the caller did not choose — is worse than a clear stop.
   */
  get admin(): AdminApiClient {
    if (!this.nodeClient) {
      throw new Error(
        'this client was constructed with the relay transport, which serves no admin ' +
          'surface to a keyholder. Mutations (createNamespace, setMemberCapabilities, …) ' +
          'are operator actions and will never be available here. The READS ' +
          '(getContext, getContexts, getApplication, listNamespaces, getBlob) are not ' +
          'admin operations and should be — they are pending a transport-independent ' +
          'read API. Until then: context STATE reads work via execute/query on this ' +
          'client, and events work once a relay node key is supplied.',
      );
    }
    return this.nodeClient.admin;
  }

  /** Auth API. Node transport only — a relay issues no node credential. */
  get auth(): AuthApiClient {
    return this.node.auth;
  }

  /**
   * SSE events — on **both** transports.
   *
   * On a relay client this is an `SseClient` against the relay node, fed by a
   * session minted with the author's account proof. The session is minted
   * lazily, on the first token the stream asks for, so reading this getter
   * performs no network call.
   *
   * Throws only when the relay client was given no node key: the one input
   * that cannot be inferred. See {@link missingNodeKey}.
   */
  get events(): SseClient {
    if (this.nodeClient) return this.nodeClient.events;
    if (this.relayObserver) return this.relayObserver.events;
    throw missingNodeKey('SSE events');
  }

  /** WebSocket events, on both transports. @experimental — prefer `events`. */
  get ws(): WsClient {
    if (this.nodeClient) return this.nodeClient.ws;
    if (this.relayObserver) return this.relayObserver.ws;
    throw missingNodeKey('WebSocket events');
  }

  /**
   * Ephemeral presence. Node transport only.
   *
   * Not extended to the relay even though a logged-in session could reach both
   * halves of it mechanically. Publishing resolves the author from an *owned
   * context identity on the node*, and whether a delegated session has one has
   * not been established — a presence client that silently published nothing,
   * or published as the wrong identity, is worse than one that says it is not
   * available. The read half is not lost: presence arrives on `client.events`
   * like any other context event, and can be filtered there.
   *
   * The rejected alternative was to expose it over the relay session and let
   * `set` fail at the node. That trades a clear construction-time answer for a
   * runtime failure inside a UI that has already rendered.
   */
  get ephemeral(): EphemeralClient {
    if (!this.nodeClient) {
      throw relayHasNo(
        'ephemeral presence',
        'publishing resolves the author from an owned context identity on the node, which a delegated session is not known to have — read presence off `client.events` instead',
      );
    }
    return this.nodeClient.ephemeral;
  }

  /**
   * Calimero Cloud.
   *
   * Available on both transports, because it is neither: the cloud session is
   * independent of the node credential and of the relay's signing key, and a
   * relay-transport app still needs it to list namespaces and manage billing.
   */
  get cloud(): CloudClient {
    if (!this.nodeClient) {
      throw relayHasNo(
        'bundled cloud client',
        'a relay client is built from a cloud connection rather than owning one — reach it through the `cloud` field that `connectCloud` returns, or construct a `CloudClient` directly',
      );
    }
    return this.nodeClient.cloud;
  }

  /**
   * Release whatever the transport is holding.
   *
   * Safe on a relay client, where there is nothing open to close — a caller
   * that tears down on unmount should not have to know which transport it got.
   */
  close(): void {
    this.nodeClient?.close();
    // The observer, not the relay: a relay client holds nothing open. Tearing
    // down on unmount must not have to know which transport it got.
    this.relayObserver?.close();
  }
}

/**
 * Build a client for the chosen transport. Node unless told otherwise.
 *
 * ```ts
 * // unchanged, and still the default
 * const client = createMeroClient({ baseUrl: 'http://localhost:2428' });
 *
 * // the same call sites, through a relay
 * const client = createMeroClient({
 *   transport: 'relay',
 *   relay: connection.relay,
 *   // the relay node's signing key, learned out of band — without it the
 *   // client writes but does not observe
 *   observe: { nodeKey },
 * });
 *
 * await client.rpc.execute({ contextId, method: 'set', argsJson: { key, value } });
 * if (client.canSubscribe) client.events.on('event', onEvent);
 * ```
 */
export function createMeroClient(config: MeroClientConfig): MeroClient {
  return new MeroClient(config);
}
