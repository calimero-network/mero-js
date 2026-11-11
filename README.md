# Mero.js — the JavaScript client for Calimero 1.0

The JavaScript/TypeScript client for [Calimero](https://calimero-network.github.io/core/)
1.0, the confidential cloud. `CalimeroClient` verifies a node's TDX attestation,
seals every request to it end to end (Noise NK, `calimero/sealed-http/v2`), signs
people in with WebAuthn passkeys and machines with API keys, and calls apps that
each run on their own replicated log. It runs in the browser and Node 18+, and is
byte-compatible with core's `calimero-sealed` and `calimero-client`.

> **Version 27 is the Calimero 1.0 client only.** The v1 SDK for merod 0.x nodes
> (`MeroJs`, the admin and auth API clients, JSON-RPC, contexts and namespaces)
> is in 26.x. See [Migrating from v1](https://calimero-network.github.io/mero-js/reference/migrating-from-v1/).

## Documentation

**<https://calimero-network.github.io/mero-js/>**: quickstart, guides, and the
reference for every method and the route it calls. The source is under [`docs/`](docs/).

## Installation

```bash
npm install @calimero-network/mero-js
```

The package ships ESM, CommonJS and a minified browser build with its own
TypeScript declarations. Its one dependency, `@phala/dcap-qvl`, verifies TDX
quotes and is loaded on first use.

## Quick start

```ts
import { CalimeroClient, browserPasskey } from '@calimero-network/mero-js';

// Reach a Calimero Cloud cluster by name.
const client = await CalimeroClient.connect({
  cluster: 'eu-shared-1',
  // Trust the signed mero-tee release the node names, from this one up.
  policy: { release: { minReleaseVersion: '2.3.109' } },
});

await client.signUp(browserPasskey(), 'alice'); // or signIn(browserPasskey())
await client.installPackage('com.example.kv', '1.0.0'); // signed .mpk from the registry
const app = await client.createApp('kv', { package: 'com.example.kv', version: '1.0.0' }, { confirmMethods: ['clear'] });

await client.call(app, 'set', { key: 'a', value: '1' });
const { result } = await client.view(app, 'get', { key: 'a' });
await client.callConfirmed(app, 'clear', {}, browserPasskey()); // passkey consent
for await (const event of client.events(app)) console.log(event);
await client.upgradeApp(app, { version: '1.1.0' }, browserPasskey()); // the owner approves
```

A development cluster (`merod local`, `merod run --dev`) sends mock quotes,
which pass only with `policy: { allowMock: true }`. Nothing is read from the
environment.

## Connecting to a cluster

`CalimeroClient.connect({ cluster, policy })` is the recommended way to reach a
Calimero Cloud cluster. It reads the cluster's nodes from the public node
directory (`DEFAULT_DIRECTORY`, `https://manager.cloud.calimero.network/api/v2/directory`;
`directory` names another), puts those in `zone` first when you give one, and
orders each group at random, weighted by the directory's weight. A cluster the
directory does not know, or one with no usable node, throws `DirectoryError`.

The directory only picks which nodes to try, and in what order. It is not
trusted: every node is attested under **your** `policy` before anything is
sent to it, so a wrong or tampered list can only make connecting fail.

Any node of a cluster serves any request. While the node in use answers `503`
or cannot be reached, a call or a view is retried there (`retry`); when those
retries run out it fails over to the next node and starts them again there,
with the **same** idempotency key, which the app's replicated log answers once
cluster-wide. Each node is tried once per request; when all have failed, the
last `UnavailableError` reaches you. After a failover, and once the directory's
`refreshAfterSeconds` has passed (checked at the next request), the client
reads the directory again in the background: the node in use stays first,
nodes no longer listed are dropped. `client.nodeUrl` is the node in use,
`client.nodes` the list.

For a fixed list of nodes or a cluster you run yourself, construct the client
directly: `new CalimeroClient({ baseUrl, nodes, policy })`. It fails over
between `baseUrl` and `nodes` the same way, and never reads a directory.

## What the client checks

Before it sends anything to a node, as core's Rust client does (`Measurements::Release`):

1. The node names the mero-tee release it runs. A release below `minReleaseVersion` is refused before anything is fetched.
2. The release's `published-mrtds.json` is fetched and its Sigstore signature is checked against the mero-tee node release workflow.
   By default it comes from the `cloud.calimero.network` mirror; `releaseSource: 'github'` reads the GitHub release instead (Node only: GitHub sends no CORS headers).
3. The quote is checked against Intel's collateral with `@phala/dcap-qvl`: the signature chain and the TCB status. The collateral comes from the cloud's mirror (`DEFAULT_COLLATERAL_MIRROR`), which browsers can read; it only carries Intel-signed items. `collateralSource: 'intel'` asks Intel's PCS (no CORS: not in browsers), `fetchCollateral` replaces the fetch, and `maxCollateralAgeDays` refuses collateral Intel issued longer ago.
4. A debug TD is refused.
5. The registers must be the release's `locked-read-only` image; a debug profile is trusted only with `allowDebugProfile`.
6. The quote's report data binds the client's nonce and the transport key the sealed channel opens to.

Pinned measurements go through `policy.verifyQuote` (`createQuoteVerifier`).

## The API

Every route of the node is on `client.api`, generated from core's OpenAPI
document ([below](#the-runtime-and-the-route-layer)). The methods listed here
are the hand-written ones, which now call `client.api`; the single-route ones are
deprecated and go once the apps have moved to it.


- **Credentials**: `signUp` (with an `invite`, on a cluster that takes new accounts by invite; `signUpPolicy` reads which), `signIn`, `refresh`, `signOut`, `signOutEverywhere`, `listSessions`, `revokeSession`, `listActivity`, `useSession`, `useApiKey`, `me`, `usage`, `addPasskey`, `labelPasskey`, `removePasskey`, `createApiKey`, `listApiKeys`, `revokeApiKey`. Adding or removing a passkey and creating an API key are approved with a passkey the account already has.
- **Account recovery** (core #4844): `createRecoveryCode`, `removeRecoveryCode` (passkey-approved; the code is shown once), then signed out `startAccountRecovery(code, passkey)` and, 72 hours later, `finishAccountRecovery(passkey, accountId?)`; a passkey the account still has cancels in between (`cancelAccountRecovery`; `me()` shows `recoveryCode` and `recoveryPending`).
- **Package origins**: `packageOrigins.list`, `packageOrigins.add`, `packageOrigins.remove`. A package's managers register the web origins of a frontend they host themselves (approved with a passkey); `signUp` and `signIn` on such a page send its origin, sign for that origin's relying-party id, and open a session bound to the package (`me()` answers its `app` and `origin`). An unregistered origin is refused with `OriginNotRegistered`. `packageOrigins.add(pkg, origin, passkey, { served: true })` registers a custom domain: the cluster also serves the package's frontend there from its signed bundle (`https://host`, no port; the passkey's consent names `served: true`); `list` answers `served` on each origin, and the extra refusals are `NotServing` (the cluster serves no frontends), `ClusterNotUpgraded` (a node is on an older release), `QuotaExceeded` (4 served per package, 64 per cluster) and `OriginTaken` (held with the other `served`).
- **Packages**: `installPackage`, `uploadPackage`, `packages`, `package`, `uninstallPackage`; `uploadBundle` (raw WASM, development clusters only).
- **Apps**: `createApp`, `listApps`, `getApp`, `deleteApp`, `setAccess`, `setAppMetadata`, `appStorage`, `appAbi`, `upgradeApp`, `transferApp`, `moveApp`.
- **Calls**: `call`, `callConfirmed`, `view`, `events`. A call always carries an idempotency key, and is sent again with it while the node answers `503`, then to the next node.
- **Blobs and presence**: `uploadBlob`, `downloadBlob`, `listBlobs`, `blobInfo`, `deleteBlob`; `publishPresence`, `presence`, `presenceStream`.
- **Organizations**: `createOrg`, `getOrg`, `orgMembersSecurity` (owners and admins: each member's passkey count to `3+`, recovery code set, last active day, live sessions), `deleteOrg`, `setOrgMetadata`, `setMember`, `removeMember`, `setMemberMetadata`, `setCapabilities` (`ORG_CAPABILITIES`), `setTeamDefaultCapabilities`, teams, app teams (`listAppTeams`, `scopeApps`), `invite` (`{ allApps: true }`: whoever redeems it gets every app added later), `setAllApps` (owner or admin: every app added later, for a member), `redeemInvite`, `listInvites`, `revokeInvite`, recovery (`setRecoveryKey`, `startRecovery`, `cancelRecovery`, `finishRecovery`; `newRecoverySeed`, `recoveryPublicKey`). Setting or removing a member or team member, capabilities, invites (minting and revoking) and scoping apps are approved with the caller's passkey; redeeming an invite is not.
- **Owner decisions** (passkey approval, never from an app's frontend): `upgradeOrg`, `upgradeRun`, `retryUpgradeRun`, `approveRelease`, `approveOutbound`, `bindPublisher`, `upgradePublished`.
- **Approvals from an app**: `appsReport`, `releaseRules`, `pendingApprovals`, then `requestConsent` / `openConsentPage` to send the user to the node's consent page, and `consentResult`. Show the answer's `code` to the user before sending them to `url` (`openConsentPage`'s `confirm` hook); they should see the same code on the page (`confirmationCode(requestId)` checks it). See [Ask your users to approve node images and app upgrades](https://calimero-network.github.io/mero-js/guides/user-approvals/).
- **Operator** (ops token): `opsApps`, `opsOrgs`, `opsServedOrigins` (every custom domain the log holds, by package label), `setReleaseDeadline`, `liftReleaseDeadline`.
- **Any route**: `client.api` (below), typed from core's OpenAPI document. The untyped `get`, `post`, `put`, `delete`, `postConfirmed` and `deleteConfirmed` are deprecated.

Refusals are typed (`LoginRequired`, `PasskeyUnknownHere`, `WrongNode`, `NotFound`, `ConfirmRequired`, `ConfirmCancelled`, `ConfirmPromptBlocked`,
`ArgsTooLarge`, `IdempotencyMismatch`, `ReleaseDeadlineError`, `RuntimeTooOld`, `ConsentStale`, `AppError`, `TrapError`,
`UnavailableError`, `OriginNotRegistered`, `BadOrigin`, `OriginTaken`, `QuotaExceeded`),
all extending `CalimeroError` with the node's `status` and `code`. A `401` once
the node that issued the session is replaced or out of reach is answered by one
refresh and a repeat; a `421 WRONG_NODE` by moving to the next of the `nodes` the client was
given. See the
[error model](https://calimero-network.github.io/mero-js/reference/error-model/).

The pieces it is built from are exported too: the sealed transport
(`createSealedFetch`), quote and signed-release verification
(`createQuoteVerifier`, `createSignedReleaseVerifier`, `trustSignedRelease`), and
the client for mero-tee's private agent gate (`attestAgent`, `provisionAgent`,
`releaseAgent`).

## The runtime and the route layer

The client is two layers. The **runtime** (`@calimero-network/mero-js/runtime`,
`src/runtime/`) is everything that is not a route: the node's attestation, the
sealed channel, the credential and the session's refresh on a `401`, moving on
`421 WRONG_NODE`, D70 retries and failover, error mapping and server-sent
events. The **route layer** is generated from core's OpenAPI document
(`openapi/core-openapi.json`, the node's `docs/public/openapi.json`): its types
are `src/generated/api.ts` (`pnpm gen:api`), and `openapi-fetch` runs them over
the runtime. `client.api` is that client, sharing `client.transport`'s session:

```ts
import { passkeyConfirm, stepUp, unwrap } from '@calimero-network/mero-js';

// A typed route: `data` or the node's `error`, both typed per route.
const { data, error } = await client.api.GET('/apps/{app}', { params: { path: { app: appId } } });

// A step-up (`412 CONFIRM_REQUIRED`): the middleware signs the node's
// challenge with the passkey and sends the same body again with `confirm`.
await unwrap(
  client.api.DELETE('/orgs/{org}', { params: { path: { org } }, middleware: [stepUp(passkeyConfirm(passkey))] }),
);
```

- `createApiClient(transport, { confirm?, operatorProof? })` builds one on any
  `NodeTransport`; `confirm` answers every `412`, `operatorProof` every
  `428 OPERATOR_SIGNATURE_REQUIRED` (the operator key's signature over the
  statement's `message`, sent again as `operatorProof`). A request's own
  `middleware: [stepUp(...)]` or `[operatorSignature(...)]` answers first.
- `transportFetch(transport)` is the `fetch` it runs on: the request's path,
  query and body go through the transport (sealed, with the credential); the two
  routes served in the clear (`/attestation`, `/health`) go unsealed. Calls and
  views (`/apps/{app}/intents`, `/views`) are retried on `503` as D70 says, a call
  gets an idempotency key when it has none (`idempotencyKeys`), and its confirmed
  retry goes out once.
- A refusal is the result's `error`; `unwrap(result)` throws it as the typed
  `CalimeroError` instead. A transport failure rejects.
- Streams (`events`, `presenceStream`) stay hand-written on the runtime
  (`client.transport.events(path)`).

The **hand-written methods** of `CalimeroClient` (`createOrg`, `call`, ...) are
now thin calls onto `client.api`, kept, `@deprecated`, until the apps have moved
to the generated client. The ceremonies (`signUp`, `signIn`, `addPasskey`,
account and organization recovery, `openConsentPage`, ...) stay as flows.

The runtime's own surface toward routes is still one interface, for a route
layer of your own:

```ts
interface Transport {
  request(method: HttpMethod, path: string, options?: RequestOptions): Promise<Response>; // 2xx, body unread
  json<T>(method: HttpMethod, path: string, options?: RequestOptions): Promise<T>;
  events(path: string, options?: { query?; signal? }): AsyncGenerator<CloudEvent>;
}
// RequestOptions: { query?, body? (JSON) | bytes? + contentType?, passkey? (answers a 412),
//                   userVerification?, retry?: true | 'once' (D70), signal?, promptSignal? }
```

`NodeTransport` implements it, and `exchange(method, path, options)` answers a
refusal as the node's response instead of throwing it (what the generated
client sends through). The `/runtime` entry re-exports the package's own bundle,
so its error classes are the ones `CalimeroClient` throws (`instanceof` holds
across both imports).

### Refreshing the OpenAPI document

`openapi/core-openapi.json` is vendored from core at the commit `openapi/SOURCE`
names. `scripts/refresh-openapi.sh [<core ref>]` (`pnpm refresh:openapi`)
fetches it again, records the commit and regenerates `src/generated/api.ts`;
`pnpm check:api` fails when the generated types are not those of the vendored
document.

## Development

```bash
pnpm install
pnpm build
pnpm test:unit   # unit tests, against a stand-in node over a real sealed channel
pnpm lint
pnpm typecheck
pnpm typecheck:consumer
```

The cluster tests (`tests/cloud-v2`) start three `merod run --dev` nodes and
run the client against them:

```bash
MEROD_BINARY=/path/to/merod KV_STORE_WASM=/path/to/kv_store.wasm pnpm test:cloud-v2
```

Without the variables they use `../core/target/debug/merod` and
`../core/target/wasm32-unknown-unknown/app-release/kv_store.wasm` from a sibling
core checkout. `scripts/download-released-merod.sh` fetches the newest released
1.0 `merod` and its kv-store fixture, which is what CI runs them against; core's
`e2e.yml` runs the same suite against core's own tree.

## License

MIT — see [LICENSE](LICENSE).
