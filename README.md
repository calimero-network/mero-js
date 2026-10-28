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

const client = new CalimeroClient({
  baseUrl: 'https://eu1.cloud.calimero.network',
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

## What the client checks

Before it sends anything to a node, as core's Rust client does (`Measurements::Release`):

1. The node names the mero-tee release it runs. A release below `minReleaseVersion` is refused before anything is fetched.
2. The release's `published-mrtds.json` is fetched and its Sigstore signature is checked against the mero-tee node release workflow.
   By default it comes from the `cloud.calimero.network` mirror; `releaseSource: 'github'` reads the GitHub release instead (Node only: GitHub sends no CORS headers).
3. The quote is checked against Intel's collateral with `@phala/dcap-qvl` (Intel's PCS unless you give `fetchCollateral`): the signature chain and the TCB status.
4. A debug TD is refused.
5. The registers must be the release's `locked-read-only` image; a debug profile is trusted only with `allowDebugProfile`.
6. The quote's report data binds the client's nonce and the transport key the sealed channel opens to.

Pinned measurements go through `policy.verifyQuote` (`createQuoteVerifier`).

## The API

- **Credentials**: `signUp`, `signIn`, `refresh`, `signOut`, `signOutEverywhere`, `useSession`, `useApiKey`, `me`, `usage`, `addPasskey`, `labelPasskey`, `removePasskey`, `createApiKey`, `listApiKeys`, `revokeApiKey`.
- **Packages**: `installPackage`, `uploadPackage`, `packages`, `package`, `uninstallPackage`; `uploadBundle` (raw WASM, development clusters only).
- **Apps**: `createApp`, `listApps`, `getApp`, `deleteApp`, `setAccess`, `setAppMetadata`, `appStorage`, `appAbi`, `upgradeApp`, `transferApp`.
- **Calls**: `call`, `callConfirmed`, `view`, `events`. A call always carries an idempotency key, and is sent again with it while the node answers `503`.
- **Blobs and presence**: `uploadBlob`, `downloadBlob`, `listBlobs`, `blobInfo`, `deleteBlob`; `publishPresence`, `presence`, `presenceStream`.
- **Organizations**: `createOrg`, `getOrg`, `deleteOrg`, `setOrgMetadata`, `setMember`, `removeMember`, `setMemberMetadata`, `setCapabilities` (`ORG_CAPABILITIES`), teams, `invite`, `redeemInvite`.
- **Owner decisions** (passkey approval): `upgradeOrg`, `upgradeRun`, `retryUpgradeRun`, `approveRelease`, `approveOutbound`.
- **Any route**: `get`, `post`, `put`, `delete`; `postConfirmed` and `deleteConfirmed` answer a `412 CONFIRM_REQUIRED` with a passkey.

Refusals are typed (`LoginRequired`, `NotFound`, `ConfirmRequired`, `ConfirmCancelled`,
`ArgsTooLarge`, `IdempotencyMismatch`, `AppError`, `TrapError`, `UnavailableError`),
all extending `CalimeroError` with the node's `status` and `code`. See the
[error model](https://calimero-network.github.io/mero-js/reference/error-model/).

The pieces it is built from are exported too: the sealed transport
(`createSealedFetch`), quote and signed-release verification
(`createQuoteVerifier`, `createSignedReleaseVerifier`, `trustSignedRelease`), and
the client for mero-tee's private agent gate (`attestAgent`, `provisionAgent`,
`releaseAgent`).

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
