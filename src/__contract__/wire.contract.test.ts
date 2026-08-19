/**
 * SDK ↔ core wire contract (the SDK-side half of the fixture canary).
 *
 * Loads core's committed wire fixtures (via CALIMERO_CORE_DIR) and checks each
 * against the SDK type that mirrors it:
 *   (a) every key core emits is one the SDK type declares (catches a core
 *       rename/addition the hand-written type doesn't know — the #51 `groupName`
 *       class of bug), and
 *   (b) every key the SDK marks required is present in the core wire.
 *
 * The `key<T>()` helper makes each declared key a *compile-time* reference to the
 * SDK type, so a renamed/removed field fails `typecheck:contract`. Skips when
 * CALIMERO_CORE_DIR is unset, so it is a no-op in the plain unit run.
 *
 * The fixtures are a committed snapshot core regenerates with `UPDATE_FIXTURES=1`,
 * not a live node: a core-side rename lands here only once someone regenerates it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import type {
  CreateContextRequest,
  CreateContextResponseData,
  GroupUpgradeStatus,
  MemberMigrationReport,
  MemberMigrationStatusEntry,
  MigrationStatus,
  MigrationStatusRollup,
  ReparentGroupRequest,
  ReparentGroupResponseData,
  UpgradeGroupResponseData,
} from '../admin-api/admin-types.js';
import type { ExecuteParams } from '../rpc/index.js';

const CORE_DIR = process.env.CALIMERO_CORE_DIR;
const WIRE_DIR = CORE_DIR
  ? join(CORE_DIR, 'crates/server/primitives/fixtures/wire')
  : null;

/** `key<T>()('x')` is a compile-time assertion that `x` is a field of `T`. */
function key<T>() {
  return (k: keyof T & string): string => k;
}

interface Spec {
  type: string;
  file: string;
  /** SDK-required keys — must be present in core's wire. */
  required: string[];
  /** SDK-optional keys — allowed but not required. */
  optional: string[];
  /** Core-optional fields the SDK intentionally does not model (no drift). */
  ignoredCoreKeys?: string[];
  /** Dotted path to descend into before comparing: an envelope key (`data`),
   * a nested object (`rollup`), or an array element (`members.1`). */
  path?: string;
}

const ctxReq = key<CreateContextRequest>();
const ctxRes = key<CreateContextResponseData>();
const reReq = key<ReparentGroupRequest>();
const reRes = key<ReparentGroupResponseData>();
const exec = key<ExecuteParams>();
const upRes = key<UpgradeGroupResponseData>();
const upStatus = key<GroupUpgradeStatus>();
const mStatus = key<MigrationStatus>();
const mRollup = key<MigrationStatusRollup>();
const mEntry = key<MemberMigrationStatusEntry>();
const mReport = key<MemberMigrationReport>();

// `jsonrpc/execute.res.json` is deliberately absent: its SDK counterpart is an
// unexported inline type whose index signature makes `key<T>()` accept any
// string, so a spec for it would compile no matter how wrong the name was.
const SPECS: Spec[] = [
  {
    type: 'CreateContextRequest',
    file: 'contexts/create_context.req.json',
    required: [ctxReq('applicationId'), ctxReq('groupId')],
    optional: [
      ctxReq('serviceName'),
      ctxReq('contextSeed'),
      ctxReq('initializationParams'),
      ctxReq('identitySecret'),
      ctxReq('name'),
    ],
  },
  {
    type: 'CreateContextResponseData',
    file: 'contexts/create_context.res.json',
    required: [ctxRes('contextId'), ctxRes('memberPublicKey')],
    optional: [ctxRes('groupId'), ctxRes('groupCreated')],
  },
  {
    type: 'ReparentGroupRequest',
    file: 'groups/reparent.req.json',
    required: [reReq('newParentId')],
    optional: [reReq('requester')],
  },
  {
    type: 'ReparentGroupResponseData',
    file: 'groups/reparent.res.json',
    required: [reRes('reparented')],
    optional: [],
  },
  {
    type: 'ExecuteParams',
    file: 'jsonrpc/execute.req.json',
    required: [exec('contextId'), exec('method')],
    optional: [exec('argsJson'), exec('executorPublicKey')],
  },
  {
    type: 'UpgradeGroupResponseData',
    file: 'groups/upgrade.res.json',
    path: 'data',
    required: [upRes('groupId'), upRes('status')],
    optional: [
      upRes('localContextsTotal'),
      upRes('localContextsSwapped'),
      upRes('localContextsFailed'),
    ],
  },
  {
    type: 'GroupUpgradeStatus',
    file: 'groups/upgrade_status.res.json',
    path: 'data',
    required: [
      upStatus('fromVersion'),
      upStatus('toVersion'),
      upStatus('initiatedAt'),
      upStatus('initiatedBy'),
      upStatus('status'),
    ],
    optional: [
      upStatus('localContextsTotal'),
      upStatus('localContextsSwapped'),
      upStatus('localContextsFailed'),
      upStatus('completedAt'),
    ],
  },
  {
    type: 'MigrationStatus',
    file: 'groups/migration_status.res.json',
    required: [
      mStatus('targetVersion'),
      mStatus('expectedMembers'),
      mStatus('rollup'),
      mStatus('members'),
    ],
    optional: [mStatus('cohortPinnedAtHlc'), mStatus('fleetCompletedAt')],
  },
  {
    type: 'MigrationStatusRollup',
    file: 'groups/migration_status.res.json',
    path: 'rollup',
    required: [
      mRollup('migrated'),
      mRollup('inProgress'),
      mRollup('unknown'),
      mRollup('failed'),
      mRollup('total'),
      mRollup('allMigrated'),
      mRollup('membersPendingSignature'),
    ],
    optional: [],
  },
  // The fixture's second member is the one carrying every optional at once: an
  // account, a report, and a `migrationFailed` inside it.
  {
    type: 'MemberMigrationStatusEntry',
    file: 'groups/migration_status.res.json',
    path: 'members.1',
    required: [mEntry('peer'), mEntry('state')],
    optional: [mEntry('account'), mEntry('report')],
  },
  {
    type: 'MemberMigrationReport',
    file: 'groups/migration_status.res.json',
    path: 'members.1.report',
    required: [
      mReport('schemaVersion'),
      mReport('residueAuto'),
      mReport('syncedUpToHlc'),
      mReport('reportedAt'),
      mReport('authoredRemaining'),
    ],
    optional: [mReport('migrationFailed')],
    // Always 0 on the wire and slated for removal once the client-py floor moves.
    ignoredCoreKeys: ['residueIdentity'],
  },
];

/** Resolves a Spec's dotted `path` against the parsed fixture. */
function descend(
  raw: unknown,
  path?: string,
): Record<string, unknown> | undefined {
  if (!path) return raw as Record<string, unknown>;
  return path
    .split('.')
    .reduce<unknown>(
      (value, k) => (value as Record<string, unknown> | undefined)?.[k],
      raw,
    ) as Record<string, unknown> | undefined;
}

describe('wire contract (core fixtures ↔ SDK types)', () => {
  if (!WIRE_DIR) {
    it.skip('skipped: set CALIMERO_CORE_DIR to a core checkout to run', () => {});
    return;
  }

  for (const spec of SPECS) {
    it(`${spec.type} ↔ ${spec.file}`, () => {
      const raw = JSON.parse(
        readFileSync(join(WIRE_DIR, spec.file), 'utf8'),
      ) as Record<string, unknown>;
      const fixture = descend(raw, spec.path);
      if (!fixture) {
        throw new Error(`fixture ${spec.file} has nothing at '${spec.path}'`);
      }
      const fixtureKeys = Object.keys(fixture);
      const known = new Set([
        ...spec.required,
        ...spec.optional,
        ...(spec.ignoredCoreKeys ?? []),
      ]);

      // (a) the SDK type knows every field core emits.
      for (const k of fixtureKeys) {
        expect(
          known.has(k),
          `core wire key '${k}' is not declared by SDK type ${spec.type} (${spec.file})`,
        ).toBe(true);
      }
      // (b) core's wire carries every field the SDK requires.
      for (const r of spec.required) {
        expect(
          fixtureKeys.includes(r),
          `SDK ${spec.type} requires '${r}' but core fixture ${spec.file} omits it`,
        ).toBe(true);
      }
    });
  }
});
