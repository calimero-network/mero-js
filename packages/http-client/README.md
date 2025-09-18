# HTTP Client

Web Standards HTTP client for Calimero applications.

## Features

- Web Standards based (uses native `fetch`)
- TypeScript support
- Retry logic with exponential backoff
- Timeout handling
- AbortSignal support
- Browser and Node.js compatibility
- Factory functions for easy setup

## Usage

```typescript
import { createBrowserHttpClient } from '@calimero-network/http-client';

const client = createBrowserHttpClient({
  baseUrl: 'https://api.example.com',
  getAuthToken: async () => 'your-token',
});

const data = await client.get('/users');
```
