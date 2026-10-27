# mero-js — JavaScript client for the Calimero cloud

The JavaScript/TypeScript client for a Calimero cloud cluster (`merod-v2`). Before
it sends anything, it verifies the node's TDX attestation. It then seals every
request end to end to the attested node (Noise NK, `calimero/sealed-http/v2`), and
it signs in with a WebAuthn passkey or a `cal_...` API key. It runs in the browser,
Node 18+, Deno, Bun and edge runtimes.

## Installation

```bash
npm install @calimero-network/mero-js
```

The package ships ESM, CommonJS and a minified browser build, with its own
TypeScript declarations. Its one dependency is `@phala/dcap-qvl`, for TDX quote
verification.

## Quick start

```ts
import { CalimeroClient, browserPasskey } from '@calimero-network/mero-js';

const client = new CalimeroClient({
  baseUrl: 'https://eu1.cloud.calimero.network',
  policy: { allowMock: false, verifyQuote, appHash }, // verifyQuote: see below
});
await client.signUp(browserPasskey(), 'alice');
const bundle = await client.uploadBundle(wasmBytes);
const app = await client.createApp('kv', bundle, { confirmMethods: ['transfer'] });
await client.call(app, 'set', { key: 'a', value: '1' });
const { result } = await client.view(app, 'get', { key: 'a' });
await client.callConfirmed(app, 'transfer', { to: 'bob' }, browserPasskey()); // passkey consent
for await (const event of client.events(app)) console.log(event);
```

The client also covers blobs (`uploadBlob`, `downloadBlob`), organizations, teams
and invites (`createOrg`, `createTeam`, `invite`), API keys and further passkeys.

## Verifying the node

`policy.verifyQuote` decides whether a node's quote is one you trust. It is usually
`createQuoteVerifier` trusting a signed mero-tee release:

```ts
import { verify as dcapVerify } from '@phala/dcap-qvl';
import {
  createQuoteVerifier, fetchNodeRelease, cloudNodeReleaseUrl, trustSignedRelease, DEFAULT_RELEASE_MIRROR,
} from '@calimero-network/mero-js';

const release = await fetchNodeRelease(cloudNodeReleaseUrl(DEFAULT_RELEASE_MIRROR, '2.3.87'));
const verifyQuote = createQuoteVerifier({
  dcapVerify,
  ...(await trustSignedRelease({ release, profile: 'locked-read-only', minReleaseVersion: '2.3.87' })),
});
```

`createSignedReleaseVerifier` does the same for whichever signed release, at or
above a floor, the node runs. Development clusters (`merod-v2 local`) use mock
quotes, so set `policy.allowMock: true` for them only.

## Development

```bash
pnpm install
pnpm build
pnpm test:unit   # sealed transport, quote and release verification
pnpm lint
pnpm typecheck
```

`pnpm test:cloud-v2` runs the client against a real local cluster. Build `merod-v2`
and the kv-store fixture in `core` (branch `release-v2`), then run:

```bash
MEROD_V2_BINARY=.../merod-v2 KV_STORE_WASM=.../kv_store.wasm pnpm test:cloud-v2
```

## License

MIT — see [LICENSE](LICENSE).
