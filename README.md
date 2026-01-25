# Mero.js v2 — Pure JavaScript SDK for Calimero

A lightweight, universal JavaScript SDK for interacting with Calimero nodes. Works in browsers, Node.js, React Native, and Tauri.

## Features

- 🌐 **Universal** — Browser, Node.js, React Native, Tauri
- 📦 **Zero Dependencies** — Built on Web Standards (`fetch`, `AbortController`)
- 🔐 **Smart Token Management** — Automatic refresh on 401, preemptive refresh before expiry
- 💾 **Pluggable Storage** — Bring your own `TokenStorage` (localStorage, AsyncStorage, Keychain)
- 🔄 **Real-time** — WebSocket and SSE clients for event subscriptions
- ⚡ **JSON-RPC** — Execute queries and mutations on contexts
- 🛡️ **Type Safe** — Full TypeScript definitions
- ✅ **Tested** — 236 unit tests, E2E with Merobox

## Installation

```bash
npm install @calimero-network/mero-js
# or
pnpm add @calimero-network/mero-js
```

## Quick Start

```typescript
import { MeroJs } from '@calimero-network/mero-js';

const mero = new MeroJs({
  baseUrl: 'http://localhost:2428',
  credentials: {
    username: 'admin',
    password: 'your-password',
  },
});

// Authenticate
await mero.authenticate();

// Use the Admin API
const apps = await mero.admin.applications.listApplications();
const contexts = await mero.admin.contexts.listContexts();

// Execute JSON-RPC calls
const result = await mero.rpc.query(
  'context-id',
  'get',
  { key: 'myKey' },
  'ed25519:executor-public-key'
);
```

## Token Persistence

By default, tokens are stored in-memory. Provide a `TokenStorage` to persist across sessions:

### Browser (localStorage)

```typescript
const mero = new MeroJs({
  baseUrl: 'http://localhost:2428',
  credentials: { username: 'admin', password: 'password' },
  tokenStorage: {
    async get() {
      const data = localStorage.getItem('mero-token');
      return data ? JSON.parse(data) : null;
    },
    async set(token) {
      localStorage.setItem('mero-token', JSON.stringify(token));
    },
    async clear() {
      localStorage.removeItem('mero-token');
    },
  },
});

// Load stored tokens on startup
await mero.init();

if (!mero.isAuthenticated()) {
  await mero.authenticate();
}
```

### React Native (AsyncStorage)

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';

const mero = new MeroJs({
  baseUrl: 'http://localhost:2428',
  credentials: { username: 'admin', password: 'password' },
  tokenStorage: {
    async get() {
      const data = await AsyncStorage.getItem('mero-token');
      return data ? JSON.parse(data) : null;
    },
    async set(token) {
      await AsyncStorage.setItem('mero-token', JSON.stringify(token));
    },
    async clear() {
      await AsyncStorage.removeItem('mero-token');
    },
  },
});
```

### Tauri (Secure Store)

```typescript
import { Store } from '@tauri-apps/plugin-store';

const store = new Store('.tokens.dat');

const mero = new MeroJs({
  baseUrl: 'http://localhost:2428',
  requestCredentials: 'omit', // Required for Tauri
  tokenStorage: {
    async get() {
      return await store.get('mero-token');
    },
    async set(token) {
      await store.set('mero-token', token);
      await store.save();
    },
    async clear() {
      await store.delete('mero-token');
      await store.save();
    },
  },
});
```

## Token Refresh

The SDK automatically handles token refresh in two ways:

1. **Preemptive** — Refreshes 5 minutes before expiry
2. **Reactive** — On 401 with `x-auth-error: token_expired`, automatically refreshes and retries

```
┌─────────────────────────────────────────────────┐
│                Token Lifecycle                  │
├─────────────────────────────────────────────────┤
│  authenticate() ──> Token stored                │
│                     │                           │
│  API Request ───────┼──> Token valid? ──yes──>  │
│                     │         │                 │
│                     │        no (within 5min)   │
│                     │         │                 │
│                     │         ▼                 │
│                     │    Refresh token          │
│                     │         │                 │
│  401 + expired ─────┼─────────┘                 │
│                     │                           │
│  clearToken() ──────┼──> Token cleared          │
└─────────────────────────────────────────────────┘
```

## API Reference

### MeroJs Class

```typescript
interface MeroJsConfig {
  baseUrl: string;              // Node URL
  authBaseUrl?: string;         // Auth service URL (if separate)
  credentials?: { username: string; password: string };
  timeoutMs?: number;           // Default: 10000
  requestCredentials?: RequestCredentials;
  tokenStorage?: TokenStorage;  // For persistence
}

const mero = new MeroJs(config);

// Lifecycle
await mero.init();              // Load tokens from storage
await mero.authenticate();      // Get new tokens
await mero.clearToken();        // Clear tokens
mero.isAuthenticated();         // Check auth status
mero.getTokenData();            // Get current tokens

// API Clients
mero.auth                       // Auth API
mero.admin                      // Admin API
mero.rpc                        // JSON-RPC client

// Real-time
mero.createWebSocket();         // WebSocket client
mero.createSse();               // SSE client
```

### Admin API

```typescript
// Applications
await mero.admin.applications.listApplications();
await mero.admin.applications.getApplication(appId);
await mero.admin.applications.installApplication({ url, metadata });
await mero.admin.applications.uninstallApplication(appId);

// Contexts
await mero.admin.contexts.listContexts();
await mero.admin.contexts.createContext({ applicationId, contextSeed });
await mero.admin.contexts.getContext(contextId);
await mero.admin.contexts.deleteContext(contextId);
await mero.admin.contexts.joinContext({ contextId, invitationPayload });

// Blobs
await mero.admin.blobs.listBlobs();
await mero.admin.blobs.uploadBlob(data);
await mero.admin.blobs.getBlob(blobId);
await mero.admin.blobs.deleteBlob(blobId);

// Identity
await mero.admin.identity.generateContextIdentity();

// Network
await mero.admin.network.getPeersCount();

// Public (no auth required)
await mero.admin.public.health();
await mero.admin.public.isAuthed();
```

### Auth API

```typescript
// Health & Info
await mero.auth.getHealth();
await mero.auth.getIdentity();
await mero.auth.getProviders();

// Tokens
await mero.auth.getToken(request);
await mero.auth.refreshToken({ refresh_token });
await mero.auth.validateToken({ token });

// Keys
await mero.auth.listRootKeys();
await mero.auth.createRootKey(request);
await mero.auth.deleteRootKey(publicKey);
await mero.auth.listClientKeys();
await mero.auth.generateClientKey(request);
await mero.auth.deleteClientKey(publicKey);
```

### JSON-RPC

```typescript
// Query (read-only)
const result = await mero.rpc.query(
  'context-id',
  'get',
  { key: 'myKey' },
  'ed25519:executor-public-key'
);

// Mutate (write)
const result = await mero.rpc.mutate(
  'context-id',
  'set',
  { key: 'myKey', value: 'myValue' },
  'ed25519:executor-public-key'
);

// Generic execute
const result = await mero.rpc.execute({
  contextId: 'context-id',
  method: 'myMethod',
  args: { foo: 'bar' },
  executorPublicKey: 'ed25519:...',
});
```

### WebSocket (Real-time Events)

```typescript
const ws = mero.createWebSocket();

await ws.connect();

ws.onEvent((event) => {
  console.log('Event:', event);
});

ws.onError((error) => {
  console.error('Error:', error);
});

await ws.subscribe(['context-id-1', 'context-id-2']);

// Later...
await ws.unsubscribe(['context-id-1']);
ws.disconnect();
```

### SSE (Server-Sent Events)

```typescript
const sse = mero.createSse();

const sessionId = await sse.connect();

sse.onEvent((event) => {
  console.log('Event:', event);
});

await sse.subscribe(['context-id-1']);

// Get session info
const session = await sse.getSession();

// Later...
sse.disconnect();
```

## Deep Imports

For tree-shaking or direct access:

```typescript
// Main SDK
import { MeroJs } from '@calimero-network/mero-js';

// HTTP Client only
import { createBrowserHttpClient } from '@calimero-network/mero-js/http-client';

// Specific API clients
import { AdminApiClient } from '@calimero-network/mero-js/api/admin';
import { AuthApiClient } from '@calimero-network/mero-js/api/auth';
import { RpcClient } from '@calimero-network/mero-js/api/rpc';
import { WebSocketClient } from '@calimero-network/mero-js/api/ws';
import { SseClient } from '@calimero-network/mero-js/api/sse';
```

## HTTP Client (Low-Level)

For custom use cases, use the HTTP client directly:

```typescript
import { createBrowserHttpClient, HTTPError } from '@calimero-network/mero-js';

const http = createBrowserHttpClient({
  baseUrl: 'https://api.example.com',
  getAuthToken: async () => myTokenStore.getToken(),
  refreshToken: async () => {
    const newToken = await myRefreshLogic();
    return newToken;
  },
  onTokenRefresh: async (token) => {
    await myTokenStore.setToken(token);
  },
  timeoutMs: 10000,
});

try {
  const data = await http.get<MyType>('/api/endpoint');
} catch (error) {
  if (error instanceof HTTPError) {
    console.log(`HTTP ${error.status}: ${error.bodyText}`);
  }
}
```

## Error Handling

```typescript
import { HTTPError, ApiResponseError } from '@calimero-network/mero-js';

try {
  await mero.admin.contexts.getContext('invalid-id');
} catch (error) {
  if (error instanceof HTTPError) {
    // HTTP-level error (4xx, 5xx)
    console.log(`HTTP ${error.status}: ${error.statusText}`);
    console.log('Body:', error.bodyText);
  } else if (error instanceof ApiResponseError) {
    // API-level error (in response body)
    console.log(`API Error: ${error.message}`);
    console.log('Type:', error.type);
    console.log('Code:', error.code);
  } else if (error.name === 'AbortError') {
    // Request was cancelled
  } else if (error.name === 'TimeoutError') {
    // Request timed out
  }
}
```

## Testing

```bash
# Unit tests (236 tests)
pnpm test

# E2E tests with Merobox
pnpm test:e2e

# Full test suite
pnpm test:all
```

## Development

```bash
# Install dependencies
pnpm install

# Build (with strict mode)
pnpm build

# Lint
pnpm lint

# Type check
pnpm typecheck

# Generate MSW handlers from OpenAPI
pnpm generate:msw
```

## Bundle Sizes

| Format | Size | Gzipped |
|--------|------|---------|
| ESM | ~57kb | ~15kb |
| CJS | ~59kb | ~16kb |
| Browser (minified) | ~29kb | ~9kb |

## Browser Support

- Modern browsers with `fetch` (Chrome 42+, Firefox 39+, Safari 10.1+)
- Node.js 18+ (native fetch) or 16+ with `undici`
- React Native with `fetch` polyfill
- Tauri (set `requestCredentials: 'omit'`)

## Migration from v1.x

### Breaking Changes

1. **`clearToken()` is now async**
   ```typescript
   // Before
   mero.clearToken();
   
   // After
   await mero.clearToken();
   ```

2. **HTTP client wiring** — Token refresh callbacks are now wired automatically

### New Features

- `TokenStorage` interface for persistence
- `init()` method to load stored tokens
- Automatic 401 token refresh with retry
- WebSocket and SSE clients
- JSON-RPC client
- Lazy-loaded Admin API sub-clients
- Enhanced `unwrap()` with RPC error detection

## License

MIT
