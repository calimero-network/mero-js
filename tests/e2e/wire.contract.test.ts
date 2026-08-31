/**
 * Live wire contract: do a real node's responses satisfy the types the SDK
 * declares? The declared types are hand-written, so they drift from core the
 * moment a field is renamed, added, or made conditional — and every consumer
 * finds out at runtime. This suite provisions real resources on a booted merod
 * and checks, for each covered method:
 *
 *   (a) every key the node emits is one the SDK declares — a field core added
 *       (or renamed) is not silently dropped by a consumer that models it, and
 *   (b) every key the SDK marks required is actually present.
 *
 * Two gates, both needed. `key<T>()` makes each string in a spec a compile-time
 * reference to the declared type, so `pnpm typecheck:contract` fails on a
 * renamed or removed field; this suite then binds those same strings to what the
 * node really sent. A rename that only edits the type breaks the first gate; one
 * that edits type *and* spec breaks the second.
 *
 * Adding a method: append one entry to SPECS with a `sample()` that returns the
 * object(s) to check, and list its keys through the method's own `key<T>()`
 * binder. Nothing else. Do not list a brand field (`__nodeSigned`) in
 * `required` — it is a type-level marker with no wire presence.
 *
 * The fixture-only sibling (`src/__contract__/wire.contract.test.ts`) checks the
 * same two directions against core's committed fixtures with no node running.
 *
 * Run:
 *   NODE_URL=http://localhost:4801 pnpm vitest run --config vitest.e2e.config.ts \
 *     tests/e2e/wire.contract.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MeroJs } from '../../src/mero-js.js';
import { ensureApplication, resolveBaseUrl, resolveCreds, runId } from './harness.js';
import type {
  Application,
  ContextWithGroup,
  CreateGroupInvitationResponseData,
  GroupInvitationFromAdmin,
  Namespace,
  SignedGroupOpenInvitation,
} from '../../src/admin-api/admin-types.js';

const RUN = runId();

/** `key<T>()('x')` is a compile-time assertion that `x` is a field of `T`. */
function key<T>() {
  return (k: keyof T & string): string => k;
}

const app = key<Application>();
const ctx = key<ContextWithGroup>();
const ns = key<Namespace>();
const invitationRes = key<CreateGroupInvitationResponseData>();
const signed = key<SignedGroupOpenInvitation>();
const inv = key<GroupInvitationFromAdmin>();

interface Spec {
  /** The declared type under test, for failure messages. */
  type: string;
  /** SDK method(s) that produce it, for failure messages. */
  via: string;
  /** Live objects to key-check. Empty means "nothing provisioned" and fails. */
  sample: () => Record<string, unknown>[];
  /** SDK-required keys — must be present in every sample. */
  required: string[];
  /** SDK-optional keys — allowed, not required. */
  optional: string[];
}

let mero: MeroJs;
let applicationId: string;
let namespaceId: string;
let contextId: string;
let memberPublicKey: string;
const contextAlias = `wc-ctx-${RUN}`;
const applicationAlias = `wc-app-${RUN}`;

let applications: Application[] = [];
let contexts: ContextWithGroup[] = [];
let namespaces: Namespace[] = [];
let invitation: CreateGroupInvitationResponseData;

const SPECS: Spec[] = [
  {
    type: 'Application',
    via: 'listApplications',
    sample: () => applications as unknown as Record<string, unknown>[],
    required: [app('id'), app('blob'), app('size'), app('source'), app('metadata')],
    optional: [app('signer_id'), app('package'), app('version'), app('services')],
  },
  {
    type: 'ContextWithGroup',
    via: 'getContexts',
    sample: () => contexts as unknown as Record<string, unknown>[],
    required: [ctx('id'), ctx('applicationId'), ctx('contextStateHash')],
    optional: [
      ctx('serviceName'),
      ctx('dagHeads'),
      ctx('applicationVersion'),
      ctx('groupId'),
    ],
  },
  {
    type: 'Namespace',
    via: 'listNamespaces',
    sample: () => namespaces as unknown as Record<string, unknown>[],
    required: [
      ns('namespaceId'),
      ns('appKey'),
      ns('targetApplicationId'),
      ns('createdAt'),
      ns('memberCount'),
      ns('contextCount'),
      ns('subgroupCount'),
    ],
    optional: [ns('name'), ns('appVersion'), ns('upgradePolicy')],
  },
  {
    type: 'CreateGroupInvitationResponseData',
    via: 'createGroupInvitation',
    sample: () => [invitation as unknown as Record<string, unknown>],
    required: [invitationRes('invitation')],
    optional: [invitationRes('groupName')],
  },
  {
    type: 'SignedGroupOpenInvitation',
    via: 'createGroupInvitation',
    sample: () => [invitation.invitation as unknown as Record<string, unknown>],
    required: [signed('invitation'), signed('inviter_signature')],
    optional: [
      // The account the inviter acts as. Unsigned bootstrap hint like the two
      // below, and optional for the same reason: older nodes omit it.
      signed('inviter_account'),
      signed('application_id'),
      signed('app_key'),
    ],
  },
  {
    type: 'GroupInvitationFromAdmin',
    via: 'createGroupInvitation',
    sample: () => [
      invitation.invitation.invitation as unknown as Record<string, unknown>,
    ],
    required: [
      inv('inviter_identity'),
      inv('group_id'),
      inv('expiration_timestamp'),
      inv('secret_salt'),
      inv('invited_role'),
    ],
    optional: [
      // Who may admit a claim of this invitation. Optional because a node
      // predating the field omits it — but a current node always sends it, since
      // core fills the list with the group's admins and TEE nodes when the
      // caller names none. Declaring the TS field was not enough: this list is
      // what the contract check reads, and the two are separate registries.
      inv('admitters'),
    ],
  },
];

describe('live wire contract (merod responses ↔ SDK types)', () => {
  beforeAll(async () => {
    mero = new MeroJs({ baseUrl: resolveBaseUrl() });
    const { username, password } = resolveCreds();
    await mero.authenticate({ username, password });

    applicationId = await ensureApplication(mero);
    // A namespace's root group id is the namespace id, so this one call gives us
    // both a namespace to list and a group to invite into.
    namespaceId = (
      await mero.admin.createNamespace({
        applicationId,
        name: `wire-contract-${RUN}`,
      })
    ).namespaceId;

    const created = await mero.admin.createContext({
      applicationId,
      groupId: namespaceId,
    });
    contextId = created.contextId;
    memberPublicKey = created.memberPublicKey;

    await mero.admin.createContextAlias({ alias: contextAlias, contextId });
    await mero.admin.createApplicationAlias({ alias: applicationAlias, applicationId });

    applications = (await mero.admin.listApplications()).apps;
    contexts = (await mero.admin.getContexts()).contexts;
    namespaces = await mero.admin.listNamespaces();

    const invited = await mero.admin.createGroupInvitation(namespaceId, {});
    if (!('invitation' in invited)) {
      throw new Error('createGroupInvitation returned a recursive payload');
    }
    invitation = invited;
  }, 120000);

  afterAll(() => {
    mero?.close();
  });

  for (const spec of SPECS) {
    it(`${spec.type} (via ${spec.via})`, () => {
      const samples = spec.sample();
      // A spec that provisioned nothing proves nothing.
      expect(
        samples.length,
        `no live ${spec.type} to check — provisioning in beforeAll did not produce one`,
      ).toBeGreaterThan(0);

      const declared = new Set([...spec.required, ...spec.optional]);
      for (const sample of samples) {
        for (const wireKey of Object.keys(sample)) {
          expect(
            declared.has(wireKey),
            `node sent '${wireKey}' but SDK type ${spec.type} does not declare it (${spec.via})`,
          ).toBe(true);
        }
        for (const requiredKey of spec.required) {
          expect(
            Object.prototype.hasOwnProperty.call(sample, requiredKey),
            `SDK ${spec.type} requires '${requiredKey}' but the node omitted it (${spec.via})`,
          ).toBe(true);
        }
      }
    });
  }

  // The three alias listings share one declared type, and it is not a keyed
  // record but a flat map — so it gets a shape check rather than a key table.
  it('ListAliasesResponseData is a flat { alias: id } map (via listContextAliases, listApplicationAliases)', async () => {
    // The annotation is the compile-time half: the declared type has to *be* the
    // map core sends. It stops compiling if it goes back to a list of entries.
    const listings: Record<string, Record<string, string>> = {
      listContextAliases: await mero.admin.listContextAliases(),
      listApplicationAliases: await mero.admin.listApplicationAliases(),
    };

    for (const [via, listing] of Object.entries(listings)) {
      expect(Array.isArray(listing), `${via} returned an array, not a map`).toBe(false);
      for (const [alias, id] of Object.entries(listing)) {
        expect(typeof id, `${via}: value of '${alias}' must be an id string`).toBe(
          'string',
        );
      }
    }

    // Indexing by alias only compiles — and only resolves — if the declared type
    // is the map core actually sends.
    expect(listings.listContextAliases[contextAlias]).toBe(contextId);
    expect(listings.listApplicationAliases[applicationAlias]).toBe(applicationId);
  });
});
