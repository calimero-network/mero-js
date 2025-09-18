// Node.js example - using native fetch (Node.js 18+)
// Note: This example is designed for Node.js environments
// For Node.js < 18, you may need to install undici: npm install undici
import { createNodeHttpClient } from '@calimero-network/mero-js';

// For Node.js, you need to provide a fetch implementation
// Option 1: Use undici (recommended for Node.js < 18)
// npm install undici
// import { fetch as undiciFetch } from 'undici';

// Option 2: Use Node.js 18+ native fetch
// const nodeFetch = globalThis.fetch;

// Option 3: Use node-fetch
// npm install node-fetch
// import fetch from 'node-fetch';

// Create HTTP client for Node.js environment
const httpClient = createNodeHttpClient({
  baseUrl: 'https://httpbin.org',
  // fetch: undiciFetch, // Uncomment if using undici
  getAuthToken: async () => {
    // Get token from environment variables, database, or wherever you store it
    return process.env.ACCESS_TOKEN || undefined;
  },
  onTokenRefresh: async (newToken) => {
    // Update stored token when it's refreshed
    process.env.ACCESS_TOKEN = newToken;
    console.log('🔄 Token refreshed:', newToken);
  },
  defaultHeaders: {
    'User-Agent': 'MyNodeApp/1.0',
  },
  timeoutMs: 15000, // 15 seconds
});

// Example usage
async function example() {
  try {
    console.log('🖥️  Node.js Example - Mero.js HTTP Client');
    console.log('This example is designed for Node.js environments\n');

    // GET request
    console.log('1️⃣ Testing GET request...');
    const response = await httpClient.get('/get');
    if (response.data) {
      console.log('✅ GET request successful:', response.data.url);
    } else {
      console.log('❌ GET request failed:', response.error);
    }

    // POST request
    console.log('\n2️⃣ Testing POST request...');
    const postResponse = await httpClient.post('/post', {
      name: 'Jane Doe',
      email: 'jane@example.com',
      timestamp: new Date().toISOString(),
    });

    if (postResponse.data) {
      console.log('✅ POST request successful:', postResponse.data.json);
    } else {
      console.log('❌ POST request failed:', postResponse.error);
    }

    // PUT request
    console.log('\n3️⃣ Testing PUT request...');
    const putResponse = await httpClient.put('/put', {
      id: 123,
      name: 'Updated User',
      email: 'updated@example.com',
    });

    if (putResponse.data) {
      console.log('✅ PUT request successful:', putResponse.data.json);
    } else {
      console.log('❌ PUT request failed:', putResponse.error);
    }

    // DELETE request
    console.log('\n4️⃣ Testing DELETE request...');
    const deleteResponse = await httpClient.delete('/delete');

    if (deleteResponse.data) {
      console.log('✅ DELETE request successful:', deleteResponse.data.url);
    } else {
      console.log('❌ DELETE request failed:', deleteResponse.error);
    }

    // Error handling example
    console.log('\n5️⃣ Testing Error handling...');
    const errorResponse = await httpClient.get('/status/404');
    if (errorResponse.data) {
      console.log('❌ Expected error but got success');
    } else {
      console.log(
        '✅ Error handling working (404 error caught):',
        errorResponse.error.message,
      );
    }

    console.log('\n🎉 Node.js example completed successfully!');
    console.log(
      '💡 This example demonstrates Node.js-specific usage patterns.',
    );
  } catch (error) {
    console.error('❌ Example failed:', error);
  }
}

// Run example
example();
