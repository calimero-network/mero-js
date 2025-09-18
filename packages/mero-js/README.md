# Mero.js - Pure JavaScript SDK for Calimero

A lightweight, universal JavaScript SDK for Calimero that works in both browser and Node.js environments using Web Standards.

> **🚨 Breaking Change (v1.0.0)**: This version removes all legacy Axios-based code. The package now uses only Web Standards (`fetch`, `AbortController`) with zero external dependencies.

## Features

- 🌐 **Web Standards First**: Built on `fetch`, `AbortController`, and other Web APIs
- 🔄 **Universal**: Works in browsers, Node.js, and edge runtimes
- 📦 **Zero Dependencies**: No external dependencies, uses native Web APIs
- 🔧 **Dependency Injection**: Flexible and testable architecture
- ⚡ **Modern**: ES2020+ with TypeScript support
- 🛡️ **Type Safe**: Full TypeScript definitions
- 🔄 **Smart Retry**: Distinguishes user aborts vs timeouts for intelligent retry logic
- 🎯 **Advanced Cancellation**: Signal combination and proper timeout handling

## Installation

```bash
npm install @calimero-network/mero-js
```

## Quick Start

### Browser Usage

```typescript
import { createBrowserHttpClient } from '@calimero-network/mero-js';

const httpClient = createBrowserHttpClient({
  baseUrl: 'https://api.calimero.network',
  getAuthToken: async () => localStorage.getItem('access_token'),
  onTokenRefresh: async (newToken) =>
    localStorage.setItem('access_token', newToken),
});

// Make requests
const response = await httpClient.get<{ message: string }>('/api/hello');
if (response.data) {
  console.log(response.data.message);
}
```

### Node.js Usage

```typescript
import { createNodeHttpClient } from '@calimero-network/mero-js';
// For Node.js < 18, install undici: npm install undici
import { fetch as undiciFetch } from 'undici';

const httpClient = createNodeHttpClient({
  baseUrl: 'https://api.calimero.network',
  fetch: undiciFetch, // Required for Node.js < 18
  getAuthToken: async () => process.env.ACCESS_TOKEN,
});

const response = await httpClient.get<{ message: string }>('/api/hello');
```

### Universal Usage

```typescript
import { createUniversalHttpClient } from '@calimero-network/mero-js';

const httpClient = createUniversalHttpClient({
  baseUrl: 'https://api.calimero.network',
  getAuthToken: async () => {
    return typeof window !== 'undefined'
      ? localStorage.getItem('access_token')
      : process.env.ACCESS_TOKEN;
  },
});
```

## API Reference

### Factory Functions

#### `createBrowserHttpClient(options)`

Creates an HTTP client optimized for browser environments.

#### `createNodeHttpClient(options)`

Creates an HTTP client for Node.js environments.

#### `createUniversalHttpClient(options)`

Creates an HTTP client that works in both browser and Node.js.

### Options

```typescript
interface HttpClientOptions {
  baseUrl: string; // Base URL for all requests
  fetch?: typeof fetch; // Custom fetch implementation (Node.js)
  getAuthToken?: () => Promise<string | undefined>; // Token getter
  onTokenRefresh?: (token: string) => Promise<void>; // Token refresh callback
  defaultHeaders?: Record<string, string>; // Default headers
  timeoutMs?: number; // Request timeout (default: 30000)
  credentials?: RequestCredentials; // CORS credentials (default: 'same-origin' for browser)
  defaultAbortSignal?: AbortSignal; // Default abort signal for all requests
}
```

### HTTP Methods

```typescript
// GET request
const response = await httpClient.get<T>('/api/endpoint', init?);

// POST request
const response = await httpClient.post<T>('/api/endpoint', body?, init?);

// PUT request
const response = await httpClient.put<T>('/api/endpoint', body?, init?);

// DELETE request
const response = await httpClient.delete<T>('/api/endpoint', init?);

// PATCH request
const response = await httpClient.patch<T>('/api/endpoint', body?, init?);

// HEAD request
const response = await httpClient.head<T>('/api/endpoint', init?);

// Generic request
const response = await httpClient.request<T>('/api/endpoint', init?);
```

### Request Options

```typescript
interface RequestOptions extends RequestInit {
  parse?: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'response';
  timeoutMs?: number;
}
```

### Response Format

All methods return a `ResponseData<T>` object:

```typescript
type ResponseData<T> =
  | { data: T; error: null } // Success
  | { data: null; error: ErrorResponse }; // Error

interface ErrorResponse {
  code?: number;
  message: string;
}
```

## Advanced Usage

### Custom Transport

```typescript
import { createHttpClient, Transport } from '@calimero-network/mero-js';

const transport: Transport = {
  fetch: customFetch,
  baseUrl: 'https://api.example.com',
  getAuthToken: async () => 'your-token',
  timeoutMs: 5000,
};

const httpClient = createHttpClient(transport);
```

### Error Handling

```typescript
try {
  const response = await httpClient.get('/api/data');

  if (response.data) {
    // Success
    console.log(response.data);
  } else {
    // API Error
    console.error('API Error:', response.error.message);
  }
} catch (error) {
  // Network or other errors
  console.error('Request failed:', error);
}
```

### Custom Headers

```typescript
const response = await httpClient.post('/api/data', body, {
  headers: {
    'Content-Type': 'application/json',
    'X-Custom-Header': 'value',
  },
});
```

### Request Cancellation

```typescript
const abortController = new AbortController();

// Cancel request after 5 seconds
setTimeout(() => abortController.abort(), 5000);

const response = await httpClient.get('/api/slow-endpoint', {
  signal: abortController.signal,
});
```

### FormData Support

```typescript
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('name', 'John Doe');

const response = await httpClient.post('/api/upload', formData);
// Content-Type is automatically set to multipart/form-data
```

### Response Parsing

```typescript
// Explicit parsing
const jsonResponse = await httpClient.get('/api/data', { parse: 'json' });
const textResponse = await httpClient.get('/api/text', { parse: 'text' });
const blobResponse = await httpClient.get('/api/file', { parse: 'blob' });

// Auto-detection based on Content-Type (default)
const autoResponse = await httpClient.get('/api/data');
```

### Retry with Exponential Backoff

```typescript
import { withRetry } from '@calimero-network/mero-js';

const response = await withRetry(
  () => httpClient.get('/api/unreliable-endpoint'),
  {
    attempts: 3,
    baseDelayMs: 1000,
    backoffFactor: 2,
    retryCondition: (error, attempt) => {
      // Smart retry logic - distinguishes user abort vs timeout
      if (error.name === 'AbortError') return false; // Don't retry user cancellation
      if (error.name === 'TimeoutError') return true; // Retry timeouts
      if (error.status >= 500) return true; // Retry server errors
      return false; // Don't retry client errors
    },
  },
);
```

### Signal Combination

```typescript
import { combineSignals, createTimeoutSignal } from '@calimero-network/mero-js';

// Combine multiple abort signals
const userSignal = new AbortController().signal;
const timeoutSignal = createTimeoutSignal(5000);
const combinedSignal = combineSignals([userSignal, timeoutSignal]);

const response = await httpClient.get('/api/endpoint', {
  signal: combinedSignal,
});
```

### CORS and Credentials

```typescript
const httpClient = createBrowserHttpClient({
  baseUrl: 'https://api.example.com',
  credentials: 'include', // Include cookies in CORS requests
});

// For APIs that require credentials
const response = await httpClient.get('/api/protected', {
  credentials: 'include',
});
```

## Migration from Axios

If you're migrating from an Axios-based client:

1. **Replace imports**: Use the factory functions instead of direct class instantiation
2. **Update method signatures**: Methods now use `RequestInit` instead of custom options
3. **Handle responses**: Use the `ResponseData<T>` format instead of Axios response objects
4. **Token management**: Use the `getAuthToken` and `onTokenRefresh` callbacks

## Browser Support

- Modern browsers with `fetch` support (Chrome 42+, Firefox 39+, Safari 10.1+)
- Node.js 18+ (native fetch) or Node.js 16+ with `undici`

## Bundle Sizes

- **ESM**: ~9.4kb (gzipped: ~3.2kb)
- **CJS**: ~10.5kb (gzipped: ~3.6kb)

## Examples

See the `examples/` directory for complete usage examples:

- `browser-example.ts` - Browser-specific usage (designed for browser environments)
- `node-example.ts` - Node.js-specific usage (designed for Node.js environments)
- `universal-example.ts` - Universal usage (works in both browser and Node.js)

**Note**: Run `npm run build` before running the examples, as they import from the built library.

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Test
pnpm test

# Lint
pnpm lint
```

## License

MIT
