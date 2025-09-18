// Universal example - works in both browser and Node.js
// Note: This example is designed to work in both environments
import { createUniversalHttpClient } from '@calimero-network/mero-js';

// Create HTTP client that works in both environments
const httpClient = createUniversalHttpClient({
  baseUrl: 'https://httpbin.org',
  // fetch: customFetch, // Optional: provide custom fetch implementation
  getAuthToken: async () => {
    // Environment-specific token retrieval
    if (typeof window !== 'undefined') {
      // Browser environment
      return localStorage.getItem('access_token') || undefined;
    } else {
      // Node.js environment
      return process.env.ACCESS_TOKEN || undefined;
    }
  },
  onTokenRefresh: async (newToken) => {
    // Environment-specific token storage
    if (typeof window !== 'undefined') {
      // Browser environment
      localStorage.setItem('access_token', newToken);
    } else {
      // Node.js environment
      process.env.ACCESS_TOKEN = newToken;
      console.log('🔄 Token refreshed:', newToken);
    }
  },
  defaultHeaders: {
    'User-Agent': 'MyUniversalApp/1.0',
  },
  timeoutMs: 12000, // 12 seconds
});

// Example usage
async function example() {
  try {
    const environment = typeof window !== 'undefined' ? 'Browser' : 'Node.js';
    console.log(`🌍 Universal Example - Mero.js HTTP Client (${environment})`);
    console.log(
      'This example works in both browser and Node.js environments\n',
    );

    // GET request
    console.log('1️⃣ Testing GET request...');
    const response = await httpClient.get('/get');
    if (response.data) {
      console.log('✅ GET request successful:', response.data.url);
    } else {
      console.log('❌ GET request failed:', response.error);
    }

    // POST request with custom headers
    console.log('\n2️⃣ Testing POST request with custom headers...');
    const postResponse = await httpClient.post(
      '/post',
      {
        name: 'Universal User',
        email: 'user@example.com',
        environment: environment,
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          'X-Custom-Header': 'custom-value',
          'X-Environment': environment,
        },
      },
    );

    if (postResponse.data) {
      console.log('✅ POST request successful:', postResponse.data.json);
      console.log('📋 Headers sent:', postResponse.data.headers);
    } else {
      console.log('❌ POST request failed:', postResponse.error);
    }

    // PUT request
    console.log('\n3️⃣ Testing PUT request...');
    const putResponse = await httpClient.put('/put', {
      id: 123,
      name: 'Updated User',
      email: 'updated@example.com',
      environment: environment,
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

    // PATCH request
    console.log('\n5️⃣ Testing PATCH request...');
    const patchResponse = await httpClient.patch('/patch', {
      status: 'updated',
      environment: environment,
    });

    if (patchResponse.data) {
      console.log('✅ PATCH request successful:', patchResponse.data.json);
    } else {
      console.log('❌ PATCH request failed:', patchResponse.error);
    }

    // HEAD request
    console.log('\n6️⃣ Testing HEAD request...');
    const headResponse = await httpClient.head('/get');

    if (headResponse.data) {
      console.log('✅ HEAD request successful');
    } else {
      console.log('❌ HEAD request failed:', headResponse.error);
    }

    // Error handling
    console.log('\n7️⃣ Testing Error handling...');
    const errorResponse = await httpClient.get('/status/500');
    if (errorResponse.data) {
      console.log('❌ Expected error but got success');
    } else {
      console.log(
        '✅ Error handling working (500 error caught):',
        errorResponse.error.message,
      );
    }

    console.log('\n🎉 Universal example completed successfully!');
    console.log('💡 This example demonstrates cross-platform usage patterns.');
    console.log(`🖥️  Currently running in: ${environment}`);
  } catch (error) {
    console.error('❌ Example failed:', error);
  }
}

// Run example
example();
