/**
 * An account's group management through a relay: one delegated governance op
 * per call (`RelayClient.govern`), posted to the relay that serves the group's
 * namespace.
 *
 * A group op goes to the group it acts on; a root op (create, delete, move a
 * subgroup; join an open one) goes to the NAMESPACE. The namespace of a
 * subgroup is remembered here per account: when this account created it, and
 * when the account admin asked the relay for it (`getGroupInfo`).
 */
import {
  type GovernanceOp,
} from '../warrant/index.js';
import { delegatedGovernance } from './create-context.js';
import { readRelayMap, type DelegatedSession } from './session.js';

const GROUP_NAMESPACE_PREFIX = 'calimero.delegated.group-namespace.';

// What this page has learned, whether or not storage keeps it: a private window
// or blocked site data must not turn a known subgroup back into an unknown one.
const learned = new Map<string, Record<string, string>>();

function readGroupNamespaces(account: string): Record<string, string> {
  let stored: Record<string, string> = {};
  try {
    stored = JSON.parse(localStorage.getItem(GROUP_NAMESPACE_PREFIX + account) ?? '{}') as Record<string, string>;
  } catch {
    /* no storage: what this page learned still stands */
  }
  return { ...stored, ...learned.get(account) };
}

/** Record that `groupId` is a subgroup of `namespaceId`, for this account. */
export function rememberGroupNamespace(account: string, groupId: string, namespaceId: string): void {
  learned.set(account, { ...learned.get(account), [groupId]: namespaceId });
  try {
    const all = readGroupNamespaces(account);
    all[groupId] = namespaceId;
    localStorage.setItem(GROUP_NAMESPACE_PREFIX + account, JSON.stringify(all));
  } catch {
    /* unpersisted: root ops on this subgroup will ask for its namespace */
  }
}

/** The namespace a group belongs to: itself if it is a namespace this account is in, else what was remembered. */
export function namespaceOfGroup(s: DelegatedSession, groupId: string): string | undefined {
  if (readRelayMap(s.account).namespaces[groupId]) return groupId;
  return readGroupNamespaces(s.account)[groupId];
}

function requireNamespace(s: DelegatedSession, groupId: string): string {
  const ns = namespaceOfGroup(s, groupId);
  if (!ns) {
    throw new Error(
      `the namespace of group ${groupId} is not known to this account: it can manage only groups in namespaces it joined or subgroups it created`,
    );
  }
  return ns;
}

/** A group op (member, role, capabilities, metadata, visibility, detach) on `groupId`. */
export async function governGroup(s: DelegatedSession, groupId: string, op: GovernanceOp): Promise<{ groupId: string }> {
  return delegatedGovernance(s, { namespaceId: requireNamespace(s, groupId), group: groupId, op });
}

/** A root op, posted to the namespace `groupId` belongs to. */
export async function governRoot(s: DelegatedSession, groupId: string, op: GovernanceOp): Promise<{ groupId: string }> {
  const namespaceId = requireNamespace(s, groupId);
  return delegatedGovernance(s, { namespaceId, group: namespaceId, op });
}
