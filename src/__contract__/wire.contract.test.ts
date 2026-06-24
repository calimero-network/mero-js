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
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import type {
  CreateContextRequest,
  CreateContextResponseData,
  ReparentGroupRequest,
  ReparentGroupResponseData,
} from '../admin-api/admin-types';
import type { ExecuteParams } from '../rpc';

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
}

const ctxReq = key<CreateContextRequest>();
const ctxRes = key<CreateContextResponseData>();
const reReq = key<ReparentGroupRequest>();
const reRes = key<ReparentGroupResponseData>();
const exec = key<ExecuteParams>();

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
    // core defaults these; the SDK does not send them.
    ignoredCoreKeys: ['substitute'],
  },
];

describe('wire contract (core fixtures ↔ SDK types)', () => {
  if (!WIRE_DIR) {
    it.skip('skipped: set CALIMERO_CORE_DIR to a core checkout to run', () => {});
    return;
  }

  for (const spec of SPECS) {
    it(`${spec.type} ↔ ${spec.file}`, () => {
      const fixture = JSON.parse(
        readFileSync(join(WIRE_DIR, spec.file), 'utf8'),
      ) as Record<string, unknown>;
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
