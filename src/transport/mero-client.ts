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
 * # What is deliberately NOT unified
 *
 * Reads, admin and events. A relay serves exactly two routes to a caller with
 * no credential — `GET` and `POST /admin-api/contexts/:id/intents` — and a node
 * serves the whole admin API, JSON-RPC queries, `/sse` and `/ws` to a
 * credential it issued. There is no relay counterpart to adapt.
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
import type { ExecuteTransport, TransportKind } from './types.js';
import type { AdminApiClient } from '../admin-api/index.js';
import type { AuthApiClient } from '../auth-api/index.js';
import type { SseClient } from '../events/sse.js';
import type { WsClient } from '../events/ws.js';
import type { EphemeralClient } from '../ephemeral/index.js';
import type { CloudClient } from '../cloud/cloud-client.js';

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

  constructor(config: MeroClientConfig) {
    if (config.transport === 'relay') {
      this.transport = 'relay';
      this.nodeClient = null;
      const relay =
        config.relay instanceof RelayClient ? config.relay : new RelayClient(config.relay);
      this.rpcTransport = new RelayTransport(relay);
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
   * Whether this client can observe events at all.
   *
   * `false` on the relay transport. An app that needs to see other people's
   * writes has to hold a node connection for that; see the module note on why
   * this does not fall back to one.
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

  /** Admin API. Node transport only — a relay serves no admin surface to a keyholder. */
  get admin(): AdminApiClient {
    return this.node.admin;
  }

  /** Auth API. Node transport only — a relay issues no node credential. */
  get auth(): AuthApiClient {
    return this.node.auth;
  }

  /**
   * SSE events. Node transport only.
   *
   * This is the parity gap, stated plainly rather than papered over: a relay
   * exposes no event stream and no credential with which to ask for one, so a
   * relay-transport app can write and cannot observe.
   */
  get events(): SseClient {
    if (!this.nodeClient) {
      throw relayHasNo(
        'event stream',
        'a relay serves only the intents routes — it has no /sse, no /ws, and issues no credential for either',
      );
    }
    return this.nodeClient.events;
  }

  /** WebSocket events. Node transport only. @experimental — prefer `events`. */
  get ws(): WsClient {
    if (!this.nodeClient) {
      throw relayHasNo(
        'event stream',
        'a relay serves only the intents routes — it has no /sse, no /ws, and issues no credential for either',
      );
    }
    return this.nodeClient.ws;
  }

  /** Ephemeral presence. Node transport only — it reads over SSE and writes over JSON-RPC. */
  get ephemeral(): EphemeralClient {
    if (!this.nodeClient) {
      throw relayHasNo(
        'ephemeral presence',
        'publishing resolves the author from an owned context identity on the node, and reading is a filter over the node event stream',
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
 * const client = createMeroClient({ transport: 'relay', relay: connection.relay });
 *
 * await client.rpc.execute({ contextId, method: 'set', argsJson: { key, value } });
 * ```
 */
export function createMeroClient(config: MeroClientConfig): MeroClient {
  return new MeroClient(config);
}
