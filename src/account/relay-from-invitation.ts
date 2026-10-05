/**
 * Resolving a relay from an INVITATION rather than from an account.
 *
 * # The gap this closes
 *
 * `ConnectButtonAccount` finds a relay by asking the cloud what serves the
 * *account* (`CloudClient.getAccountRelays`). A freshly enrolled account is a
 * member of nothing, so that read correctly answers `[]` and the button
 * correctly refuses to connect: there is nowhere to write, and a typed guess
 * would be a node that refuses every warrant.
 *
 * But a newcomer is not stuck — they are holding an invitation, and an
 * invitation names a namespace. `CloudClient.getNamespaceRouting` answers which
 * nodes serve *that namespace*, and it is deliberately anonymous: a joiner has
 * no cloud session, and needing one is exactly what this path exists to avoid.
 * So the bootstrap order is namespace first, account second — admission is what
 * makes `getAccountRelays` answer at all, not the other way round.
 *
 * # Two sources, one intersection, and why it must not be skipped
 *
 * The invitation's `admitters` list sits INSIDE the body the group admin
 * signed, so it is authorization: merod answers `403` to an `/admit` from a node
 * that list does not name, whatever else is true of it. The cloud's list is
 * every node currently assigned to the namespace — it cannot know which
 * invitation the caller holds, so it cannot filter by the signed list, and a
 * node assigned *after* the invitation was minted looks perfect in every field
 * the cloud reports and still refuses the claim.
 *
 * Intersecting here is therefore not belt-and-braces: it is the check that
 * turns an unexplainable `403` into "your invitation names none of these nodes,
 * ask for a fresh one". It is never relaxed to make a flow work.
 *
 * # `servable` and `canAdmit` are advisory; `writable` is information
 *
 * `servable` and `canAdmit` are derived from assignment heartbeats, and a lapsed
 * heartbeat is not the same fact as a node that will refuse. Measured against
 * prod: the cloud reported `servable: false, canAdmit: false, fresh: false` for a
 * node whose `/admin-api/health` answered `{"status":"alive"}` and which had just
 * minted the invitation being claimed. Gating on them meant refusing to knock on
 * an open door, so a node with an address is tried and the NODE decides —
 * `admit_join` re-verifies the invitation, the signature and the admitters list,
 * so asking loosens nothing and a refusal names its own cause. `stale` on the
 * result says the attempt rests on advisory data.
 *
 * `writable` — and its per-node form, `canExecute` — is about `CAN_AUTHOR_ON_BEHALF`,
 * which admission does **not** require: relaying a join the joiner signed is not
 * authoring on anyone's behalf. So a non-writable namespace is not a refusal
 * here; it is reported on the result, because it is precisely why the writes
 * would fail *after* connecting, and a caller that cannot tell the two apart
 * sends the user to the wrong place.
 */

import {
  CloudClient,
  type CloudNamespaceNode,
} from '../cloud/index.js';

/**
 * Which step could not be completed. Each one needs a different action from the
 * person, which is why this is an enum and not a message.
 *
 * - `admitters-lookup` — the cloud read itself failed (offline, 5xx, a refused
 *   routing proof). Nothing has been learned about the namespace.
 * - `no-nodes` — the read succeeded and the cloud lists nothing, and the
 *   invitation carries no http(s) address of an admitter either. The namespace
 *   has no fleet assignment, so there is no cloud node to admit through; the
 *   invitation's admitters are somebody's self-hosted or desktop node, which the
 *   cloud neither knows nor routes to.
 * - `not-invited` — nodes serve the namespace, and the invitation names none of
 *   them. Terminal for this invitation: ask for a fresh one.
 * - `invited-unreachable` — a named node exists but cannot take a join now (no
 *   fresh heartbeat, or the cloud reports the namespace as not servable). A
 *   wait, not a wrong invitation.
 * - `no-relay-url` — a named node can admit but the cloud knows no address for
 *   it, so there is nothing to connect through afterwards. Also a wait: it is
 *   the shape a node reports before its first heartbeat lands.
 */
export type RelayResolutionStep =
  | 'admitters-lookup'
  | 'no-nodes'
  | 'not-invited'
  | 'invited-unreachable'
  | 'no-relay-url';

/** A relay that can take this invitation's join, and connect afterwards. */
export interface ResolvedInvitationRelay {
  readonly ok: true;
  /** The node origin to connect through. */
  readonly relayUrl: string;
  /** Where to POST the signed join — the cloud's own, never rebuilt when given. */
  readonly admitUrl: string;
  /**
   * The admitter's account: as the cloud reported it, or — for a relay the
   * invitation itself named — the one admitter it names, when it names one.
   */
  readonly admitterAccount: string | null;
  /** The node's peer id as the cloud reported it; `null` for a relay the invitation named. */
  readonly peerId: string | null;
  /**
   * Whether this node can also run delegated writes (`CAN_AUTHOR_ON_BEHALF`).
   *
   * `false` is not a failure of admission — see the module note. It means the
   * connection that follows will read and receive events but have its intents
   * refused, which an admin grants away, so it is worth saying out loud.
   */
  readonly writable: boolean;
  /** Whether the chosen node's heartbeat for this namespace has lapsed. */
  readonly stale: boolean;
  /**
   * Who named this relay: the cloud's routing, or the invitation's own
   * `admitter_addrs` when the cloud routed the namespace to no node.
   */
  readonly via: 'cloud' | 'invitation';
}

export interface RelayResolutionFailure {
  readonly ok: false;
  readonly step: RelayResolutionStep;
  /** What to go and do about it, in one sentence. */
  readonly reason: string;
}

export type ResolveRelayResult = ResolvedInvitationRelay | RelayResolutionFailure;

export interface ResolveRelayFromInvitationInput {
  /** The namespace the invitation admits you to, 64 hex. */
  readonly namespaceId: string;
  /**
   * The invitation's signed `admitters` — `invitation.invitation.admitters`.
   *
   * An EMPTY list is the legacy "admission by broadcast" shape, where any ready
   * peer may admit, and is treated as such. Omitting the field and passing an
   * empty array are therefore the same thing on purpose: there is no spelling
   * here that means "nobody may admit", because an invitation cannot say that.
   */
  readonly admitters?: readonly string[];
  /**
   * The invitation's `admitter_addrs`: where its admitters are reached. Core
   * emits libp2p multiaddrs here; an account minting through mero-react adds
   * its relay's http(s) origin. Only the http(s) entries are of use to a
   * browser, and only when the cloud routes the namespace to no node — the
   * case of a namespace whose founder never linked the account, which the
   * cloud does not route yet whose own relay admits.
   */
  readonly admitterAddrs?: readonly string[];
  /** The delegated credential — an `AccountProof<DeviceCert>`, hex. */
  readonly credential: string;
  /** The certified device's ed25519 signing secret, hex. */
  readonly deviceSecret: string;
  /** Point at a cloud other than the hosted manager. For local rigs. */
  readonly cloudBaseUrl?: string;
  /** Injected in tests. Anything with the one method this needs. */
  readonly cloud?: Pick<CloudClient, 'getNamespaceRouting'>;
}

/**
 * Normalise a hex account for comparison: lower-cased, `0x` stripped.
 *
 * Both sides are hex for the same 32 bytes, and a spelling mismatch would
 * present as "your invitation does not name this node" — a refusal that looks
 * like policy and is really formatting.
 */
export function normaliseAccount(account: string | null | undefined): string | null {
  if (!account) return null;
  const trimmed = account.trim().toLowerCase();
  const bare = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
  return bare.length > 0 ? bare : null;
}

/** The http(s) origins among an invitation's admitter addresses, trailing slash dropped. */
function httpAdmitterOrigins(addrs: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const addr of addrs ?? []) {
    try {
      const url = new URL(addr);
      if (url.protocol === 'http:' || url.protocol === 'https:') out.push(addr.replace(/\/+$/, ''));
    } catch {
      // A multiaddr, or nothing a browser can dial.
    }
  }
  return out;
}

/** Whether the invitation's signed list names this node. */
function isInvited(node: CloudNamespaceNode, invited: ReadonlySet<string>): boolean {
  if (invited.size === 0) return true;
  const account = normaliseAccount(node.account);
  return account !== null && invited.has(account);
}

/**
 * Resolve a relay to bootstrap through, from an invitation and nothing else.
 *
 * Reads the cloud's routing for the namespace, intersects it with the
 * invitation's signed `admitters`, and returns the node to use — or which step
 * stopped it and what that means. It performs no admission and mints no keys:
 * the credential passed in is the one the wallet already certified.
 */
export async function resolveRelayFromInvitation(
  input: ResolveRelayFromInvitationInput,
): Promise<ResolveRelayResult> {
  const cloud =
    input.cloud ??
    new CloudClient({
      cloudBaseUrl: input.cloudBaseUrl,
      routingCredential: { credential: input.credential, deviceSecret: input.deviceSecret },
    });

  let nodes: readonly CloudNamespaceNode[];
  let servable: boolean;
  try {
    const routing = await cloud.getNamespaceRouting(input.namespaceId);
    nodes = routing.nodes;
    servable = routing.servable;
  } catch (e) {
    // Named as its own step: nothing has been learned about the namespace, so
    // reporting this as "no nodes serve it" would be a claim the read never
    // made — and would send the user to ask for a new invitation over what is
    // usually a refused proof or a network blip.
    return {
      ok: false,
      step: 'admitters-lookup',
      reason:
        `The cloud could not be asked which nodes serve namespace ${input.namespaceId}: ` +
        `${e instanceof Error ? e.message : String(e)}. Nothing is known about the ` +
        'invitation yet — this is the lookup failing, not the invitation.',
    };
  }

  if (nodes.length === 0) {
    // The cloud routes nothing, but the invitation may say where an admitter
    // is: an account's relay writes its origin into `admitter_addrs` when it
    // mints for a namespace the cloud does not host. The relay's `admit_join`
    // re-verifies the invitation and its admitters, so nothing is loosened by
    // knocking there; the account is the invitation's, when it names one.
    const [relayUrl] = httpAdmitterOrigins(input.admitterAddrs);
    if (relayUrl) {
      const admitters = (input.admitters ?? []).map(normaliseAccount).filter((a): a is string => a !== null);
      return {
        ok: true,
        relayUrl,
        admitUrl: `${relayUrl}/admin-api/namespaces/${input.namespaceId}/admit`,
        admitterAccount: admitters.length === 1 ? admitters[0]! : null,
        peerId: null,
        // The relay a founder's session runs through executes that founder's
        // warrants, so it authors on behalf; the node's answer to the first
        // write is the authoritative one, as for a cloud-routed node.
        writable: true,
        stale: false,
        via: 'invitation',
      };
    }
    return {
      ok: false,
      step: 'no-nodes',
      reason:
        'The cloud lists no nodes serving this namespace, so there is no hosted node to be ' +
        'admitted through. The namespace has no fleet assignment — whoever invited you is ' +
        'running their own node, and admission has to go through a node the cloud routes to.',
    };
  }

  const invited = new Set(
    (input.admitters ?? [])
      .map(normaliseAccount)
      .filter((a): a is string => a !== null),
  );
  const named = nodes.filter((n) => isInvited(n, invited));

  if (named.length === 0) {
    return {
      ok: false,
      step: 'not-invited',
      reason:
        `${nodes.length} node${nodes.length === 1 ? '' : 's'} serve this namespace, but your ` +
        'invitation names none of them. The signed admitter list is a snapshot from when the ' +
        'invitation was minted, so a node assigned since is healthy and will still refuse the ' +
        'claim. Ask for a fresh invitation.',
    };
  }

  // `canAdmit` and `servable` are ADVISORY here, not gates.
  //
  // They are derived from assignment heartbeats, and a lapsed heartbeat is not
  // the same fact as a node that will refuse: measured against prod, the cloud
  // reported `servable: false, canAdmit: false, fresh: false` for a node whose
  // `/admin-api/health` answered `{"status":"alive"}` and which had just minted
  // the invitation being claimed. Refusing on those flags meant refusing to
  // knock on a door that was open.
  //
  // So a node with an address is tried, and the node itself decides. Its answer
  // is the authoritative one: `admit_join` re-verifies the invitation, the
  // signature and the admitters list, so nothing is loosened by asking — the
  // worst case is a 403 that names its own cause, which is strictly better than
  // a client-side guess that names a heartbeat.
  const usable = named.filter((n) => n.canAdmit);
  const candidates = usable.length > 0 ? usable : named;
  const advisory = usable.length === 0 || !servable;

  const addressable = candidates.filter(
    (n): n is CloudNamespaceNode & { relayUrl: string } =>
      typeof n.relayUrl === 'string' && n.relayUrl.length > 0,
  );
  if (addressable.length === 0) {
    return {
      ok: false,
      step: 'no-relay-url',
      reason:
        'A node your invitation names can admit you, but the cloud knows no address for it ' +
        'yet, so there would be nothing to connect through afterwards. Try again shortly.',
    };
  }

  // Prefer a node that can do both legs — admit now and author later — so the
  // session lands on one node where possible. Preference only: admission is the
  // step that cannot proceed without a node, and authorship is not on the
  // invitation's list at all, so insisting would refuse a perfectly good
  // admitter for a permission admission never needed.
  const chosen =
    addressable.find((n) => n.canExecute) ?? addressable.find((n) => n.fresh) ?? addressable[0]!;

  return {
    ok: true,
    relayUrl: chosen.relayUrl,
    // The cloud's ready-made URL when it gave one, so the path is never rebuilt
    // from a guess; the fallback is the documented route on the same origin.
    admitUrl:
      chosen.admitUrl ??
      `${chosen.relayUrl.replace(/\/+$/, '')}/admin-api/namespaces/${input.namespaceId}/admit`,
    admitterAccount: chosen.account,
    peerId: chosen.peerId,
    writable: chosen.canExecute,
    // Stale when the node's own heartbeat lapsed OR when the cloud's summary
    // disagrees with trying it at all. Both mean the same thing to a caller:
    // this was attempted on advisory data, so if the admit fails that is why.
    stale: !chosen.fresh || advisory,
    via: 'cloud',
  };
}
