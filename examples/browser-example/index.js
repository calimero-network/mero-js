// Browser example - using native fetch
// Note: This example is designed for browser environments only
// To use in a browser, build the main package first: npm run build
import {
  createBrowserHttpClient,
  withRetry,
  combineSignals,
} from '@calimero-network/mero-js';

// Create HTTP client for browser environment
const httpClient = createBrowserHttpClient({
  baseUrl: 'https://httpbin.org',
  getAuthToken: async () => {
    // Get token from localStorage, sessionStorage, or wherever you store it
    return localStorage.getItem('access_token') || undefined;
  },
  onTokenRefresh: async (newToken) => {
    // Update stored token when it's refreshed
    localStorage.setItem('access_token', newToken);
  },
  defaultHeaders: {
    'User-Agent': 'MyApp/1.0',
  },
  timeoutMs: 10000, // 10 seconds
  credentials: 'include', // Include cookies for CORS requests
});

// Example usage
async function example() {
  try {
    console.log('🌐 Browser Example - Mero.js HTTP Client');
    console.log(
      'Note: This example uses localStorage and is designed for browser environments\n',
    );

    // GET request with custom parsing
    console.log('1️⃣ Testing GET request...');
    const response = await httpClient.get('/get', {
      parse: 'json', // Explicitly specify parsing mode
    });
    if (response.data) {
      console.log('✅ GET request successful:', response.data.url);
    } else {
      console.log('❌ GET request failed:', response.error);
    }

    // POST request with FormData
    console.log('\n2️⃣ Testing POST request with FormData...');
    const formData = new FormData();
    formData.append('name', 'John Doe');
    formData.append('email', 'john@example.com');

    const postResponse = await httpClient.post('/post', formData, {
      // FormData automatically handles Content-Type
    });

    if (postResponse.data) {
      console.log('✅ Form data posted successfully:', postResponse.data.form);
    } else {
      console.log('❌ Error posting form data:', postResponse.error);
    }

    // Request with AbortController (user cancellation)
    console.log('\n3️⃣ Testing AbortController...');
    const userAbortController = new AbortController();
    setTimeout(() => userAbortController.abort(), 2000); // Cancel after 2 seconds

    try {
      const abortResponse = await httpClient.get('/delay/3', {
        signal: userAbortController.signal,
      });
      console.log('✅ Request completed before abort');
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('✅ Request aborted successfully (as expected)');
      } else {
        console.log('❌ Unexpected error:', error.message);
      }
    }

    // Request with combined signals (user + timeout)
    console.log('\n4️⃣ Testing Signal combination...');
    const userController = new AbortController();
    const timeoutController = new AbortController();

    setTimeout(() => timeoutController.abort(), 1000);

    const combinedSignal = combineSignals([
      userController.signal,
      timeoutController.signal,
    ]);

    try {
      const combinedResponse = await httpClient.get('/delay/2', {
        signal: combinedSignal,
        timeoutMs: 3000, // 3 second timeout
      });
      console.log('✅ Combined signal request completed');
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('✅ Combined signal request aborted (as expected)');
      } else {
        console.log('❌ Unexpected error:', error.message);
      }
    }

    // Request with retry (won't retry on user abort)
    console.log('\n5️⃣ Testing Retry functionality...');
    const retryResponse = await withRetry(() => httpClient.get('/get'), {
      attempts: 3,
      baseDelayMs: 100,
      backoffFactor: 2,
      retryCondition: (error, attempt) => {
        // Custom retry logic - won't retry on user abort
        if (error.name === 'AbortError') return false; // User cancelled
        if (error.name === 'TimeoutError') return true; // Timeout is retryable
        return attempt < 2; // Retry once
      },
    });

    if (retryResponse.data) {
      console.log('✅ Retry functionality working');
    } else {
      console.log('❌ Retry functionality failed:', retryResponse.error);
    }

    console.log('\n🎉 Browser example completed successfully!');
    console.log(
      '💡 To use this in a real browser, include the built library and run this code.',
    );
  } catch (error) {
    console.error('❌ Example failed:', error);
  }
}

// Run example
example();
