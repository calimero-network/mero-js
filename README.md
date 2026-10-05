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

The quickstart above assumes you have a node and a credential on it. A browser
tab, a phone, or an agent has neither — the runtime cannot compile the app's WASM
against materialized state, and never received the scope key that seals the
deltas. So there is a second connection shape: sign in to **Calimero Cloud**, and
write through an attested TEE **relay** using
[delegated execution](https://calimero-network.github.io/core/protocol/delegated-authorship/).

You sign a *warrant* locally — your consent for one specific intent, once — the
relay runs the method as **your** principal, and the resulting change is
attributed to your account and device. Your signing key never leaves the
process; only signatures do.

```typescript
import { connectCloud } from '@calimero-network/mero-js';

const connection = await connectCloud({
  googleIdToken,        // or a stored sessionToken
  authorAccount,        // your account, hex
  authorProof,          // your AccountProof<DeviceCert>, hex borsh
  deviceSecret,         // your device's ed25519 seed, hex — never transmitted
});

const { rootHash, returns } = await connection.execute(contextId, 'set', {
  key: 'greeting',
  value: 'hello',
});
```

`connectCloud` replaces the **node-URL prompt**, not the authentication: it asks
the cloud which namespaces the account owns and which relay serves them, then
builds the relay client. `sdk.cloud` exposes the same cloud API from an existing
`MeroJs` instance for apps that have both a node and a cloud account, and
`RelayClient` is available directly for a relay you were told about out of band.

One precondition is not yours to satisfy: the node must relay. A fleet node
admitted as a `RelayTee` (the namespace's TEE admission policy set with
`mode: 'relay'`) relays by role; a `ReadOnlyTee` is a replica and never relays;
and a node too old to report a role needs an admin of the namespace to grant it
`CAN_AUTHOR_ON_BEHALF`. `connectCloud` picks a relay on the cloud's `canExecute`,
which folds that rule in, and otherwise throws saying which of those is missing —
naming the account that needs the grant when that is the fix.

A keyholder can also **create** a context through a relay:
`relay.createContext({ groupId, applicationId, initArgs })` signs a creation
warrant (checked against *your* `CAN_CREATE_CONTEXT`, not the relay's) and
returns the new `contextId`.

And it can **govern** through one: `relay.govern({ groupId, op })` signs a
governance warrant over one op, such as `memberAddedOp(account, 'Member')` or
`groupCreatedOp({ ... })`, and every peer applies it under *your* rights.

See the [cloud client](https://calimero-network.github.io/mero-js/reference/cloud/),
[relay client](https://calimero-network.github.io/mero-js/reference/relay/) and
[connectCloud](https://calimero-network.github.io/mero-js/reference/connect-cloud/)
references — including why a warrant nonce must never restart.

## Account (delegated) layer

`connectCloud` is the shape for an account that already belongs somewhere. The
account layer is everything around it for an account that owns nothing yet: it
has a device the wallet certified and no relay, and it has to found a namespace
or be invited into one before it can write. It is framework-free — plain TS over
`sessionStorage`/`localStorage` — and `@calimero-network/mero-react` re-exports
every name below unchanged (its hooks are built on it), so an app may import
them from either package.

- **Session** — `DelegatedCredential` (what the wallet certified: account,
  certificate, device secret) and `DelegatedAccountSession` (that plus the relay
  to write through, `null` until the account is a member of something).
  `readDelegatedSession` / `saveDelegatedSession` / `clearDelegatedSession`,
  `readDelegatedCredential` / `saveDelegatedCredential` /
  `clearDelegatedCredential`; `readRelayMap`, `rememberRelay`,
  `relayForContext`, `knownRelays`, `listDelegatedContexts`,
  `listDelegatedNamespaces`, `carryExecutorAccount`.
- **The relay's node key** — `learnRelayNodeKey` (attests the relay: its signed
  mero-tee release from the cloud mirror, Intel's chain, every register; retries
  the transport, refuses a bad quote), `attemptRelayNodeKey`,
  `resolveRelayNodeKey`, `pinRelayNodeKey`, `readPinnedRelayNodeKey`,
  `RELAY_NODE_KEY_RETRY_MS`. `@phala/dcap-qvl` is loaded on the first real quote
  and is external to the bundles: a consumer that never meets a real relay never
  downloads the verifier.
- **Client** — `buildDelegatedClient(session, contextId)`: a `MeroClient` over
  the relay transport, or `null` while there is no relay (a logged-in state, not
  a broken one). `forgetMethodKinds`, `persistedNonces`, `markContextNonceSpent`.
- **Admin, one shape on both transports** — `createAccountAdmin({ session,
  read, app })` returns an `AdminApiClient` whose writes are governance and
  creation warrants signed by the account and whose reads go through the relay;
  `createNodeAdmin({ admin, app })` is the same `AdminApiClient` for a node, with
  `createNamespace` installing the package first. Refusals: `NoRelayError`,
  `NotForAccountError`, `InvitationNotClaimableError`.
- **Founding and creating** — `foundDelegatedNamespace`,
  `createDelegatedContext`, `createDelegatedPrivateContext`,
  `delegatedGovernance`, `governGroup`, `governRoot`, `namespaceOfGroup`,
  `rememberGroupNamespace`; `HA_REFUSAL_MESSAGES`,
  `HA_ACCOUNT_NOT_LINKED_MESSAGE` for the cloud's HA answers.
- **Which application** — `applicationIdForBundle`, `selectLatestBundle`,
  `fetchRegistryBundles`, `resolveApplicationIdFromRegistry`,
  `latestPublishedVersion` (the registry's answer for a package).
- **Joining from an invitation** — `resolveRelayFromInvitation` (which relay
  admits, from the invitation's signed admitters and the cloud), `joinWithNode`,
  `bootstrapFromInvitation` (both steps, as a result rather than a throw),
  `joinAsAccount` (the same, switching the session onto the relay that admitted),
  `normaliseAccount`.

```typescript
import {
  beginDeviceEnrolment, readEnrolmentCallback, completeDeviceEnrolment,
  saveDelegatedSession, learnRelayNodeKey, pinRelayNodeKey, buildDelegatedClient,
  createAccountAdmin, joinAsAccount, resolveApplicationIdFromRegistry, type DelegatedAccountSession,
} from '@calimero-network/mero-js';

// 1. Enrol: the wallet certifies a device key this app generated and keeps.
//    (first visit)  beginDeviceEnrolment({ walletUrl, devicePublicKey, kemPublicKey, returnTo, state });
//    (on return)
const callback = readEnrolmentCallback(window.location.href);
const enrolled = await completeDeviceEnrolment({ ...callback, expectState: state });
let session: DelegatedAccountSession = {
  account: enrolled.account, credential: enrolled.credential, deviceSecret, relayUrl: null,
};
saveDelegatedSession(session);

// 2. Found a namespace, or join one. A new account has no relay; either gives it one.
const registryUrl = 'https://apps.calimero.network';
const app = await resolveApplicationIdFromRegistry(registryUrl, 'com.example.kv');
const admin = createAccountAdmin(
  { session, read: null, app: { packageName: 'com.example.kv', packageVersion: app.version, registryUrl } },
  { join: (namespaceId, invitation) => joinAsAccount(session, namespaceId, invitation, {
      onJoined: (next) => { session = next; saveDelegatedSession(next); },
    }) },
);
const { namespaceId } = await admin.createNamespace({ applicationId: app.applicationId, name: 'my-notes' });
//   or:  await admin.joinNamespace(namespaceId, { invitation });

// 3. Attest the relay before trusting a session on it, then write through it.
const nodeKey = await learnRelayNodeKey(session.relayUrl!);
if (nodeKey) pinRelayNodeKey(session.relayUrl!, nodeKey);
const client = buildDelegatedClient(session, null)!;
const { contextId } = await admin.createContext({ groupId: namespaceId, applicationId: app.applicationId, serviceName: 'kv' });
await client.execute(contextId, 'set', { key: 'greeting', value: 'hello' });

// 4. Invite another account; they claim it with `admin.joinNamespace` on their side.
const { invitation } = await admin.createNamespaceInvitation(namespaceId);
```

`createNamespace` founds through the relay and enables HA on the cloud for the
account; `createContext` signs a creation warrant naming the bundle service it
is for; `createNamespaceInvitation` names the relays that admit, so an invitee
with no node of their own can be admitted by one of them. The `read` client is
`null` until the relay's node key is attested, which is why the session is
built in that order.

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
