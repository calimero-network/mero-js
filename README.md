# Mero.js — Pure JavaScript SDK for Calimero

A lightweight, universal JavaScript/TypeScript SDK for [Calimero](https://calimero-network.github.io/core/).
Authenticate to a node, drive the admin API, execute WASM methods over JSON-RPC,
and stream real-time events — from the browser, Node, Deno, Bun, or edge
runtimes. Zero runtime dependencies; built entirely on Web Platform APIs
(`fetch`, `WebSocket`, `AbortController`).

## Documentation

Full documentation is published at
**<https://calimero-network.github.io/mero-js/>** — quickstart, guides, and the
complete API reference (`MeroJs`, admin API, auth API, RPC, events, cloud,
capabilities, and the error model). The source lives under [`docs/`](docs/).

> **Not React?** This is a framework-agnostic SDK. React bindings live in the
> separate [`@calimero-network/mero-react`](https://github.com/calimero-network/mero-react)
> package.

## Installation

```bash
npm install @calimero-network/mero-js
```

Requires Node.js 18+ (native `fetch`) or any modern browser. The package ships
ESM, CommonJS, and a minified browser build, is side-effect-free (tree-shakeable),
and includes its own TypeScript declarations.

## Quick start

```typescript
import { createMeroJs, HTTPError, RpcError } from '@calimero-network/mero-js';

const sdk = createMeroJs({
  baseUrl: 'http://localhost:2528',
  // timeoutMs defaults to 10000; pass a tokenStore to persist auth
});

// Authenticate (username/password against the node's auth service)
await sdk.authenticate({ username: 'dev', password: 'dev' });

// Admin API — list this node's contexts
const { contexts } = await sdk.admin.getContexts(); // ContextWithGroup[]
console.log(`found ${contexts.length} contexts`);

// Execute a context method over JSON-RPC
try {
  const value = await sdk.rpc.execute<string>({
    contextId: contexts[0].id,
    method: 'get_value',
    argsJson: { key: 'greeting' },
  });
  console.log(value);
} catch (err) {
  if (err instanceof RpcError) console.error(`contract error ${err.code}: ${err.message}`);
  else if (err instanceof HTTPError) console.error(`HTTP ${err.status}: ${err.statusText}`);
  else throw err;
}

// Stream real-time context events (SSE)
sdk.events.on('event', (e) => console.log(e.contextId, e.type, e.data));
await sdk.events.connect();
await sdk.events.subscribe([contexts[0].id]);

// Tear down open connections when done
sdk.close();
```

`sdk.auth`, `sdk.admin`, `sdk.rpc`, `sdk.events` (SSE) and `sdk.ws` (experimental
WebSocket) are all reachable from the one `MeroJs` instance. See the
[quickstart](https://calimero-network.github.io/mero-js/get-started/quickstart/)
and [authentication guide](https://calimero-network.github.io/mero-js/get-started/authentication/)
for token persistence and the refresh lifecycle.

## Error model

Every failure surfaces as a typed error:

- **`HTTPError`** — a non-2xx response. Network failures, timeouts, and
  cancellations are also wrapped as `HTTPError` with **`status: 0`** (the
  underlying `AbortError`/`TimeoutError` is not propagated).
- **`AuthRevokedError`** (extends `HTTPError`) — the refresh token was reused or
  revoked; the session is over. The SDK has already cleared its tokens.
- **`RpcError`** — the WASM contract returned a JSON-RPC error (`code`, `message`,
  optional `type`/`data`).

`classifyError(err)` turns any of these into `{ kind, retryable, message }`.
`kind` is read off the status (`'conflict'` for a 409, `'unavailable'` for a
503, `'unreachable'` for status 0, and so on). `retryable` says whether the same
request could work later. `message` is the node's own words. To follow an
invitation, use `sdk.admin.redeemInvitation`: a join that failed but landed
comes back as `already-member` rather than as an error.

`401`s are handled internally: the SDK refreshes the token and retries once, so
you only see a `401` if the refresh itself fails. Full details in the
[error model reference](https://calimero-network.github.io/mero-js/reference/error-model/).

## Writing without a node

v1's way to write without a node — signing a *warrant* and having a hosted TEE
**relay** run it (delegated execution), with request proofs, the relay client
and the delegated account layer around it — has been removed: release-v2's
nodes no longer serve any of it. Each app instance now runs on an attested
cluster, replicated by its own log, and a client with no node of its own talks
to it with `CalimeroClient` over the sealed channel; see
[Calimero Cloud (release-v2)](#calimero-cloud-release-v2) below.

| Removed (v1) | Release-v2 replacement |
| --- | --- |
| `connectCloud`, `connectCloudWithAccount`, `RelayClient`, nonce sources | `CalimeroClient` (`signUp`/`signIn`, `call`, `view`, `callConfirmed`) |
| `signWarrant` and creation warrants | `CalimeroClient.call` / `callConfirmed` (passkey consent) and `createApp` |
| governance warrants and the `*Op` builders (`memberAddedOp`, `groupCreatedOp`, …) | `CalimeroClient.createOrg`, `setMember`, `createTeam`, `setTeamMember`, `setCapabilities` |
| `createMeroClient` / `MeroClient`, `RelayTransport`, `RelayObserver` | `createMeroJs` for a v1 node; `CalimeroClient` (and `client.events(app)`) for release-v2 |
| request proofs (`requestProof`, `createProofSigner`, `createProofAuthorizer`, `signRequestProof`, `callerProof`, `signRequest`) | the sealed channel's session, opened after attestation |
| `attestRelayNodeKey` | `CalimeroClient`'s attestation (`src/cloud-v2/attestation.ts`) |
| `RelayPresenceClient`, `presenceStatementBytes` | none: v1 only |
| the delegated account layer (`buildDelegatedClient`, `createAccountAdmin`, `foundDelegatedNamespace`, `joinAsAccount`, `bootstrapFromInvitation`, …) | `CalimeroClient`: `signUp`/`signIn`, `createOrg`, `invite` / `redeemInvite` |
| `AdminApiClient.performIntent`, `getIntentRelay`, `openToDelegatedExecution`, `grantAuthorship` | none: v1 only |

## Private agents

A private agent runs in a TDX VM (mero-tee's agent image) that several owners' agents share, each named by an agent id. Its gate proves which image runs and takes each agent's secrets only sealed to it, from its owner. These functions are that owner's side; whoever relays the requests (mdma included) sees only quotes and ciphertext.

```ts
import { verify as dcapVerify, getCollateral } from '@phala/dcap-qvl';
import {
  agentQuoteVerifier, attestAgent, generateOwnerKey, provisionAgent, releaseAgent, verifySignedAgentPolicy,
} from '@calimero-network/mero-js';

// The mero-kms release's agent allowlist, checked against its Sigstore signature.
const policy = await verifySignedAgentPolicy(policyJson, bundleJson, { profile: 'locked-read-only' });
const verifier = agentQuoteVerifier(policy, { dcapVerify, fetchCollateral: (quote) => getCollateral(PCCS_URL, quote) });

const owner = await generateOwnerKey(); // keep owner.secret: only it can change or release the agent
const agent = await attestAgent({ gateUrl, agentId: 'a-1f2e', verifier });
await provisionAgent({ gateUrl, agent, ownerSecret: owner.secret, verifier, secrets: { NEAR_AI_API_KEY: key } });
// later: await releaseAgent({ gateUrl, agent: await attestAgent({ gateUrl, agentId, verifier }), ownerSecret, verifier });
```

- `attestAgent` returns the agent's keys only once its quote verifies: genuine, from an image in the policy, not a debug TD, for your nonce, and committing to the agent id asked about and to the keys the gate names.
- `provisionAgent` refuses an agent another key claimed before sending anything. The first bundle for an unclaimed agent claims it for your key, and a fresh quote must then name your key as owner.
- Secrets are sealed with RFC 9180 HPKE in Auth mode (X25519, HKDF-SHA256, ChaCha20-Poly1305) to the gate's in-memory key, for that agent id only.
- `releaseAgent` stops the agent and erases its slot; a fresh quote must name no owner.

## Calimero Cloud (release-v2)

`CalimeroClient` talks to a release-v2 cluster (`merod`): it verifies the node's
TDX attestation, seals every request (Noise NK, `calimero/sealed-http/v2`) and signs
in with a WebAuthn passkey or a `cal_...` API key.

```ts
import { CalimeroClient, browserPasskey } from '@calimero-network/mero-js';

const client = new CalimeroClient({
  baseUrl: 'https://eu1.cloud.calimero.network',
  // Trust the signed mero-tee release the node names, from this one up.
  policy: { release: { minReleaseVersion: '2.3.109' } },
});
await client.signUp(browserPasskey(), 'alice');
await client.installPackage('com.example.kv', '1.0.0'); // signed .mpk from the registry
const app = await client.createApp('kv', { package: 'com.example.kv', version: '1.0.0' }, { confirmMethods: ['transfer'] });
await client.call(app, 'set', { key: 'a', value: '1' });
const { result } = await client.view(app, 'get', { key: 'a' });
await client.callConfirmed(app, 'transfer', { to: 'bob' }, browserPasskey()); // passkey consent
for await (const event of client.events(app)) console.log(event);
await client.upgradeApp(app, { version: '1.1.0' });
```

The check matches core's Rust client (`Measurements::Release`):

1. The node names the mero-tee release it runs. A release below `minReleaseVersion` is refused before anything is fetched.
2. The release's `published-mrtds.json` is fetched and its Sigstore signature is checked against the node release workflow.
   By default it comes from the `cloud.calimero.network` mirror; `releaseSource: 'github'` reads it from the GitHub release instead, as the Rust client does (Node only: GitHub sends no CORS headers).
3. The quote is checked against Intel's collateral with `@phala/dcap-qvl`, taken from Intel's PCS unless you give `fetchCollateral`. That covers the signature chain and the TCB status.
4. A debug TD is refused.
5. The registers must be the release's `locked-read-only` image. A debug profile is trusted only with `allowDebugProfile`.

Mock quotes pass only with `policy.allowMock`, which development clusters need; nothing is read from the environment. Pinned measurements go through `policy.verifyQuote` (`createQuoteVerifier`).

Packages:

- `installPackage(package, version)` installs from the cluster's registry.
- `uploadPackage(mpk)` installs a signed `.mpk` file.
- `packages()`, `package(name)` and `uninstallPackage(name, version?)` list, inspect and uninstall.
- `uploadBundle(wasm)` takes raw WASM, on development clusters only.

Tests run against real nodes: build `merod` and the kv-store fixture in `core`
(branch `release-v2`), then
`MEROD_BINARY=.../merod KV_STORE_WASM=.../kv_store.wasm npm run test:cloud-v2`.

## Lower-level HTTP client

If you need raw HTTP against a node (without the `MeroJs` facade), the SDK
exports composable clients — `createBrowserHttpClient`, `createNodeHttpClient`,
`createUniversalHttpClient`, `createHttpClient` — plus `withRetry`,
`combineSignals`, and `createTimeoutSignal`:

```typescript
import { createBrowserHttpClient } from '@calimero-network/mero-js';

const http = createBrowserHttpClient({
  baseUrl: 'https://node.example.com',
  getAuthToken: async () => localStorage.getItem('access_token') ?? undefined,
});

const data = await http.get<{ message: string }>('/api/hello');
```

Methods (`get`/`post`/`put`/`delete`/`patch`/`head`/`request`) return parsed data
directly and support per-call `{ signal, timeoutMs, parse }`. See the
[HTTP transport guide](https://calimero-network.github.io/mero-js/guides/http-transport/)
for options, parsing rules, retries, and cancellation.

## Development

```bash
pnpm install
pnpm build
pnpm test        # unit tests (mocked, fast)
pnpm lint
pnpm typecheck
```

### Testing & the contract gate

The SDK mirrors core's HTTP wire types by hand, so two layers guard against drift:

- **Unit tests** (`pnpm test`) — mocked, fast, cover the client logic.
- **E2E** (`pnpm test:e2e`) — runs the real SDK against a live `merod`. Point it
  at a node and provide credentials:
  ```bash
  NODE_URL=http://localhost:2528 MERO_E2E_USER=dev MERO_E2E_PASS=dev pnpm test:e2e
  ```
  In CI this runs both against a released `merod` (this repo) and against a
  PR-built `merod` (core's `sdk-e2e`).

The e2e records every request as `METHOD /path` (see `tests/e2e/coverage-recorder.ts`).
Core's route-coverage gate is **method-aware**: it fails if any admin route *or
verb* ships without an SDK test — so e.g. `GET /blobs/:id` can't hide behind
`DELETE /blobs/:id`. When you add an SDK method for a new endpoint, exercise it in
the e2e (the sweep in `tests/e2e/coverage-sweep.test.ts` is the catch-all) so
coverage stays complete.

## License

MIT — see [LICENSE](LICENSE).
