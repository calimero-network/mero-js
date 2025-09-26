// Node.js example - using MeroJs SDK
// Note: This example is designed for Node.js environments
import { MeroJs } from '../../packages/mero-js/dist/index.mjs';

// Create MeroJs SDK instance for Node.js
const meroJs = new MeroJs({
  baseUrl: 'http://node1.127.0.0.1.nip.io', // Calimero node URL
  credentials: {
    username: 'admin',
    password: 'admin123',
  },
  timeoutMs: 15000, // 15 seconds
  tokenStorage: {
    type: 'file', // Use file storage for Node.js
    config: {
      key: 'node-token.json',
    },
  },
});

// Example usage
async function example() {
  try {
    console.log('🖥️  Node.js Example - MeroJs SDK');
    console.log('This example demonstrates the MeroJs SDK for Node.js environments\n');

    // Authenticate with the Calimero node
    console.log('🔑 Authenticating with Calimero node...');
    const tokenData = await meroJs.authenticate();
    console.log('✅ Authentication successful!');
    console.log('🎫 Token expires at:', new Date(tokenData.expires_at));

    // Test Auth API
    console.log('\n1️⃣ Testing Auth API - Health Check...');
    const health = await meroJs.auth.getHealth();
    console.log('✅ Auth API health:', health.status);

    // Test Auth API - Service Identity
    console.log('\n2️⃣ Testing Auth API - Service Identity...');
    const identity = await meroJs.auth.getIdentity();
    console.log('✅ Service identity:', identity.service, 'v' + identity.version);

    // Test Auth API - Available Providers
    console.log('\n3️⃣ Testing Auth API - Available Providers...');
    const providers = await meroJs.auth.getProviders();
    console.log('✅ Available providers:', providers.providers.map(p => p.name).join(', '));

    // Test Auth API - Token Validation
    console.log('\n4️⃣ Testing Auth API - Token Validation...');
    const tokenData2 = await meroJs.getTokenData();
    const validation = await meroJs.auth.validateToken(tokenData2.access_token);
    console.log('✅ Token validation:', validation.valid ? 'VALID' : 'INVALID');

    // Test Auth API - List Root Keys
    console.log('\n5️⃣ Testing Auth API - List Root Keys...');
    const rootKeys = await meroJs.auth.listRootKeys();
    console.log('✅ Root keys found:', rootKeys.length);

    // Admin API not implemented yet

    console.log('\n🎉 Node.js example completed successfully!');
    console.log('💡 This example demonstrates the MeroJs SDK with Calimero APIs.');
  } catch (error) {
    console.error('❌ Example failed:', error.message);
    console.error('Full error:', error);
  }
}

// Run example
example();